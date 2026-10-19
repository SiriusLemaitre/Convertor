use super::*;

pub fn is_tool(r: &JobRequest) -> bool { ["pdf-pages", "images-pdf", "pdf-images", "trim", "compress", "image-edit", "frames", "metadata"].contains(&r.kind.as_str()) }
fn ext(input: &str) -> String { Path::new(input).extension().unwrap_or_default().to_string_lossy().to_lowercase() }
fn is_image(input: &str) -> bool { IMAGE_INPUTS.contains(&ext(input).as_str()) }
fn is_audio(input: &str) -> bool { AUDIO_INPUTS.contains(&ext(input).as_str()) }
pub fn extension(r: &JobRequest) -> &str {
    match r.kind.as_str() {
        "images-pdf" | "pdf-pages" => "pdf",
        "image-edit" | "pdf-images" | "frames" => &r.format,
        "trim" => if is_audio(&r.inputs[0]) { "m4a" } else { "mp4" },
        "compress" => if is_image(&r.inputs[0]) { "jpg" } else if is_audio(&r.inputs[0]) { "mp3" } else { "mp4" },
        "metadata" => Path::new(&r.inputs[0]).extension().and_then(|v| v.to_str()).unwrap_or("bin"),
        _ => "bin",
    }
}

// Explicit page syntax keeps engine switches out and gives consistent selections for all PDF tools.
pub fn selected_pages(text: &str, count: usize) -> Result<Vec<usize>, String> {
    if count == 0 { return Err("This PDF has no pages.".into()); }
    if text.trim().is_empty() { return Ok((1..=count).collect()); }
    let mut pages = vec![];
    for part in text.split(',') {
        let part = part.trim();
        let (start, end) = if let Some((a, b)) = part.split_once('-') {
            (a.trim().parse::<usize>(), b.trim().parse::<usize>())
        } else { let n = part.parse::<usize>(); (n.clone(), n) };
        let (a, b) = (start.map_err(|_| "Use page numbers such as 1, 3-5.")?, end.map_err(|_| "Use page numbers such as 1, 3-5.")?);
        if a == 0 || a > b || b > count { return Err(format!("Page ranges must be between 1 and {count}, in ascending order.")); }
        for n in a..=b { if !pages.contains(&n) { pages.push(n); } }
    }
    Ok(pages)
}

pub fn validate_tool(r: &JobRequest) -> Result<(), String> {
    if r.inputs.is_empty() { return Err("Select source files first.".into()); }
    for input in &r.inputs {
        if input.contains(['\n', '\r']) { return Err("Source paths cannot contain line breaks.".into()); }
        let p = Path::new(input);
        if !p.is_absolute() || !p.is_file() { return Err(format!("File is unavailable: {input}")); }
        let e = ext(input);
        let media = is_audio(input) || ["mp4", "mkv", "mov", "webm", "avi", "m4v"].contains(&e.as_str());
        let supported = match r.kind.as_str() {
            "pdf-pages" | "pdf-images" => e == "pdf",
            "images-pdf" | "image-edit" => is_image(input),
            "trim" => media,
            "frames" => media && !is_audio(input),
            "compress" => media || is_image(input),
            "metadata" => media || is_image(input) || e == "pdf",
            _ => false,
        };
        if !supported { return Err(format!("Unsupported file: {input}")); }
    }
    match r.kind.as_str() {
        "pdf-pages" => {
            if !["extract", "remove", "split"].contains(&r.operation.as_str()) { return Err("Choose extract, remove, or split.".into()); }
            if r.operation != "split" && r.pages.trim().is_empty() { return Err("Enter the pages to extract or remove.".into()); }
        }
        "images-pdf" => validate_name(&r.output_name)?,
        "pdf-images" => if !["png", "jpg"].contains(&r.format.as_str()) || !(72..=300).contains(&r.dpi) { return Err("Choose PNG or JPG and 72–300 DPI.".into()); },
        "trim" => if !r.start.is_finite() || r.start < 0.0 || r.duration.is_none_or(|v| !v.is_finite() || v <= 0.0) { return Err("Set a valid start and an end after the start.".into()); },
        "frames" => if !["png", "jpg"].contains(&r.format.as_str()) || !r.start.is_finite() || r.start < 0.0 || !["single", "interval"].contains(&r.operation.as_str()) || !r.interval.is_finite() || r.interval < 0.1 { return Err("Choose a valid timestamp or interval of at least 0.1 seconds.".into()); },
        "compress" => if !r.target_mb.is_finite() || !(0.01..=10000.0).contains(&r.target_mb) { return Err("Target size must be between 0.01 and 10,000 MB.".into()); },
        "image-edit" => {
            if !IMAGE_FORMATS.contains(&r.format.as_str()) || ![0, 90, 180, 270].contains(&r.rotation) || !["", "1:1", "4:3", "3:2", "16:9", "9:16"].contains(&r.crop_ratio.as_str()) { return Err("Invalid image format, rotation, or crop.".into()); }
            if (r.image_width == 0) != (r.image_height == 0) || r.image_width > 16384 || r.image_height > 16384 || u64::from(r.image_width) * u64::from(r.image_height) > 100_000_000 || !(1..=100).contains(&r.image_quality) { return Err("Set both dimensions, up to 16,384 pixels per side and 100 megapixels total.".into()); }
        }
        _ => {}
    }
    Ok(())
}

