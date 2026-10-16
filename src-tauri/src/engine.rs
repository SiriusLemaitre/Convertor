use serde::{Deserialize, Serialize};
#[path = "toolbox.rs"]
mod toolbox;
pub use toolbox::{visual_preview, PreviewData};
use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Arc, Condvar, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub output_dir: String,
    pub concurrency: usize,
    pub ffmpeg_path: String,
    pub qpdf_path: String,
    #[serde(default)]
    pub pdf_renderer_path: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self { output_dir: String::new(), concurrency: 1, ffmpeg_path: String::new(), qpdf_path: String::new(), pdf_renderer_path: String::new() }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JobRequest {
    pub kind: String,
    pub inputs: Vec<String>,
    pub output_dir: String,
    pub output_name: String,
    pub bitrate: u32,
    pub width: u32,
    pub fps: u32,
    pub start: f64,
    pub duration: Option<f64>,
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub image_width: u32,
    #[serde(default)]
    pub image_height: u32,
    #[serde(default = "default_true")]
    pub keep_aspect: bool,
    #[serde(default = "default_quality")]
    pub image_quality: u32,
    #[serde(default)]
    pub image_scale_percent: Option<u32>,
    #[serde(default = "default_quality")]
    pub video_quality: u32,
    #[serde(default)]
    pub video_height: u32,
    #[serde(default)]
    pub video_fps: u32,
    #[serde(default)]
    pub pages: String,
    #[serde(default)]
    pub operation: String,
    #[serde(default)]
    pub target_mb: f64,
    #[serde(default)]
    pub rotation: u32,
    #[serde(default)]
    pub crop_ratio: String,
    #[serde(default)]
    pub interval: f64,
    #[serde(default)]
    pub dpi: u32,
}
fn default_true() -> bool { true }
fn default_quality() -> u32 { 80 }

pub const IMAGE_FORMATS: &[&str] = &["png", "jpg", "webp", "bmp", "tiff"];
pub const IMAGE_INPUTS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"];
pub const AUDIO_FORMATS: &[&str] = &["mp3", "ogg", "wav", "flac", "m4a"];
pub const AUDIO_INPUTS: &[&str] = &["mp3", "ogg", "wav", "flac", "m4a", "aac", "opus", "aiff", "aif", "wma"];

pub fn output_extension(request: &JobRequest) -> &str {
    if toolbox::is_tool(request) { return toolbox::extension(request); }
    if ["image", "audio", "video"].contains(&request.kind.as_str()) { &request.format } else { &request.kind }
}

struct PreviewInner { revision: u64, active: usize, stopping: bool, cancelled: Arc<AtomicBool> }
pub struct PreviewManager { inner: Mutex<PreviewInner>, signal: Condvar }
pub struct PreviewGuard { manager: Arc<PreviewManager>, pub cancelled: Arc<AtomicBool> }
impl PreviewManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { inner: Mutex::new(PreviewInner { revision: 0, active: 0, stopping: false, cancelled: Arc::new(AtomicBool::new(false)) }), signal: Condvar::new() })
    }
    pub fn begin(self: &Arc<Self>, revision: u64) -> Result<PreviewGuard, String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.stopping || revision <= inner.revision { return Err("Cancelled".into()); }
        inner.cancelled.store(true, Ordering::Relaxed);
        inner.revision = revision;
        inner.cancelled = Arc::new(AtomicBool::new(false));
        inner.active += 1;
        Ok(PreviewGuard { manager: Arc::clone(self), cancelled: Arc::clone(&inner.cancelled) })
    }
    pub fn cancel(&self, revision: u64) {
        let inner = self.inner.lock().unwrap();
        if revision == inner.revision { inner.cancelled.store(true, Ordering::Relaxed); }
    }
    pub fn shutdown(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.stopping = true;
        inner.cancelled.store(true, Ordering::Relaxed);
        while inner.active > 0 { inner = self.signal.wait(inner).unwrap(); }
    }
}
impl Drop for PreviewGuard {
    fn drop(&mut self) {
        let mut inner = self.manager.inner.lock().unwrap();
        inner.active -= 1;
        self.manager.signal.notify_all();
    }
}

#[derive(Clone, Serialize, Debug)]
pub struct Job {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub status: String,
    pub progress: f64,
    pub output: Option<String>,
    #[serde(rename = "outputIsDirectory")]
    pub output_is_directory: bool,
    pub error: Option<String>,
    pub created: u64,
}

#[derive(Clone)]
pub struct Task {
    pub request: JobRequest,
    pub engine: PathBuf,
    pub folder: PathBuf,
    pub stem: String,
}

struct Entry { job: Job, task: Task, cancelled: Arc<AtomicBool> }
struct Inner { entries: Vec<Entry>, pending: VecDeque<String>, active: usize, concurrency: usize, stop: bool }
pub struct Queue { inner: Mutex<Inner>, signal: Condvar, workers: Mutex<Vec<JoinHandle<()>>> }
static SEQUENCE: AtomicU64 = AtomicU64::new(1);

impl Queue {
    pub fn new(concurrency: usize) -> Arc<Self> {
        let queue = Arc::new(Self {
            inner: Mutex::new(Inner { entries: vec![], pending: VecDeque::new(), active: 0, concurrency, stop: false }),
            signal: Condvar::new(), workers: Mutex::new(vec![]),
        });
        for _ in 0..4 {
            let copy = Arc::clone(&queue);
            queue.workers.lock().unwrap().push(thread::spawn(move || copy.worker()));
        }
        queue
    }

    fn worker(&self) {
        loop {
            let (id, task, cancelled) = {
                let mut inner = self.inner.lock().unwrap();
                loop {
                    if inner.stop { return; }
                    if inner.active < inner.concurrency {
                        if let Some(id) = inner.pending.pop_front() {
                            let entry = inner.entries.iter_mut().find(|e| e.job.id == id).unwrap();
                            if entry.cancelled.load(Ordering::Relaxed) { continue; }
                            entry.job.status = "running".into();
                            let work = (id, entry.task.clone(), Arc::clone(&entry.cancelled));
                            inner.active += 1;
                            break work;
                        }
                    }
                    inner = self.signal.wait(inner).unwrap();
                }
            };
            let result = run_task(&task, &cancelled, |value| {
                let mut inner = self.inner.lock().unwrap();
                if let Some(entry) = inner.entries.iter_mut().find(|e| e.job.id == id) {
                    entry.job.progress = value.clamp(0.0, 99.0);
                }
            });
            let mut inner = self.inner.lock().unwrap();
            if let Some(entry) = inner.entries.iter_mut().find(|e| e.job.id == id) {
                // Once an output is committed it is complete, even if cancellation arrived in that instant.
                match result {
                    Ok(path) => { entry.job.status = "completed".into(); entry.job.progress = 100.0; entry.job.output_is_directory = path.is_dir(); entry.job.output = Some(path.to_string_lossy().into()); }
                    Err(_) if cancelled.load(Ordering::Relaxed) => { entry.job.status = "cancelled".into(); }
                    Err(error) => { entry.job.status = "failed".into(); entry.job.error = Some(error); }
                }
            }
            inner.active -= 1;
            self.signal.notify_all();
        }
    }

