#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod engine;
use engine::{ImagePreview, Job, JobRequest, PreviewManager, Queue, Settings, Task};
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, sync::{Arc, Mutex}};
use tauri::Manager;

struct AppState { queue: Arc<Queue>, preview: Arc<PreviewManager>, settings: Mutex<Settings>, config: PathBuf, resources: PathBuf }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo { settings: Settings, engines: Vec<EngineInfo>, cpu_count: usize }
#[derive(Serialize)]
struct EngineInfo { name: String, path: Option<String>, version: Option<String> }
#[derive(Serialize)]
struct InputFile { path: String, name: String, size: u64 }

fn find_engine(name: &str, custom: &str, resources: &Path) -> Option<PathBuf> {
    if !custom.trim().is_empty() {
        let path = PathBuf::from(custom.trim());
        return if path.is_absolute() && path.is_file() { Some(path) } else { None };
    }
    let executable = if cfg!(windows) { format!("{name}.exe") } else { name.into() };
    let mut folders = vec![resources.join("binaries"), PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries")];
    if let Ok(current) = std::env::current_exe() { if let Some(parent) = current.parent() { folders.push(parent.join("binaries")); folders.push(parent.to_path_buf()); } }
    if let Some(path) = std::env::var_os("PATH") { folders.extend(std::env::split_paths(&path)); }
    folders.into_iter().map(|folder| folder.join(&executable)).find(|path| path.is_file())
}
fn info(settings: Settings, resources: &Path) -> AppInfo {
    let engines = [("FFmpeg", "ffmpeg", &settings.ffmpeg_path), ("qpdf", "qpdf", &settings.qpdf_path)].into_iter().map(|(display, name, custom)| {
        let path = find_engine(name, custom, resources);
        let version = path.as_ref().and_then(|path| {
            let mut cmd = engine::command(path); cmd.arg(if name == "ffmpeg" { "-version" } else { "--version" });
            engine::output_with_timeout(cmd, None).ok().and_then(|text| text.lines().next().map(|s| s.chars().take(120).collect::<String>()))
        });
        EngineInfo { name: display.into(), path: if version.is_some() { path.map(|p| p.to_string_lossy().into()) } else { None }, version }
    }).collect();
    AppInfo { settings, engines, cpu_count: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) }
}