fn execute(engine: &Path, args: &[String], cancelled: &AtomicBool, duration: f64, progress: impl FnMut(f64), warnings: bool) -> Result<(), String> {
    let mut cmd = command(engine); cmd.args(args); run_process(cmd, cancelled, duration, progress, warnings)
}
fn base(input: &str) -> Vec<String> { ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-i", input].iter().map(|s| s.to_string()).collect() }
fn strings(values: &[&str]) -> Vec<String> { values.iter().map(|s| s.to_string()).collect() }
fn seconds(engine: &Path, input: &str, cancelled: &AtomicBool) -> Result<f64, String> {
    let mut cmd = command(&engine.with_file_name(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" }));
    cmd.args(["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input]);
    let n = output_with_timeout(cmd, Some(cancelled))?.trim().parse::<f64>().map_err(|_| "Cannot determine media duration.")?;
    if !n.is_finite() || n <= 0.0 { return Err("Cannot determine media duration.".into()); } Ok(n)
}
fn page_count(engine: &Path, input: &str, cancelled: &AtomicBool, render: bool) -> Result<usize, String> {
    let mut cmd = if render { command(&engine.with_file_name(if cfg!(windows) { "pdfinfo.exe" } else { "pdfinfo" })) } else { command(engine) };
    if render { cmd.arg(input); } else { cmd.args(["--show-npages", input]); }
    let text = output_with_timeout(cmd, Some(cancelled))?;
    let n = if render { text.lines().find_map(|l| l.strip_prefix("Pages:")).unwrap_or("") } else { &text };
    n.trim().parse::<usize>().map_err(|_| "Cannot read PDF page count. Encrypted PDFs need an unprotected copy.".into())
}

pub fn edit_args(r: &JobRequest, output: &Path) -> Vec<String> {
    let mut copy = r.clone(); copy.kind = "image".into(); copy.image_width = 0; copy.image_height = 0; copy.image_scale_percent = None;
    let mut args = image_args(&copy, output);
    let mut filters = vec![];
    match r.rotation { 90 => filters.push("transpose=1".into()), 180 => filters.push("hflip,vflip".into()), 270 => filters.push("transpose=2".into()), _ => {} }
    if let Some((a, b)) = r.crop_ratio.split_once(':') {
        filters.push(format!("crop=w='min(iw,ih*{a}/{b})':h='min(ih,iw*{b}/{a})':x='(iw-ow)/2':y='(ih-oh)/2'"));
    }
    if r.image_width > 0 {
        filters.push(format!("scale={}:{}:flags=lanczos{}", r.image_width, r.image_height, if r.keep_aspect { ":force_original_aspect_ratio=decrease" } else { "" }));
    }
    if !filters.is_empty() { let end = args.len()-1; args.splice(end..end, ["-vf".into(), filters.join(",")]); }
    args
}

fn render_page(engine: &Path, input: &str, page: usize, dpi: u32, format: &str, prefix: &Path, cancelled: &AtomicBool) -> Result<PathBuf, String> {
    let mut args = vec!["-f".into(), page.to_string(), "-l".into(), page.to_string(), "-singlefile".into(), "-r".into(), dpi.max(72).to_string(), if format == "jpg" { "-jpeg".into() } else { "-png".into() }];
    if dpi == 0 { args.extend(["-scale-to".into(), "960".into()]); }
    args.extend([input.into(), prefix.to_string_lossy().into()]);
    execute(engine, &args, cancelled, 0.0, |_| {}, false)?;
    Ok(prefix.with_extension(format))
}

// Work is staged in a private directory. Publish a new directory only after every file succeeds.
fn publish_directory(stage: &Path, folder: &Path, stem: &str, cancelled: &AtomicBool) -> Result<PathBuf, String> {
    for n in 0..10000 {
        if cancelled.load(Ordering::Relaxed) { return Err("Cancelled".into()); }
        let target = folder.join(if n == 0 { stem.into() } else { format!("{stem} ({n})") });
        match fs::create_dir(&target) {
            Ok(()) => {
                let result = (|| {
                    for entry in fs::read_dir(stage).map_err(|e| e.to_string())? {
                        if cancelled.load(Ordering::Relaxed) { return Err("Cancelled".into()); }
                        let entry = entry.map_err(|e| e.to_string())?;
                        fs::rename(entry.path(), target.join(entry.file_name())).map_err(|e| e.to_string())?;
                    }
                    Ok(())
                })();
                if let Err(error) = result { let _ = fs::remove_dir_all(&target); return Err(error); }
                return Ok(target);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Too many output directories with this name.".into())
}

fn image_pdf(task: &Task, output: &Path, cancelled: &AtomicBool, mut progress: impl FnMut(f64)) -> Result<(), String> {
    use std::io::{Seek, SeekFrom};
    let mut file = fs::File::create(output).map_err(|e| e.to_string())?;
    file.write_all(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n").map_err(|e| e.to_string())?;
    let count = task.request.inputs.len();
    let mut offsets = vec![0u64];
    fn object(file: &mut fs::File, offsets: &mut Vec<u64>, number: usize, data: &[u8]) -> Result<(), String> {
        offsets.push(file.stream_position().map_err(|e| e.to_string())?);
        write!(file, "{number} 0 obj\n").map_err(|e| e.to_string())?;
        file.write_all(data).map_err(|e| e.to_string())?;
        file.write_all(b"\nendobj\n").map_err(|e| e.to_string())
    }
    object(&mut file, &mut offsets, 1, b"<< /Type /Catalog /Pages 2 0 R >>")?;
    let kids = (0..count).map(|n| format!("{} 0 R", 3+n*3)).collect::<Vec<_>>().join(" ");
    object(&mut file, &mut offsets, 2, format!("<< /Type /Pages /Count {count} /Kids [{kids}] >>").as_bytes())?;
    for (index, input) in task.request.inputs.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) { return Err("Cancelled".into()); }
        let temp = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
        let mut r = task.request.clone(); r.inputs = vec![input.clone()]; r.kind = "image".into(); r.format = "jpg".into(); r.image_scale_percent = Some(100);
        let mut args = image_args(&r, temp.path());
        // Use full chroma resolution for small text and scanned documents.
        let end = args.len()-1; args.splice(end..end, strings(&["-pix_fmt", "yuvj444p"]));
        execute(&task.engine, &args, cancelled, 0.0, |_| {}, false)?;
        let (w, h) = image_dimensions(&task.engine, temp.path(), cancelled)?;
        let scale = (595.0 / w as f64).min(842.0 / h as f64);
        let (pw, ph) = (w as f64 * scale, h as f64 * scale);
        let id = 3+index*3;
        object(&mut file, &mut offsets, id, format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw:.3} {ph:.3}] /Resources << /XObject << /Im0 {} 0 R >> >> /Contents {} 0 R >>", id+1, id+2).as_bytes())?;
        offsets.push(file.stream_position().map_err(|e| e.to_string())?);
        let size = fs::metadata(temp.path()).map_err(|e| e.to_string())?.len();
        write!(file, "{} 0 obj\n<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {size} >>\nstream\n", id+1).map_err(|e| e.to_string())?;
        std::io::copy(&mut fs::File::open(temp.path()).map_err(|e| e.to_string())?, &mut file).map_err(|e| e.to_string())?;
        file.write_all(b"\nendstream\nendobj\n").map_err(|e| e.to_string())?;
        let content = format!("q {pw:.3} 0 0 {ph:.3} 0 0 cm /Im0 Do Q\n");
        object(&mut file, &mut offsets, id+2, format!("<< /Length {} >>\nstream\n{content}endstream", content.len()).as_bytes())?;
        progress((index+1) as f64 / count as f64 * 98.0);
    }
    let xref = file.seek(SeekFrom::Current(0)).map_err(|e| e.to_string())?;
    write!(file, "xref\n0 {}\n0000000000 65535 f \n", offsets.len()).map_err(|e| e.to_string())?;
    for offset in offsets.iter().skip(1) { writeln!(file, "{offset:010} 00000 n ").map_err(|e| e.to_string())?; }
    write!(file, "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", offsets.len()).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())
}

pub fn run(task: &Task, cancelled: &AtomicBool, mut progress: impl FnMut(f64)) -> Result<PathBuf, String> {
    validate_tool(&task.request)?;
    if cancelled.load(Ordering::Relaxed) { return Err("Cancelled".into()); }
    let r = &task.request;
    let input = &r.inputs[0];
    let stage = tempfile::Builder::new().prefix(".convertor-stage-").tempdir_in(&task.folder).map_err(|e| e.to_string())?;
    let temporary = tempfile::Builder::new().prefix(".convertor-").suffix(&format!(".{}", extension(r))).tempfile_in(&task.folder).map_err(|e| e.to_string())?.into_temp_path();
    match r.kind.as_str() {
        "pdf-pages" | "pdf-images" => {
            let render = r.kind == "pdf-images";
            let count = page_count(&task.engine, input, cancelled, render)?;
            let mut pages = selected_pages(&r.pages, count)?;
            if r.operation == "remove" && !render { pages = (1..=count).filter(|n| !pages.contains(n)).collect(); }
            if pages.is_empty() { return Err("The selection would leave no pages.".into()); }
            if render || r.operation == "split" {
                for (index, page) in pages.iter().enumerate() {
                    let path = stage.path().join(format!("page-{page:04}"));
                    if render { render_page(&task.engine, input, *page, r.dpi, &r.format, &path, cancelled)?; }
                    else { execute(&task.engine, &vec!["--empty".into(), "--pages".into(), input.clone(), page.to_string(), "--".into(), path.with_extension("pdf").to_string_lossy().into()], cancelled, 0.0, |_| {}, true)?; }
                    progress((index+1) as f64 / pages.len() as f64 * 98.0);
                }
                return publish_directory(stage.path(), &task.folder, &format!("{}-{}", task.stem, if render { "images" } else { "pages" }), cancelled);
            }
            let selection = pages.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(",");
            // Stage the source first so arbitrarily long selections stay outside the Windows command line.
            let mut args = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
            writeln!(args, "--empty\n--pages\n{input}\n{selection}\n--\n{}", temporary.display()).map_err(|e| e.to_string())?;
            args.flush().map_err(|e| e.to_string())?;
            let args_path = args.into_temp_path();
            execute(&task.engine, &[format!("@{}", args_path.display())], cancelled, 0.0, &mut progress, true)?;
        }
        "images-pdf" => image_pdf(task, &temporary, cancelled, &mut progress)?,
        "image-edit" => execute(&task.engine, &edit_args(r, &temporary), cancelled, 0.0, &mut progress, false)?,
        "trim" | "frames" => {
            let total = seconds(&task.engine, input, cancelled)?;
            if r.start >= total { return Err("The start is past the end of this file.".into()); }
            if r.kind == "frames" {
                let count = if r.operation == "single" { 1 } else { ((total-r.start)/r.interval).ceil() as usize };
                if count > 10000 { return Err("This would export more than 10,000 frames. Increase the interval.".into()); }
                for index in 0..count {
                    let timestamp = r.start + index as f64 * r.interval;
                    let output = if r.operation == "single" { temporary.to_path_buf() } else { stage.path().join(format!("frame-{:05}.{}", index+1, r.format)) };
                    let mut args = strings(&["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-ss"]); args.extend([timestamp.to_string(), "-i".into(), input.clone()]);
                    args.extend(strings(&["-map", "0:v:0", "-frames:v", "1", "-c:v", if r.format == "jpg" { "mjpeg" } else { "png" }, "-update", "1", "-f", "image2"])); args.push(output.to_string_lossy().into());
                    execute(&task.engine, &args, cancelled, 0.0, |_| {}, false)?;
                    progress((index+1) as f64 / count as f64 * 98.0);
                }
                if r.operation == "interval" { return publish_directory(stage.path(), &task.folder, &format!("{}-frames", task.stem), cancelled); }
            } else {
                let length = r.duration.unwrap();
                if r.start + length > total + 0.05 { return Err(format!("The end exceeds this file's duration ({total:.2} seconds).")); }
                let mut args = strings(&["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-ss"]);
                args.extend([r.start.to_string(), "-i".into(), input.clone(), "-t".into(), length.to_string()]);
                if is_audio(input) { args.extend(strings(&["-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k"])); }
                else { args.extend(strings(&["-map", "0:V:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", "-c:a", "aac"])); }
                args.extend(strings(&["-movflags", "+faststart", "-f", "mp4"])); args.push(temporary.to_string_lossy().into());
                execute(&task.engine, &args, cancelled, length, &mut progress, false)?;
            }
        }
        "compress" => compress(task, &temporary, stage.path(), cancelled, &mut progress)?,
        "metadata" => {
            if ext(input) == "pdf" {
                execute(&task.engine, &vec!["--remove-info".into(), "--remove-metadata".into(), input.clone(), temporary.to_string_lossy().into()], cancelled, 0.0, &mut progress, true)?;
            } else {
                let mut args = if is_image(input) { let mut copy = r.clone(); copy.kind = "image".into(); copy.format = match ext(input).as_str() { "jpeg" => "jpg".into(), "tif" => "tiff".into(), _ => ext(input) }; image_args(&copy, &temporary) } else {
                    let mut args = base(input);
                    // Only audio/video/subtitle streams: omit attachments and private data tracks.
                    args.extend(strings(&["-map", "0:v?", "-map", "0:a?", "-map", "0:s?", "-c", "copy"]));
                    args.push(temporary.to_string_lossy().into()); args
                };
                let end = args.len()-1;
                args.splice(end..end, strings(&["-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1", "-metadata", "encoder=", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact"]));
                execute(&task.engine, &args, cancelled, 0.0, &mut progress, false)?;
            }
        }
        _ => return Err("Unknown tool".into()),
    }
    if cancelled.load(Ordering::Relaxed) { return Err("Cancelled".into()); }
    if fs::metadata(&temporary).map_err(|e| e.to_string())?.len() == 0 { return Err("The engine produced an empty file.".into()); }
    let stem = if r.kind == "images-pdf" { task.stem.clone() } else { format!("{}-{}", task.stem, match r.kind.as_str() { "trim" => "trimmed", "compress" => "compressed", "metadata" => "clean", "image-edit" => "edited", "pdf-pages" => "selected", "frames" => "frame", _ => "output" }) };
    commit_output(temporary, &task.folder, &stem, extension(r))
}

fn compress(task: &Task, output: &Path, stage: &Path, cancelled: &AtomicBool, mut progress: impl FnMut(f64)) -> Result<(), String> {
    let r = &task.request; let input = &r.inputs[0]; let target = (r.target_mb * 1_000_000.0).floor() as u64;
    if is_image(input) {
        let mut copy = r.clone(); copy.kind = "image".into(); copy.format = "jpg".into(); copy.image_scale_percent = Some(100);
        for attempt in 0..24 {
            copy.image_quality = (90i32 - attempt * 8).max(10) as u32;
            copy.image_scale_percent = Some(if attempt < 10 { 100 } else { (90i32 - (attempt-10)*6).max(10) as u32 });
            execute(&task.engine, &image_args(&copy, output), cancelled, 0.0, |_| {}, false)?;
            progress(attempt as f64 / 24.0 * 98.0);
            if fs::metadata(output).map_err(|e| e.to_string())?.len() <= target { return Ok(()); }
        }
    } else {
        let duration = seconds(&task.engine, input, cancelled)?;
        let budget = target as f64 * 8.0 / duration * 0.94;
        if is_audio(input) {
            let kbps = [320, 256, 192, 160, 128, 96, 64, 48, 32, 24, 16, 8].into_iter().find(|b| *b as f64 * 1000.0 <= budget).ok_or("Target too small for this recording. Increase the size.")?;
            let mut args = base(input); args.extend(strings(&["-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a"])); args.extend([format!("{kbps}k"), "-f".into(), "mp3".into(), output.to_string_lossy().into()]);
            execute(&task.engine, &args, cancelled, duration, &mut progress, false)?;
        } else {
            let audio = (budget * 0.15).clamp(8000.0, 128000.0);
            let mut video = budget - audio;
            if video < 16000.0 { return Err("Target too small for this video. Increase the size.".into()); }
            for attempt in 0..3 {
                let log = stage.join(format!("pass-{attempt}"));
                for pass in 1..=2 {
                    let mut args = base(input);
                    // Bound encoder memory on large recordings, including concurrent jobs.
                    // The second pass otherwise uses x264's slower, full analysis settings.
                    args.extend(strings(&["-map", "0:V:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "fast", "-threads:v", "4", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-b:v"]));
                    args.extend([format!("{}", video as u64), "-pass".into(), pass.to_string(), "-passlogfile".into(), log.to_string_lossy().into()]);
                    if pass == 1 { args.extend(strings(&["-an", "-f", "null", if cfg!(windows) { "NUL" } else { "/dev/null" }])); }
                    else { args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), (audio as u64).to_string(), "-movflags".into(), "+faststart".into(), "-f".into(), "mp4".into(), output.to_string_lossy().into()]); }
                    let start = (pass-1) as f64 * 49.0;
                    progress(start);
                    let mut cmd = command(&task.engine); cmd.args(&args);
                    run_process_guarded(cmd, cancelled, duration, |v| progress(start + v.clamp(0.0, 100.0)*0.49), false, Some(Duration::from_secs(300)))?;
                    progress(start + 49.0);
                }
                let size = fs::metadata(output).map_err(|e| e.to_string())?.len();
                if size <= target { return Ok(()); }
                video *= target as f64 / size as f64 * 0.9;
            }
        }
        if fs::metadata(output).map_err(|e| e.to_string())?.len() <= target { return Ok(()); }
    }
    Err("Could not meet that target size. Increase the target and try again.".into())
}

#[derive(Serialize)]
pub struct PreviewData { pub bytes: Vec<u8>, pub mime: String }
pub fn visual_preview(r: &JobRequest, engine: &Path, cancelled: &AtomicBool) -> Result<PreviewData, String> {
    if r.inputs.is_empty() { return Err("Choose a file to preview.".into()); }
    let input = &r.inputs[0];
    if !Path::new(input).is_absolute() || !Path::new(input).is_file() { return Err("Preview file unavailable.".into()); }
    let stage = tempfile::tempdir().map_err(|e| e.to_string())?;
    let output = stage.path().join("preview.png");
    if ext(input) == "pdf" {
        let count = page_count(engine, input, cancelled, true)?;
        let pages = selected_pages(&r.pages, count)?;
        render_page(engine, input, pages[0], 0, "png", &stage.path().join("preview"), cancelled)?;
    } else if is_image(input) && ["image", "image-edit"].contains(&r.kind.as_str()) {
        // Encode using the export settings first, so lossy artifacts are visible in the comparison.
        validate(r)?;
        let encoded = stage.path().join(format!("encoded.{}", r.format));
        let args = if r.kind == "image-edit" { edit_args(r, &encoded) } else { image_args(r, &encoded) };
        execute(engine, &args, cancelled, 0.0, |_| {}, false)?;
        let mut thumbnail = r.clone(); thumbnail.inputs = vec![encoded.to_string_lossy().into()]; thumbnail.format = "png".into();
        thumbnail.kind = "image".into(); thumbnail.image_scale_percent = None; thumbnail.image_width = 960; thumbnail.image_height = 720; thumbnail.keep_aspect = true;
        let mut args = image_args(&thumbnail, &output);
        let index = args.iter().position(|arg| arg == "-vf").unwrap();
        args[index+1] = "scale=w='min(960,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease".into();
        execute(engine, &args, cancelled, 0.0, |_| {}, false)?;
    } else {
        let mut copy = r.clone(); copy.inputs = vec![input.clone()]; copy.format = "png".into();
        let mut args = if r.kind == "image-edit" { validate_tool(r)?; edit_args(&copy, &output) } else {
            copy.kind = "image".into();
            if r.kind != "image" { copy.image_scale_percent = None; copy.image_width = 0; copy.image_height = 0; }
            image_args(&copy, &output)
        };
        if !is_image(input) { args.splice(0..0, ["-ss".into(), r.start.max(0.0).to_string()]); }
        // Bound all preview outputs, including images with large original dimensions.
        let filter_index = args.iter().position(|v| v == "-vf");
        let scale = "scale=w='min(960,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease";
        if let Some(index) = filter_index { args[index+1].push_str(&format!(",{scale}")); }
        else { let end = args.len()-1; args.splice(end..end, ["-vf".into(), scale.into()]); }
        execute(engine, &args, cancelled, 0.0, |_| {}, false)?;
    }
    if fs::metadata(&output).map_err(|e| e.to_string())?.len() > 16_000_000 { return Err("Preview is too large.".into()); }
    Ok(PreviewData { bytes: fs::read(output).map_err(|e| e.to_string())?, mime: "image/png".into() })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn page_ranges_are_bounded_and_deduplicated() {
        assert_eq!(selected_pages("1, 3-5, 3", 5).unwrap(), vec![1,3,4,5]);
        assert_eq!(selected_pages("", 3).unwrap(), vec![1,2,3]);
        for s in ["0", "6", "4-2", "1,", "--password=x", "1-999999999"] { assert!(selected_pages(s, 5).is_err()); }
    }
    fn engine(name: &str) -> PathBuf {
        let folder = PathBuf::from(std::env::var_os("CONVERTOR_ENGINE_DIR").expect("Set CONVERTOR_ENGINE_DIR"));
        if name == "pdftoppm" && cfg!(windows) { folder.join("poppler/Library/bin/pdftoppm.exe") }
        else { folder.join(if cfg!(windows) { format!("{name}.exe") } else { name.into() }) }
    }
    fn request(kind: &str, input: &Path) -> JobRequest {
        serde_json::from_value(serde_json::json!({"kind":kind,"inputs":[input.to_string_lossy()],"outputDir":"","outputName":"photos","bitrate":192,"width":640,"fps":15,"start":0,"duration":null,"format":"png","operation":"extract","targetMb":0.03,"interval":0.5,"dpi":72})).unwrap()
    }
    fn run_request(r: JobRequest, folder: &Path, name: &str) -> PathBuf {
        let executable = if r.kind == "pdf-images" { "pdftoppm" } else if r.kind == "pdf-pages" || r.kind == "metadata" && ext(&r.inputs[0]) == "pdf" { "qpdf" } else { "ffmpeg" };
        run(&Task { request:r, engine:engine(executable), folder:folder.into(), stem:name.into() }, &AtomicBool::new(false), |_| {}).unwrap_or_else(|e| panic!("{name}: {e}"))
    }
    fn generate(folder: &Path, extension: &str) -> PathBuf {
        let p = folder.join(format!("source café.{extension}"));
        let mut cmd = command(&engine("ffmpeg"));
        cmd.args(["-y","-hide_banner","-loglevel","error","-f","lavfi","-i","testsrc2=size=320x240:rate=10"]);
        if extension == "png" { cmd.args(["-frames:v","1"]); }
        else { cmd.args(["-f","lavfi","-i","sine=frequency=440","-t","2","-c:v","libx264","-c:a","aac","-metadata","title=Private title","-metadata","location=+48.8566+002.3522/"]); }
        assert!(cmd.arg(&p).output().unwrap().status.success()); p
    }
    #[test]
    #[ignore = "Requires bundled engines"]
    fn native_pdf_tools_and_image_editing() {
        let folder = tempfile::tempdir().unwrap(); let source = generate(folder.path(), "png");
        let original = fs::read(&source).unwrap();
        let mut r = request("image-edit", &source); r.rotation = 90; r.crop_ratio = "1:1".into(); r.image_width=100; r.image_height=100;
        let output = run_request(r.clone(), folder.path(), "edited");
        assert_eq!(image_dimensions(&engine("ffmpeg"), &output, &AtomicBool::new(false)).unwrap(), (100,100));
        let preview = visual_preview(&r, &engine("ffmpeg"), &AtomicBool::new(false)).unwrap(); assert!(preview.bytes.starts_with(b"\x89PNG"));
        let mut lossy = request("image", &source); lossy.format = "jpg".into(); lossy.image_quality = 1;
        let low = visual_preview(&lossy, &engine("ffmpeg"), &AtomicBool::new(false)).unwrap();
        lossy.image_quality = 100;
        let high = visual_preview(&lossy, &engine("ffmpeg"), &AtomicBool::new(false)).unwrap();
        assert_ne!(low.bytes, high.bytes, "Preview must reflect lossy export quality");
        let mut r = request("images-pdf", &source); r.inputs.push(output.to_string_lossy().into());
        let pdf = run_request(r, folder.path(), "photos");
        let mut check = command(&engine("qpdf")); check.arg("--check").arg(&pdf); assert!(check.output().unwrap().status.success());
        assert_eq!(page_count(&engine("qpdf"), &pdf.to_string_lossy(), &AtomicBool::new(false), false).unwrap(),2);
        let mut r = request("pdf-pages", &pdf); r.pages="2,1".into();
        let extracted = run_request(r.clone(), folder.path(), "extracted");
        assert_eq!(page_count(&engine("qpdf"), &extracted.to_string_lossy(), &AtomicBool::new(false), false).unwrap(),2);
        r.operation="remove".into(); r.pages="1".into();
        let removed = run_request(r.clone(), folder.path(), "removed");
        assert_eq!(page_count(&engine("qpdf"), &removed.to_string_lossy(), &AtomicBool::new(false), false).unwrap(),1);
        r.operation="split".into(); r.pages=String::new();
        let split = run_request(r, folder.path(), "split"); assert_eq!(fs::read_dir(split).unwrap().count(),2);
        let r = request("pdf-images", &pdf);
        let images = run_request(r.clone(), folder.path(), "rendered"); assert_eq!(fs::read_dir(images).unwrap().count(),2);
        assert!(visual_preview(&r,&engine("pdftoppm"),&AtomicBool::new(false)).unwrap().bytes.starts_with(b"\x89PNG"));
        let clean = run_request(request("metadata",&pdf), folder.path(), "clean"); assert_eq!(page_count(&engine("qpdf"),&clean.to_string_lossy(),&AtomicBool::new(false),false).unwrap(),2);
        assert_eq!(fs::read(source).unwrap(),original);
        assert!(!fs::read_dir(folder.path()).unwrap().any(|p|p.unwrap().file_name().to_string_lossy().starts_with(".convertor-")));
    }
    #[test]
    #[ignore = "Requires bundled engines"]
    fn native_large_recording_compression_and_second_pass_cancellation() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("large recording.mp4");
        let result = command(&engine("ffmpeg")).args(["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "30", "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-c:a", "aac"]).arg(&source).output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        let original_size = fs::metadata(&source).unwrap().len();
        assert!(original_size > 100_000_000, "Fixture must exceed 100 MB: {original_size}");
        let mut r = request("compress", &source); r.target_mb = 5.0;
        let task = Task { request: r, engine: engine("ffmpeg"), folder: folder.path().into(), stem: "large".into() };
        let mut values = vec![];
        let output = run(&task, &AtomicBool::new(false), |value| values.push(value)).unwrap();
        assert!(values.iter().any(|v| *v > 50.0 && *v < 98.0), "Second pass must report progress");
        assert!(fs::metadata(&output).unwrap().len() <= 5_000_000);
        assert!((seconds(&task.engine, &output.to_string_lossy(), &AtomicBool::new(false)).unwrap() - 30.0).abs() < 0.2);
        let decoded = command(&task.engine).args(["-v", "error", "-i"]).arg(&output).args(["-f", "null", "-"]).output().unwrap();
        assert!(decoded.status.success(), "{}", String::from_utf8_lossy(&decoded.stderr));
        let flag = AtomicBool::new(false);
        assert!(run(&task, &flag, |value| { if value > 49.0 { flag.store(true, Ordering::Relaxed); } }).is_err());
        assert_eq!(fs::metadata(&source).unwrap().len(), original_size);
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 2, "Cancellation must clean temporary files");
    }
    #[test]
    #[ignore = "Requires bundled engines"]
    fn native_clips_frames_metadata_and_target_sizes() {
        let folder=tempfile::tempdir().unwrap(); let video=generate(folder.path(),"mp4"); let image=generate(folder.path(),"png");
        let original=fs::read(&video).unwrap();
        let mut r=request("trim",&video); r.start=0.5; r.duration=Some(1.0);
        let clip=run_request(r,folder.path(),"clip"); assert!((seconds(&engine("ffmpeg"),&clip.to_string_lossy(),&AtomicBool::new(false)).unwrap()-1.0).abs()<0.15);
        let mut r=request("frames",&video); r.operation="single".into(); r.start=0.5;
        let still=run_request(r.clone(),folder.path(),"still"); assert_eq!(image_dimensions(&engine("ffmpeg"),&still,&AtomicBool::new(false)).unwrap(),(320,240));
        r.operation="interval".into(); let frames=run_request(r,folder.path(),"frames"); assert_eq!(fs::read_dir(frames).unwrap().count(),3);
        let clean=run_request(request("metadata",&video),folder.path(),"clean");
        let mut probe=command(&engine("ffprobe")); probe.args(["-v","error","-show_format","-of","json"]).arg(&clean);
        let tags=output_with_timeout(probe,None).unwrap(); assert!(!tags.contains("Private title")); assert!(!tags.contains("48.8566"));
        for input in [&video,&image] {
            let output=run_request(request("compress",input),folder.path(),"small"); assert!(fs::metadata(output).unwrap().len()<=30_000);
        }
        let audio=folder.path().join("audio.wav"); let mut cmd=command(&engine("ffmpeg")); cmd.args(["-y","-v","error","-f","lavfi","-i","sine=frequency=500","-t","2"]).arg(&audio); assert!(cmd.output().unwrap().status.success());
        let output=run_request(request("compress",&audio),folder.path(),"audio"); assert!(fs::metadata(output).unwrap().len()<=30_000);
        let mut r=request("trim",&audio); r.start=0.25; r.duration=Some(0.5); let output=run_request(r,folder.path(),"audio clip"); assert!((seconds(&engine("ffmpeg"),&output.to_string_lossy(),&AtomicBool::new(false)).unwrap()-0.5).abs()<0.15);
        assert_eq!(fs::read(&video).unwrap(),original);
        assert!(!fs::read_dir(folder.path()).unwrap().any(|p|p.unwrap().file_name().to_string_lossy().starts_with(".convertor-")));
    }
    #[test]
    #[ignore = "Requires bundled engines"]
    fn native_cancelled_multifile_exports_publish_nothing() {
        let folder=tempfile::tempdir().unwrap(); let video=generate(folder.path(),"mp4");
        let mut r=request("frames",&video); r.operation="interval".into();
        let flag=AtomicBool::new(false);
        let result=run(&Task {request:r,engine:engine("ffmpeg"),folder:folder.path().into(),stem:"cancelled".into()},&flag,|value| { if value>0.0 {flag.store(true,Ordering::Relaxed);} });
        assert!(result.is_err()); assert_eq!(fs::read_dir(folder.path()).unwrap().count(),1);
    }
}