    pub fn submit(&self, tasks: Vec<Task>) -> Vec<Job> {
        let mut inner = self.inner.lock().unwrap();
        let mut added = vec![];
        for task in tasks {
            let created = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
            let id = format!("{created}-{}", SEQUENCE.fetch_add(1, Ordering::Relaxed));
            let label = if task.request.kind == "pdf" { format!("{} documents → {}.pdf", task.request.inputs.len(), task.stem) }
                else { Path::new(&task.request.inputs[0]).file_name().unwrap_or_default().to_string_lossy().into() };
            let job = Job { id: id.clone(), kind: task.request.kind.clone(), label, status: "queued".into(), progress: 0.0, output: None, output_is_directory: false, error: None, created };
            added.push(job.clone());
            inner.entries.push(Entry { job, task, cancelled: Arc::new(AtomicBool::new(false)) });
            inner.pending.push_back(id);
        }
        self.signal.notify_all();
        added.reverse();
        added
    }
    pub fn jobs(&self) -> Vec<Job> { self.inner.lock().unwrap().entries.iter().rev().map(|e| e.job.clone()).collect() }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        let entry = inner.entries.iter_mut().find(|e| e.job.id == id).ok_or("Job not found")?;
        if entry.job.status == "queued" || entry.job.status == "running" {
            entry.cancelled.store(true, Ordering::Relaxed);
            if entry.job.status == "queued" { entry.job.status = "cancelled".into(); }
        }
        self.signal.notify_all();
        Ok(())
    }
    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap();
        let pending: Vec<String> = inner.entries.iter().filter(|e| e.job.status == "queued").map(|e| e.job.id.clone()).collect();
        inner.pending.retain(|id| pending.contains(id));
        inner.entries.retain(|e| e.job.status == "queued" || e.job.status == "running");
    }
    pub fn concurrency(&self, value: usize) { self.inner.lock().unwrap().concurrency = value; self.signal.notify_all(); }
    pub fn shutdown(&self) {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.stop = true;
            for entry in &inner.entries { entry.cancelled.store(true, Ordering::Relaxed); }
            self.signal.notify_all();
        }
        for worker in self.workers.lock().unwrap().drain(..) { let _ = worker.join(); }
    }
}

pub fn command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command.stdin(Stdio::null());
    command
}

// Engine discovery is bounded: an invalid/custom executable must not freeze the app.
pub fn output_with_timeout(mut cmd: Command, cancelled: Option<&AtomicBool>) -> Result<String, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let reader = thread::spawn(move || { let mut text = String::new(); let _ = stdout.take(65536).read_to_string(&mut text); text });
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let result = loop {
        if cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed)) || std::time::Instant::now() > deadline {
            let _ = child.kill(); let _ = child.wait(); break Err("Engine probe cancelled or timed out".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break if status.success() { Ok(()) } else { Err("Engine probe failed".into()) },
            Ok(None) => thread::sleep(Duration::from_millis(30)),
            Err(e) => { let _ = child.kill(); let _ = child.wait(); break Err(e.to_string()); }
        }
    };
    let text = reader.join().unwrap_or_default();
    result.map(|_| text)
}

pub fn validate(request: &JobRequest) -> Result<(), String> {
    if toolbox::is_tool(request) { return toolbox::validate_tool(request); }
    if !["mp3", "gif", "pdf", "image", "audio", "video"].contains(&request.kind.as_str()) { return Err("Unknown tool".into()); }
    if request.kind == "video" && (!["mp4", "mkv", "webm", "mov"].contains(&request.format.as_str()) || !(1..=100).contains(&request.video_quality) || ![0, 360, 480, 720, 1080, 1440, 2160].contains(&request.video_height) || ![0, 15, 24, 25, 30, 50, 60].contains(&request.video_fps)) { return Err("Invalid video settings.".into()); }
    if request.inputs.is_empty() || (request.kind == "pdf" && request.inputs.len() < 2) { return Err("Select source files first (at least two for PDF merging).".into()); }
    if (request.kind == "mp3" || request.kind == "audio") && ![128, 192, 320].contains(&request.bitrate) { return Err("Unsupported audio bitrate".into()); }
    if request.kind == "audio" && !AUDIO_FORMATS.contains(&request.format.as_str()) { return Err("Unsupported audio format".into()); }
    if request.kind == "image" {
        if request.image_scale_percent.is_some_and(|percent| !(1..=100).contains(&percent)) { return Err("Image resolution must be greater than 0% and at most 100%.".into()); }
        if !IMAGE_FORMATS.contains(&request.format.as_str()) { return Err("Unsupported image format".into()); }
        if !(1..=100).contains(&request.image_quality) { return Err("Image quality must be between 1 and 100.".into()); }
        if (request.image_width == 0) != (request.image_height == 0) || request.image_width > 16384 || request.image_height > 16384 || u64::from(request.image_width) * u64::from(request.image_height) > 100_000_000 { return Err("Set both dimensions, up to 16,384 pixels per side and 100 megapixels total.".into()); }
    }
    if request.kind == "gif" && (!request.start.is_finite() || request.start < 0.0 || request.duration.is_some_and(|value| !value.is_finite() || value < 0.1) || ![320,480,640,960,1280].contains(&request.width) || ![10,15,24,30].contains(&request.fps)) { return Err("Invalid GIF settings.".into()); }
    if request.kind == "pdf" { validate_name(&request.output_name)?; }
    for input in &request.inputs {
        let path = Path::new(input);
        if !path.is_absolute() || !path.is_file() { return Err(format!("File is unavailable: {input}")); }
        let extension = path.extension().unwrap_or_default().to_string_lossy().to_lowercase();
        let supported = match request.kind.as_str() {
            "pdf" => extension == "pdf",
            "image" => IMAGE_INPUTS.contains(&extension.as_str()),
            "audio" => AUDIO_INPUTS.contains(&extension.as_str()),
            _ => ["mp4","mov","mkv","webm","avi","m4v"].contains(&extension.as_str()),
        };
        if !supported { return Err(format!("Unsupported file: {input}")); }
    }
    Ok(())
}