#[tauri::command]
async fn app_info(state: tauri::State<'_, AppState>) -> Result<AppInfo, String> {
    let settings = state.settings.lock().unwrap().clone();
    let resources = state.resources.clone();
    tauri::async_runtime::spawn_blocking(move || info(settings, &resources)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_settings(settings: Settings, state: tauri::State<'_, AppState>) -> Result<AppInfo, String> {
    if !(1..=4).contains(&settings.concurrency) { return Err("Choose between one and four simultaneous jobs.".into()); }
    if !settings.output_dir.is_empty() && !Path::new(&settings.output_dir).is_dir() { return Err("The output folder does not exist.".into()); }
    for custom in [&settings.ffmpeg_path, &settings.qpdf_path] {
        if !custom.trim().is_empty() && (!Path::new(custom.trim()).is_absolute() || !Path::new(custom.trim()).is_file()) { return Err("Choose an existing executable using an absolute path.".into()); }
    }
    let data = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    let folder = state.config.parent().unwrap();
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(folder).map_err(|e| e.to_string())?;
    use std::io::Write;
    temporary.write_all(&data).map_err(|e| e.to_string())?;
    temporary.persist(&state.config).map_err(|e| e.to_string())?;
    *state.settings.lock().unwrap() = settings.clone();
    state.queue.concurrency(settings.concurrency);
    let resources = state.resources.clone();
    tauri::async_runtime::spawn_blocking(move || info(settings, &resources)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_files(extensions: Vec<String>) -> Result<Vec<InputFile>, String> {
    let selected = rfd::AsyncFileDialog::new().set_title("Choose source files").add_filter("Supported files", &extensions).pick_files().await;
    inspect_files(selected.unwrap_or_default().iter().map(|file| file.path().to_string_lossy().into()).collect())
}
#[tauri::command]
fn inspect_files(paths: Vec<String>) -> Result<Vec<InputFile>, String> {
    paths.into_iter().map(|path| {
        let canonical = dunce::canonicalize(&path).map_err(|e| format!("Cannot read {path}: {e}"))?;
        let metadata = fs::metadata(&canonical).map_err(|e| e.to_string())?;
        if !metadata.is_file() { return Err("Choose files, rather than folders.".into()); }
        Ok(InputFile { name: canonical.file_name().unwrap_or_default().to_string_lossy().into(), path: canonical.to_string_lossy().into(), size: metadata.len() })
    }).collect()
}
#[tauri::command]
async fn pick_folder() -> Option<String> { rfd::AsyncFileDialog::new().set_title("Choose output folder").pick_folder().await.map(|f| f.path().to_string_lossy().into()) }
#[tauri::command]
async fn pick_executable() -> Option<String> {
    let dialog = rfd::AsyncFileDialog::new().set_title("Choose processing engine");
    #[cfg(windows)] let dialog = dialog.add_filter("Executable", &["exe"]);
    dialog.pick_file().await.map(|f| f.path().to_string_lossy().into())
}

#[tauri::command]
fn enqueue(mut request: JobRequest, state: tauri::State<'_, AppState>) -> Result<Vec<Job>, String> {
    // Canonical paths prevent relative filenames from being interpreted as engine switches.
    for input in &mut request.inputs { *input = dunce::canonicalize(&input).map_err(|e| format!("Cannot open {input}: {e}"))?.to_string_lossy().into(); }
    engine::validate(&request)?;
    let settings = state.settings.lock().unwrap().clone();
    let name = if request.kind == "pdf" { "qpdf" } else { "ffmpeg" };
    let engine = find_engine(name, if name == "qpdf" { &settings.qpdf_path } else { &settings.ffmpeg_path }, &state.resources).ok_or(format!("{name} is not available. Set its path in Settings."))?;
    let groups: Vec<Vec<String>> = if request.kind == "pdf" { vec![request.inputs.clone()] } else { request.inputs.iter().map(|input| vec![input.clone()]).collect() };
    let mut tasks = vec![];
    for inputs in groups {
        let source = Path::new(&inputs[0]);
        let folder = if request.output_dir.is_empty() { source.parent().unwrap().to_path_buf() } else { dunce::canonicalize(&request.output_dir).map_err(|e| format!("Output folder unavailable: {e}"))? };
        if !folder.is_dir() { return Err("The output path must be a folder.".into()); }
        let stem = if request.kind == "pdf" { request.output_name.trim().trim_end_matches(".pdf").to_string() } else { source.file_stem().unwrap_or_default().to_string_lossy().into() };
        engine::validate_name(&stem)?;
        let mut job_request = request.clone(); job_request.inputs = inputs;
        tasks.push(Task { request: job_request, engine: engine.clone(), folder, stem });
    }
    Ok(state.queue.submit(tasks))
}
#[tauri::command]
async fn preview_images(mut request: JobRequest, revision: u64, state: tauri::State<'_, AppState>) -> Result<Vec<ImagePreview>, String> {
    let guard = state.preview.begin(revision)?;
    for input in &mut request.inputs { *input = dunce::canonicalize(&input).map_err(|e| e.to_string())?.to_string_lossy().into(); }
    engine::validate(&request)?;
    let settings = state.settings.lock().unwrap().clone();
    let engine = find_engine("ffmpeg", &settings.ffmpeg_path, &state.resources).ok_or("FFmpeg not found")?;
    tauri::async_runtime::spawn_blocking(move || { let result = engine::preview_images(&request, &engine, &guard.cancelled); drop(guard); result }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn cancel_image_preview(revision: u64, state: tauri::State<'_, AppState>) { state.preview.cancel(revision); }

#[tauri::command]
async fn estimate_videos(request: JobRequest, state: tauri::State<'_, AppState>) -> Result<Vec<engine::VideoEstimate>, String> {
    let settings = state.settings.lock().unwrap().clone();
    let engine = find_engine("ffmpeg", &settings.ffmpeg_path, &state.resources).ok_or("FFmpeg not found")?;
    tauri::async_runtime::spawn_blocking(move || engine::estimate_videos(&request, &engine)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_jobs(state: tauri::State<'_, AppState>) -> Vec<Job> { state.queue.jobs() }
#[tauri::command]
fn cancel_job(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> { state.queue.cancel(&id) }
#[tauri::command]
fn clear_finished(state: tauri::State<'_, AppState>) { state.queue.clear(); }
#[tauri::command]
fn reveal_file(path: String) -> Result<(), String> {
    let path = dunce::canonicalize(path).map_err(|e| e.to_string())?;
    let folder = if path.is_dir() { path.as_path() } else { path.parent().ok_or("Output folder not found")? };
    #[cfg(windows)] let result = engine::command(Path::new("explorer.exe")).arg(folder).spawn();
    #[cfg(target_os = "macos")] let result = engine::command(Path::new("open")).arg(folder).spawn();
    #[cfg(target_os = "linux")] let result = engine::command(Path::new("xdg-open")).arg(folder).spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
    let app = tauri::Builder::default().setup(|app| {
        let config = app.path().app_config_dir()?.join("settings.json");
        let mut settings: Settings = fs::read(&config).ok().and_then(|data| serde_json::from_slice(&data).ok()).unwrap_or_default();
        settings.concurrency = settings.concurrency.clamp(1, 4);
        app.manage(AppState { queue: Queue::new(settings.concurrency), preview: PreviewManager::new(), settings: Mutex::new(settings), config, resources: app.path().resource_dir()? });
        Ok(())
    }).invoke_handler(tauri::generate_handler![app_info, save_settings, pick_files, inspect_files, pick_folder, pick_executable, enqueue, list_jobs, cancel_job, clear_finished, reveal_file, preview_images, cancel_image_preview, estimate_videos])
        .build(tauri::generate_context!()).expect("Could not start Convertor");
    app.run(|app, event| { if let tauri::RunEvent::Exit = event { let state = app.state::<AppState>(); state.preview.shutdown(); state.queue.shutdown(); } });
}