pub fn validate_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    let base = name.split('.').next().unwrap_or_default().to_uppercase();
    if name.is_empty() || name.len() > 200 || name.ends_with('.') || name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || ["CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"].contains(&base.as_str()) {
        return Err("Choose a valid filename without special characters or reserved device names.".into());
    }
    Ok(())
}

fn media_input_args(request: &JobRequest) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats"].iter().map(|s| s.to_string()).collect();
    if request.kind == "gif" {
        if request.start > 0.0 { args.extend(["-ss".into(), request.start.to_string()]); }
        if let Some(duration) = request.duration { args.extend(["-t".into(), duration.to_string()]); }
    }
    args.extend(["-i".into(), request.inputs[0].clone()]);
    args
}

fn gif_scale(request: &JobRequest) -> String {
    format!("fps={},scale='min({},iw)':-1:flags=lanczos", request.fps, request.width)
}

fn palette_args(request: &JobRequest, output: &Path) -> Vec<String> {
    let mut args = media_input_args(request);
    args.extend(["-map".into(), "0:v:0".into(), "-vf".into(), format!("{},palettegen=stats_mode=diff", gif_scale(request)), "-frames:v".into(), "1".into(), "-update".into(), "1".into(), "-f".into(), "image2".into(), "-c:v".into(), "png".into(), output.to_string_lossy().into()]);
    args
}

pub fn media_args(request: &JobRequest, output: &Path, palette: Option<&Path>) -> Vec<String> {
    let mut args = media_input_args(request);
    if request.kind == "mp3" || request.kind == "audio" {
        args.extend(["-map".into(), "0:a:0".into(), "-vn".into()]);
        let format = output_extension(request);
        let (codec, muxer) = match format {
            "ogg" => ("libvorbis", "ogg"),
            "wav" => ("pcm_s16le", "wav"),
            "flac" => ("flac", "flac"),
            "m4a" => ("aac", "ipod"),
            _ => ("libmp3lame", "mp3"),
        };
        args.extend(["-c:a".into(), codec.into()]);
        if format == "ogg" {
            // Vorbis quality mode preserves source channels/rate without invalid mono bitrate targets.
            let quality = match request.bitrate { 128 => "4", 192 => "6", _ => "9" };
            args.extend(["-q:a".into(), quality.into()]);
        } else if !["wav", "flac"].contains(&format) { args.extend(["-b:a".into(), format!("{}k", request.bitrate)]); }
        if format == "m4a" { args.extend(["-movflags".into(), "+faststart".into()]); }
        args.extend(["-f".into(), muxer.into()]);
    } else {
        args.extend(["-i".into(), palette.expect("GIF encoding requires a palette").to_string_lossy().into()]);
        let filter = format!("[0:v:0]{}[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3[out]", gif_scale(request));
        args.extend(["-filter_complex".into(), filter, "-map".into(), "[out]".into(), "-an".into(), "-loop".into(), "0".into(), "-f".into(), "gif".into()]);
    }
    args.push(output.to_string_lossy().into());
    args
}

fn stop_child(child: &mut Child) { let _ = child.kill(); let _ = child.wait(); }

pub fn image_args(request: &JobRequest, output: &Path) -> Vec<String> {
    let mut args = media_input_args(request);
    args.extend(["-map".into(), "0:v:0".into(), "-frames:v".into(), "1".into(), "-an".into()]);
    if let Some(percent) = request.image_scale_percent {
        if percent < 100 {
            let filter = format!("scale=w='max(1,round(iw*{percent}/100))':h='max(1,round(ih*{percent}/100))':flags=lanczos");
            args.extend(["-vf".into(), filter]);
        }
    } else if request.image_width > 0 {
        let filter = format!("scale={}:{}:flags=lanczos{}", request.image_width, request.image_height, if request.keep_aspect { ":force_original_aspect_ratio=decrease" } else { "" });
        args.extend(["-vf".into(), filter]);
    }
    let codec = match request.format.as_str() { "jpg" => "mjpeg", "webp" => "libwebp", "bmp" => "bmp", "tiff" => "tiff", _ => "png" };
    args.extend(["-c:v".into(), codec.into()]);
    if request.format == "jpg" {
        let quality = 2 + (100 - request.image_quality) * 29 / 99;
        args.extend(["-q:v".into(), quality.to_string(), "-pix_fmt".into(), "yuvj444p".into()]);
    } else if request.format == "webp" {
        args.extend(["-quality".into(), request.image_quality.to_string()]);
    }
    args.extend(["-update".into(), "1".into(), "-f".into(), "image2".into(), output.to_string_lossy().into()]);
    args
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePreview { pub path: String, pub size: u64, pub width: u32, pub height: u32, pub source_width: u32, pub source_height: u32 }

fn image_dimensions(engine: &Path, input: &Path, cancelled: &AtomicBool) -> Result<(u32, u32), String> {
    let probe = engine.with_file_name(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
    let mut cmd = command(&probe);
    cmd.args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json"]).arg(input);
    let text = output_with_timeout(cmd, Some(cancelled)).map_err(|e| format!("Cannot read image dimensions (FFprobe is required): {e}"))?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let width = value["streams"][0]["width"].as_u64().ok_or("Invalid image dimensions")? as u32;
    let height = value["streams"][0]["height"].as_u64().ok_or("Invalid image dimensions")? as u32;
    Ok((width, height))
}

pub fn preview_images(request: &JobRequest, engine: &Path, cancelled: &AtomicBool) -> Result<Vec<ImagePreview>, String> {
    validate(request)?;
    if request.kind != "image" { return Err("Image preview requires images.".into()); }
    let mut previews = vec![];
    for input in &request.inputs {
        if cancelled.load(Ordering::Relaxed) { return Err("Cancelled".into()); }
        let (source_width, source_height) = image_dimensions(engine, Path::new(input), cancelled)?;
        let temporary = tempfile::Builder::new().prefix("convertor-preview-").suffix(".partial").tempfile().map_err(|e| e.to_string())?.into_temp_path();
        let mut single = request.clone(); single.inputs = vec![input.clone()];
        let mut cmd = command(engine); cmd.args(image_args(&single, &temporary));
        run_process(cmd, cancelled, 0.0, |_| {}, false)?;
        let (width, height) = image_dimensions(engine, &temporary, cancelled)?;
        let size = fs::metadata(&temporary).map_err(|e| e.to_string())?.len();
        previews.push(ImagePreview { path: input.clone(), size, width, height, source_width, source_height });
    }
    Ok(previews)
}

#[derive(Serialize, Debug)]
pub struct VideoEstimate { pub path: String, pub size: u64, pub width: u32, pub height: u32, pub fps: f64, pub bitrate: u32 }

fn video_plan(request: &JobRequest, engine: &Path, input: &str, cancelled: &AtomicBool) -> Result<(VideoEstimate, f64), String> {
    let probe = engine.with_file_name(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
    if !probe.is_file() { return Err("Place FFprobe beside FFmpeg to inspect and convert videos.".into()); }
    let mut cmd = command(&probe);
    cmd.args(["-v", "error", "-show_streams", "-show_format", "-of", "json", input]);
    let data: serde_json::Value = serde_json::from_str(&output_with_timeout(cmd, Some(cancelled))?).map_err(|e| e.to_string())?;
    let streams = data["streams"].as_array().ok_or("No media streams found")?;
    let video = streams.iter().find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1).ok_or("No video stream found")?;
    let mut width = video["width"].as_u64().unwrap_or(0) as f64;
    let mut height = video["height"].as_u64().unwrap_or(0) as f64;
    if let Some(sar) = video["sample_aspect_ratio"].as_str() {
        if let Some((a, b)) = sar.split_once(':') {
            if let (Ok(a), Ok(b)) = (a.parse::<f64>(), b.parse::<f64>()) { if a > 0.0 && b > 0.0 { width *= a / b; } }
        }
    }
    if video["side_data_list"].as_array().is_some_and(|items| items.iter().any(|item| item["rotation"].as_i64().is_some_and(|angle| angle.rem_euclid(180) == 90))) { std::mem::swap(&mut width, &mut height); }
    let rate = video["avg_frame_rate"].as_str().unwrap_or("0/1");
    let fps = rate.split_once('/').and_then(|(a, b)| Some(a.parse::<f64>().ok()? / b.parse::<f64>().ok()?)).unwrap_or(0.0);
    let duration = data["format"]["duration"].as_str().or_else(|| video["duration"].as_str()).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
    if !fps.is_finite() || fps <= 0.0 || width < 2.0 || height < 2.0 || !duration.is_finite() || duration <= 0.0 { return Err("Cannot determine this video's dimensions, frame rate, or duration.".into()); }
    let scale = if request.video_height == 0 { 1.0 } else { (f64::from(request.video_height) / height).min(1.0) };
    let width = ((width * scale / 2.0).round() as u32 * 2).max(2);
    let height = ((height * scale / 2.0).floor() as u32 * 2).max(2);
    let fps = if request.video_fps == 0 { fps } else { fps.min(f64::from(request.video_fps)) };
    // Target bits per pixel per frame: quality raises the bitrate at the selected dimensions/rate.
    let bitrate = ((f64::from(width) * f64::from(height) * fps * (0.025 + f64::from(request.video_quality) * 0.002) / 1000.0).round() as u32).clamp(100, 100_000);
    let audio = if streams.iter().any(|s| s["codec_type"] == "audio") { 128 } else { 0 };
    let size = (duration * f64::from(bitrate + audio) * 1000.0 / 8.0 * 1.02).round() as u64;
    Ok((VideoEstimate { path: input.into(), size, width, height, fps, bitrate }, duration))
}

pub fn estimate_videos(request: &JobRequest, engine: &Path) -> Result<Vec<VideoEstimate>, String> {
    if request.kind != "video" { return Err("Choose the video tool.".into()); }
    validate(request)?;
    request.inputs.iter().map(|input| video_plan(request, engine, input, &AtomicBool::new(false)).map(|(plan, _)| plan)).collect()
}

fn video_args(request: &JobRequest, plan: &VideoEstimate, output: &Path) -> Vec<String> {
    let mut args = media_input_args(request);
    args.extend(["-map".into(), "0:V:0".into(), "-map".into(), "0:a:0?".into(), "-vf".into(), format!("scale={}:{}:flags=lanczos,setsar=1,fps={}", plan.width, plan.height, plan.fps), "-pix_fmt".into(), "yuv420p".into(), "-b:v".into(), format!("{}k", plan.bitrate), "-b:a".into(), "128k".into()]);
    if request.format == "webm" {
        args.extend(["-c:v".into(), "libvpx-vp9".into(), "-deadline".into(), "good".into(), "-cpu-used".into(), "4".into(), "-c:a".into(), "libopus".into()]);
    } else {
        args.extend(["-c:v".into(), "libx264".into(), "-preset".into(), "medium".into(), "-c:a".into(), "aac".into()]);
    }
    if ["mp4", "mov"].contains(&request.format.as_str()) { args.extend(["-movflags".into(), "+faststart".into()]); }
    args.extend(["-f".into(), if request.format == "mkv" { "matroska".into() } else { request.format.clone() }, output.to_string_lossy().into()]);
    args
}

pub fn run_task(task: &Task, cancelled: &AtomicBool, mut progress: impl FnMut(f64)) -> Result<PathBuf, String> {
    if toolbox::is_tool(&task.request) { return toolbox::run(task, cancelled, progress); }
    if cancelled.load(Ordering::Relaxed) { return Err("Cancelled".into()); }
    let temporary = tempfile::Builder::new().prefix(".convertor-").suffix(".partial").tempfile_in(&task.folder).map_err(|e| format!("Cannot write to the output folder: {e}"))?.into_temp_path();
    let request = &task.request;
    let mut cmd = command(&task.engine);
    let mut duration = if request.kind == "gif" { request.duration.unwrap_or(0.0) } else { 0.0 };
    let mut palette = None;
    let mut argfile = None;
    if request.kind == "pdf" {
        // An argument file avoids Windows' command-line length limit on large merges.
        let mut file = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
        writeln!(file, "--empty\n--progress\n--pages").map_err(|e| e.to_string())?;
        for input in &request.inputs {
            if input.contains(['\n', '\r']) { return Err("PDF paths cannot contain line breaks.".into()); }
            writeln!(file, "{input}\n1-z").map_err(|e| e.to_string())?;
        }
        writeln!(file, "--\n{}", temporary.display()).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        let path = file.into_temp_path();
        cmd.arg(format!("@{}", path.display()));
        argfile = Some(path);
    } else if request.kind == "image" {
        cmd.args(image_args(request, &temporary));
    } else if request.kind == "video" {
        let (plan, seconds) = video_plan(request, &task.engine, &request.inputs[0], cancelled)?;
        duration = seconds;
        cmd.args(video_args(request, &plan, &temporary));
    } else {
        let probe = task.engine.with_file_name(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
        if probe.is_file() {
            let mut probe_cmd = command(&probe);
            probe_cmd.args(["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1", &request.inputs[0]]);
            if let Ok(text) = output_with_timeout(probe_cmd, Some(cancelled)) {
                if let Ok(seconds) = text.trim().parse::<f64>() {
                    if request.kind == "gif" {
                        if request.start >= seconds { return Err("The clip starts after the end of this video.".into()); }
                        duration = request.duration.unwrap_or(seconds - request.start).min(seconds - request.start);
                    } else { duration = seconds; }
                }
            }
        }
        if request.kind == "gif" {
            // Two streaming passes avoid keeping the full video's decoded frames in RAM.
            let palette_path = tempfile::Builder::new().prefix(".convertor-palette-").suffix(".png").tempfile_in(&task.folder).map_err(|e| e.to_string())?.into_temp_path();
            let mut palette_cmd = command(&task.engine);
            palette_cmd.args(palette_args(request, &palette_path));
            run_process(palette_cmd, cancelled, duration, |value| progress(value * 0.4), false)?;
            palette = Some(palette_path);
        }
        cmd.args(media_args(request, &temporary, palette.as_deref()));
    }
    if request.kind == "gif" {
        progress(40.0);
        run_process(cmd, cancelled, duration, |value| progress(40.0 + value * 0.6), false)?;
    } else {
        run_process(cmd, cancelled, duration, &mut progress, request.kind == "pdf")?;
    }
    drop(palette);
    drop(argfile);
    if cancelled.load(Ordering::Relaxed) { return Err("Cancelled".into()); }
    if fs::metadata(&temporary).map_err(|e| e.to_string())?.len() == 0 { return Err("The engine produced an empty file. Check that the input contains the required audio or video stream.".into()); }
    commit_output(temporary, &task.folder, &task.stem, output_extension(request))
}

fn run_process(mut cmd: Command, cancelled: &AtomicBool, duration: f64, mut progress: impl FnMut(f64), allow_warnings: bool) -> Result<(), String> {
    if cancelled.load(Ordering::Relaxed) { return Err("Cancelled".into()); }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("Unable to start the conversion engine: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let value = if let Some(time) = line.strip_prefix("out_time_us=") { time.parse::<f64>().ok().filter(|_| duration > 0.0).map(|t| t / 1_000_000.0 / duration * 100.0) }
                else { line.split('%').next().and_then(|part| part.split_whitespace().last()).and_then(|p| p.parse::<f64>().ok()) };
            if let Some(value) = value { let _ = tx.send(value); }
        }
    });
    let errors = thread::spawn(move || {
        let mut tail = VecDeque::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if tail.len() == 8 { tail.pop_front(); }
            tail.push_back(line.chars().take(1000).collect::<String>());
        }
        tail.into_iter().collect::<Vec<_>>().join("\n")
    });
    let result = loop {
        for value in rx.try_iter() { progress(value); }
        if cancelled.load(Ordering::Relaxed) { stop_child(&mut child); break Err("Cancelled".into()); }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(e) => { stop_child(&mut child); break Err(e.to_string()); }
        }
    };
    let _ = reader.join();
    let error = errors.join().unwrap_or_default();
    let status = result?;
    if !status.success() && !(allow_warnings && status.code() == Some(3)) {
        return Err(if error.is_empty() { format!("Conversion failed ({status}).") } else { error });
    }
    Ok(())
}

fn commit_output(mut temporary: tempfile::TempPath, folder: &Path, stem: &str, extension: &str) -> Result<PathBuf, String> {
    for number in 0..10000 {
        let filename = if number == 0 { format!("{stem}.{extension}") } else { format!("{stem} ({number}).{extension}") };
        let target = folder.join(filename);
        // Atomic no-clobber commit also handles multiple workers choosing the same output name.
        match temporary.persist_noclobber(&target) {
            Ok(()) => return Ok(target),
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => { temporary = error.path; }
            Err(error) => return Err(format!("Could not save output: {}", error.error)),
        }
    }
    Err("Too many files with this output name. Choose another folder or filename.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(kind: &str) -> JobRequest { JobRequest { kind: kind.into(), inputs: vec!["C:\\Videos\\clip with spaces.mp4".into()], output_dir: String::new(), output_name: "Merged document".into(), bitrate: 192, width: 640, fps: 15, start: 2.0, duration: Some(5.0), format: String::new(), image_width: 0, image_height: 0, keep_aspect: true, image_quality: 80, image_scale_percent: None, video_quality: 65, video_height: 0, video_fps: 0, pages: String::new(), operation: String::new(), target_mb: 10.0, rotation: 0, crop_ratio: String::new(), interval: 5.0, dpi: 150 } }
    #[test]
    fn output_never_overwrites_existing_files() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("clip.mp3"), b"original").unwrap();
        let mut temp = tempfile::NamedTempFile::new_in(folder.path()).unwrap();
        temp.write_all(b"converted").unwrap();
        let output = commit_output(temp.into_temp_path(), folder.path(), "clip", "mp3").unwrap();
        assert_eq!(output.file_name().unwrap(), "clip (1).mp3");
        assert_eq!(fs::read(folder.path().join("clip.mp3")).unwrap(), b"original");
        assert_eq!(fs::read(output).unwrap(), b"converted");
    }
    #[test]
    fn rejects_path_traversal_and_windows_reserved_names() {
        for name in ["../escape", "C:\\other", "CON", "LPT1.txt", "", "bad.", "bad\nname"] { assert!(validate_name(name).is_err(), "{name}"); }
        assert!(validate_name("My merged document").is_ok());
    }
    #[test]
    fn ffmpeg_arguments_preserve_paths_and_explicit_formats() {
        let request = request("mp3");
        let args = media_args(&request, Path::new("C:\\Output\\temp.partial"), None);
        assert!(args.contains(&request.inputs[0]));
        assert!(args.windows(2).any(|a| a == ["-map", "0:a:0"]));
        assert!(args.windows(2).any(|a| a == ["-f", "mp3"]));
        let gif = media_args(&self::request("gif"), Path::new("out.partial"), Some(Path::new("palette.png")));
        assert!(gif.iter().any(|arg| arg.contains("paletteuse")));
        assert!(palette_args(&self::request("gif"), Path::new("palette.png")).iter().any(|arg| arg.contains("palettegen")));
        assert!(gif.windows(2).any(|a| a == ["-ss", "2"]));
        assert!(gif.iter().position(|s| s == "-t").unwrap() < gif.iter().position(|s| s == "-i").unwrap());
    }

    fn native_engine(name: &str) -> PathBuf {
        let folder = std::env::var_os("CONVERTOR_ENGINE_DIR").expect("Set CONVERTOR_ENGINE_DIR to run native tests");
        PathBuf::from(folder).join(if cfg!(windows) { format!("{name}.exe") } else { name.into() })
    }
    #[test]
    fn video_settings_reject_invalid_values() {
        let mut req = request("video"); req.format = "mp4".into();
        for (quality, height, fps) in [(0, 0, 0), (101, 0, 0), (65, 999, 0), (65, 0, 999)] {
            req.video_quality = quality; req.video_height = height; req.video_fps = fps;
            assert_eq!(validate(&req).unwrap_err(), "Invalid video settings.");
        }
        req.video_quality = 65; req.video_height = 0; req.video_fps = 0; req.format = "exe".into();
        assert_eq!(validate(&req).unwrap_err(), "Invalid video settings.");
    }
    #[test]
    #[ignore = "Requires native FFmpeg and FFprobe; set CONVERTOR_ENGINE_DIR"]
    fn native_video_formats_estimates_and_limits() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("source video.mp4");
        let result = command(&native_engine("ffmpeg")).args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x480:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "1", "-c:v", "libx264", "-c:a", "aac"]).arg(&source).output().unwrap();
        assert!(result.status.success());
        let mut req = request("video"); req.inputs = vec![source.to_string_lossy().into()]; req.format = "mp4".into(); req.video_height = 360; req.video_fps = 15;
        let plans = estimate_videos(&req, &native_engine("ffmpeg")).unwrap();
        assert_eq!((plans[0].width, plans[0].height, plans[0].fps), (480, 360, 15.0));
        req.video_quality = 10;
        assert!(estimate_videos(&req, &native_engine("ffmpeg")).unwrap()[0].size < plans[0].size);
        req.video_quality = 65;
        for format in ["mp4", "mkv", "webm", "mov"] {
            req.format = format.into();
            let task = Task { request: req.clone(), engine: native_engine("ffmpeg"), folder: folder.path().to_path_buf(), stem: format!("converted {format}") };
            let output = run_task(&task, &AtomicBool::new(false), |_| {}).unwrap();
            let result = command(&native_engine("ffprobe")).args(["-v", "error", "-show_streams", "-show_format", "-of", "json"]).arg(&output).output().unwrap();
            let data: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
            let streams = data["streams"].as_array().unwrap();
            let video = streams.iter().find(|s| s["codec_type"] == "video").unwrap();
            assert_eq!(video["width"], 480); assert_eq!(video["height"], 360);
            assert_eq!(video["avg_frame_rate"], "15/1");
            assert_eq!(video["codec_name"], if format == "webm" { "vp9" } else { "h264" });
            assert!(streams.iter().any(|s| s["codec_type"] == "audio"));
            let seconds = data["format"]["duration"].as_str().unwrap().parse::<f64>().unwrap();
            assert!((seconds - 1.0).abs() < 0.2);
            assert!(command(&native_engine("ffmpeg")).args(["-v", "error", "-i"]).arg(&output).args(["-f", "null", "-"]).output().unwrap().status.success());
        }
        let silent = folder.path().join("silent.mp4");
        assert!(command(&native_engine("ffmpeg")).arg("-i").arg(&source).args(["-c:v", "copy", "-an"]).arg(&silent).output().unwrap().status.success());
        req.inputs = vec![silent.to_string_lossy().into()]; req.format = "webm".into(); req.video_height = 1080; req.video_fps = 60;
        let plans = estimate_videos(&req, &native_engine("ffmpeg")).unwrap();
        assert_eq!((plans[0].width, plans[0].height, plans[0].fps), (640, 480, 30.0));
        let task = Task { request: req, engine: native_engine("ffmpeg"), folder: folder.path().to_path_buf(), stem: "silent result".into() };
        assert!(run_task(&task, &AtomicBool::new(false), |_| {}).is_ok());
    }
    fn fixture_video(folder: &Path) -> PathBuf {
        fixture_video_length(folder, "2")
    }
    fn fixture_video_length(folder: &Path, seconds: &str) -> PathBuf {
        let path = folder.join("test clip with spaces.mp4");
        let output = command(&native_engine("ffmpeg")).args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=15", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", seconds, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]).arg(&path).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        path
    }
    fn fixture_pdf(path: &Path, width: u32) {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".into(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
            format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} 400] /Resources << >> /Contents 4 0 R >>"),
            "<< /Length 0 >>\nstream\n\nendstream".into(),
        ];
        let mut data = String::from("%PDF-1.4\n");
        let mut offsets = vec![0];
        for (index, object) in objects.iter().enumerate() {
            offsets.push(data.len()); data.push_str(&format!("{} 0 obj\n{object}\nendobj\n", index + 1));
        }
        let xref = data.len();
        data.push_str("xref\n0 5\n0000000000 65535 f \n");
        for offset in offsets.iter().skip(1) { data.push_str(&format!("{offset:010} 00000 n \n")); }
        data.push_str(&format!("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"));
        fs::write(path, data).unwrap();
    }
    #[test]
    #[ignore = "Requires native FFmpeg and qpdf; set CONVERTOR_ENGINE_DIR"]
    fn native_image_percentage_scaling_uses_each_source_dimensions() {
        let folder = tempfile::tempdir().unwrap();
        let mut inputs = vec![];
        for (index, dimensions) in ["160x120", "240x80"].iter().enumerate() {
            let source = folder.path().join(format!("source {index}.png"));
            let result = command(&native_engine("ffmpeg")).args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", &format!("testsrc2=size={dimensions}"), "-frames:v", "1"]).arg(&source).output().unwrap();
            assert!(result.status.success());
            inputs.push(source.to_string_lossy().into());
        }
        let mut request = request("image"); request.inputs = inputs; request.format = "png".into();
        request.image_scale_percent = Some(50);
        let previews = preview_images(&request, &native_engine("ffmpeg"), &AtomicBool::new(false)).unwrap();
        for (preview, dimensions) in previews.iter().zip([(80, 60), (120, 40)]) {
            assert_eq!((preview.width, preview.height), dimensions);
            let mut single = request.clone(); single.inputs = vec![preview.path.clone()];
            let task = Task { request: single, engine: native_engine("ffmpeg"), folder: folder.path().to_path_buf(), stem: "scaled".into() };
            let output = run_task(&task, &AtomicBool::new(false), |_| {}).unwrap();
            assert_eq!(fs::metadata(output).unwrap().len(), preview.size);
        }
        request.image_scale_percent = Some(100);
        let originals = preview_images(&request, &native_engine("ffmpeg"), &AtomicBool::new(false)).unwrap();
        assert_eq!((originals[0].width, originals[0].height), (160, 120));
        request.image_scale_percent = Some(1);
        let tiny = preview_images(&request, &native_engine("ffmpeg"), &AtomicBool::new(false)).unwrap();
        assert!(tiny.iter().all(|image| image.width >= 1 && image.height >= 1));
        for percent in [0, 101] { request.image_scale_percent = Some(percent); assert!(validate(&request).is_err()); }
    }
    #[test]
    fn preview_manager_cancels_stale_work() {
        let manager = PreviewManager::new();
        let first = manager.begin(10).unwrap();
        let second = manager.begin(11).unwrap();
        assert!(first.cancelled.load(Ordering::Relaxed));
        assert!(!second.cancelled.load(Ordering::Relaxed));
        manager.cancel(10);
        assert!(!second.cancelled.load(Ordering::Relaxed));
        assert!(manager.begin(9).is_err());
        manager.cancel(11);
        assert!(second.cancelled.load(Ordering::Relaxed));
        drop(first); drop(second); manager.shutdown();
        assert!(manager.begin(12).is_err());
    }
    #[test]
    #[ignore = "Requires native FFmpeg and qpdf; set CONVERTOR_ENGINE_DIR"]
    fn native_images_formats_resizing_and_exact_preview_sizes() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("image source café.png");
        let result = command(&native_engine("ffmpeg")).args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120", "-frames:v", "1"]).arg(&source).output().unwrap();
        assert!(result.status.success());
        let original = fs::read(&source).unwrap();
        for format in IMAGE_FORMATS {
            let mut request = request("image");
            request.inputs = vec![source.to_string_lossy().into()]; request.format = (*format).into();
            request.image_width = 80; request.image_height = 80;
            validate(&request).unwrap();
            let preview = preview_images(&request, &native_engine("ffmpeg"), &AtomicBool::new(false)).unwrap();
            assert_eq!((preview[0].width, preview[0].height), (80, 60));
            assert_eq!((preview[0].source_width, preview[0].source_height), (160, 120));
            let mut task = Task { request, engine: native_engine("ffmpeg"), folder: folder.path().to_path_buf(), stem: "converted".into() };
            let output = run_task(&task, &AtomicBool::new(false), |_| {}).unwrap();
            assert_eq!(output.extension().unwrap().to_string_lossy(), *format);
            assert_eq!(fs::metadata(&output).unwrap().len(), preview[0].size);
            // Every exported format can also be imported and resized exactly.
            task.request.inputs = vec![output.to_string_lossy().into()]; task.request.format = "png".into();
            task.request.keep_aspect = false; task.request.image_height = 50;
            let exact = run_task(&task, &AtomicBool::new(false), |_| {}).unwrap();
            assert_eq!(image_dimensions(&task.engine, &exact, &AtomicBool::new(false)).unwrap(), (80, 50));
        }
        assert_eq!(fs::read(source).unwrap(), original);
        assert!(!fs::read_dir(folder.path()).unwrap().any(|p| p.unwrap().file_name().to_string_lossy().starts_with(".convertor-")));
    }
    #[test]
    #[ignore = "Requires native FFmpeg and qpdf; set CONVERTOR_ENGINE_DIR"]
    fn native_audio_formats_and_round_trips() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("audio source.wav");
        let result = command(&native_engine("ffmpeg")).args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1"]).arg(&source).output().unwrap();
        assert!(result.status.success());
        let original = fs::read(&source).unwrap();
        for (format, codec) in AUDIO_FORMATS.iter().zip(["mp3", "vorbis", "pcm_s16le", "flac", "aac"]) {
            let mut request = request("audio"); request.inputs = vec![source.to_string_lossy().into()]; request.format = (*format).into();
            validate(&request).unwrap();
            let mut task = Task { request, engine: native_engine("ffmpeg"), folder: folder.path().to_path_buf(), stem: "converted".into() };
            let output = run_task(&task, &AtomicBool::new(false), |_| {}).unwrap();
            assert_eq!(output.extension().unwrap().to_string_lossy(), *format);
            let mut probe = command(&native_engine("ffprobe"));
            probe.args(["-v", "error", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1"]).arg(&output);
            assert_eq!(output_with_timeout(probe, None).unwrap().trim(), codec);
            if !["wav", "flac"].contains(format) {
                for bitrate in [128, 320] {
                    let mut quality_task = task.clone(); quality_task.request.bitrate = bitrate;
                    assert!(run_task(&quality_task, &AtomicBool::new(false), |_| {}).is_ok(), "{format} at preset {bitrate}");
                }
            }
            task.request.inputs = vec![output.to_string_lossy().into()]; task.request.format = "wav".into();
            assert!(run_task(&task, &AtomicBool::new(false), |_| {}).is_ok());
        }
        assert_eq!(fs::read(source).unwrap(), original);
    }
    #[test]
    fn full_video_has_no_seek_or_duration_limit() {
        let mut request = request("gif");
        request.start = 0.0;
        request.duration = None;
        for args in [media_args(&request, Path::new("out.gif"), Some(Path::new("palette.png"))), palette_args(&request, Path::new("palette.png"))] {
            assert!(!args.iter().any(|arg| arg == "-t" || arg == "-ss"));
        }
    }
    #[test]
    #[ignore = "Requires native FFmpeg and qpdf; set CONVERTOR_ENGINE_DIR"]
    fn native_full_video_gif_preserves_duration() {
        let folder = tempfile::tempdir().unwrap();
        let source = fixture_video_length(folder.path(), "7");
        let mut request = request("gif");
        request.inputs = vec![source.to_string_lossy().into()];
        request.start = 0.0; request.duration = None;
        let task = Task { request, engine: native_engine("ffmpeg"), folder: folder.path().to_path_buf(), stem: "full video".into() };
        let output = run_task(&task, &AtomicBool::new(false), |_| {}).unwrap();
        let mut probe = command(&native_engine("ffprobe"));
        probe.args(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1"]).arg(output);
        let duration: f64 = output_with_timeout(probe, None).unwrap().trim().parse().unwrap();
        assert!((duration - 7.0).abs() < 0.15, "GIF duration was {duration}");
        assert!(!fs::read_dir(folder.path()).unwrap().any(|p| p.unwrap().file_name().to_string_lossy().starts_with(".convertor-")));
    }
    #[test]
    #[ignore = "Requires native FFmpeg and qpdf; set CONVERTOR_ENGINE_DIR"]
    fn native_media_conversions_and_collision_handling() {
        let folder = tempfile::tempdir().unwrap();
        let source = fixture_video(folder.path());
        let original = fs::read(&source).unwrap();
        for kind in ["mp3", "gif"] {
            let mut request = request(kind);
            request.inputs = vec![fs::canonicalize(&source).unwrap().to_string_lossy().into()];
            request.start = 0.5; request.duration = Some(1.0);
            let task = Task { request, engine: native_engine("ffmpeg"), folder: folder.path().to_path_buf(), stem: "converted".into() };
            let output = run_task(&task, &AtomicBool::new(false), |_| {}).unwrap();
            let mut probe = command(&native_engine("ffprobe"));
            probe.args(["-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json"]).arg(&output);
            let details: serde_json::Value = serde_json::from_str(&output_with_timeout(probe, None).unwrap()).unwrap();
            assert_eq!(details["streams"][0]["codec_name"], kind);
            if kind == "gif" { assert_eq!(details["streams"][0]["width"], 160); }
            let length: f64 = details["format"]["duration"].as_str().unwrap().parse().unwrap();
            assert!((length - if kind == "gif" { 1.0 } else { 2.0 }).abs() < 0.25);
            let second = run_task(&task, &AtomicBool::new(false), |_| {}).unwrap();
            assert_ne!(output, second);
        }
        assert_eq!(fs::read(source).unwrap(), original);
        assert!(!fs::read_dir(folder.path()).unwrap().any(|p| p.unwrap().file_name().to_string_lossy().ends_with(".partial")));
    }
    #[test]
    #[ignore = "Requires native FFmpeg and qpdf; set CONVERTOR_ENGINE_DIR"]
    fn native_pdf_merge_preserves_page_order() {
        let folder = tempfile::tempdir().unwrap();
        let first = folder.path().join("first document café.pdf");
        let second = folder.path().join("second document.pdf");
        fixture_pdf(&first, 200); fixture_pdf(&second, 300);
        let mut request = request("pdf");
        request.inputs = vec![fs::canonicalize(&second).unwrap().to_string_lossy().into(), fs::canonicalize(&first).unwrap().to_string_lossy().into()];
        let task = Task { request, engine: native_engine("qpdf"), folder: folder.path().to_path_buf(), stem: "merged".into() };
        let output = run_task(&task, &AtomicBool::new(false), |_| {}).unwrap();
        let mut cmd = command(&native_engine("qpdf"));
        cmd.arg("--show-npages").arg(&output);
        assert_eq!(output_with_timeout(cmd, None).unwrap().trim(), "2");
        let mut cmd = command(&native_engine("qpdf"));
        cmd.arg("--show-pages").arg(&output);
        let pages = output_with_timeout(cmd, None).unwrap();
        let refs: Vec<_> = pages.lines().filter(|line| line.starts_with("page ")).map(|line| line.split(": ").nth(1).unwrap().split_whitespace().next().unwrap().to_string()).collect();
        assert_eq!(refs.len(), 2);
        for (id, width) in refs.iter().zip([300, 200]) {
            let mut cmd = command(&native_engine("qpdf"));
            cmd.arg(format!("--show-object={id}")).arg(&output);
            let object = output_with_timeout(cmd, None).unwrap();
            assert!(object.contains(&format!("/MediaBox [ 0 0 {width} 400 ]")), "{object}");
        }
    }
    #[test]
    #[ignore = "Requires native FFmpeg and qpdf; set CONVERTOR_ENGINE_DIR"]
    fn native_cancellation_and_invalid_input_leave_no_outputs() {
        let folder = tempfile::tempdir().unwrap();
        let source = fixture_video(folder.path());
        let mut request = request("gif");
        request.inputs = vec![source.to_string_lossy().into()]; request.start = 0.0; request.duration = Some(1.0);
        let task = Task { request, engine: native_engine("ffmpeg"), folder: folder.path().to_path_buf(), stem: "cancelled".into() };
        let flag = AtomicBool::new(false);
        assert!(run_task(&task, &flag, |value| { if value >= 40.0 { flag.store(true, Ordering::Relaxed); } }).is_err());
        assert!(!folder.path().join("cancelled.gif").exists());
        let mut bad_task = task.clone();
        let bad = folder.path().join("broken.mp4"); fs::write(&bad, b"not a video").unwrap();
        bad_task.request.inputs = vec![bad.to_string_lossy().into()];
        assert!(run_task(&bad_task, &AtomicBool::new(false), |_| {}).is_err());
        assert!(!fs::read_dir(folder.path()).unwrap().any(|p| p.unwrap().file_name().to_string_lossy().starts_with(".convertor-")));
    }
    #[test]
    fn clearing_cancelled_pending_jobs_is_safe() {
        let queue = Queue::new(0); // Pause workers to exercise a queued cancellation deterministically.
        let job = queue.submit(vec![Task { request: request("mp3"), engine: PathBuf::from("unused"), folder: PathBuf::from("unused"), stem: "clip".into() }]).remove(0);
        queue.cancel(&job.id).unwrap();
        assert_eq!(queue.jobs()[0].status, "cancelled");
        queue.clear();
        assert!(queue.jobs().is_empty());
        queue.concurrency(1);
        queue.shutdown();
    }
}
