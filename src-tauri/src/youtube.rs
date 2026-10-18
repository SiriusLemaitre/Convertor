use crate::engine::{self, JobRequest, Task};
use std::{path::{Path, PathBuf}, sync::atomic::{AtomicBool, Ordering}};

pub fn valid_url(input: &str) -> bool {
    let Ok(url) = tauri::Url::parse(input) else { return false };
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
        && url.port().is_none() && matches!(url.host_str(), Some("youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtu.be"))
        && (if url.host_str() == Some("youtu.be") { url.path().trim_matches('/').len() > 0 }
        else { url.path() == "/watch" && url.query_pairs().any(|(k, v)| k == "v" && !v.is_empty()) || ["/shorts/", "/live/", "/embed/"].iter().any(|p| url.path().starts_with(p) && url.path().len() > p.len()) })
}

pub fn validate(r: &JobRequest) -> Result<(), String> {
    if r.inputs.is_empty() || r.inputs.len() > 50 || !r.inputs.iter().all(|s| valid_url(s)) { return Err("Enter up to 50 HTTPS YouTube video links, one per line.".into()); }
    if !engine::AUDIO_FORMATS.contains(&r.format.as_str()) && !["mp4", "mkv", "webm", "mov", "gif"].contains(&r.format.as_str()) { return Err("Unsupported YouTube output format.".into()); }
    if ![0, 360, 480, 720, 1080, 1440, 2160].contains(&r.video_height) || !(1..=100).contains(&r.video_quality) || ![128,192,320].contains(&r.bitrate) || ![320,480,640,960,1280].contains(&r.width) || ![10,15,24,30].contains(&r.fps) { return Err("Invalid YouTube conversion settings.".into()); }
    engine::validate_name(&r.output_name)
}

pub fn run(task: &Task, cancelled: &AtomicBool, progress: &mut dyn FnMut(f64)) -> Result<PathBuf, String> {
    let r = &task.request;
    let temporary = tempfile::Builder::new().prefix(".convertor-youtube-").tempdir_in(&task.folder).map_err(|e| e.to_string())?;
    let audio = engine::AUDIO_FORMATS.contains(&r.format.as_str());
    let selector = if audio { "bestaudio/best".into() } else if r.video_height == 0 { "bestvideo+bestaudio/best".into() }
        else { format!("bestvideo[height<={}]+bestaudio/best[height<={}]", r.video_height, r.video_height) };
    let mut cmd = engine::command(Path::new(&r.inputs[1]));
    cmd.args(["--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-colors", "--newline", "--progress", "--no-cache-dir", "--socket-timeout", "30", "--retries", "3", "--match-filter", "!is_live", "--ffmpeg-location"])
        .arg(&task.engine).arg("--js-runtimes").arg(format!("deno:{}", r.inputs[2]))
        .args(["--format", &selector, "--merge-output-format", "mkv", "--output"])
        .arg(temporary.path().join("source.%(ext)s")).arg("--").arg(&r.inputs[0]);
    engine::run_process(cmd, cancelled, 0.0, |p| progress(p * 0.45), false)?;
    if cancelled.load(Ordering::Relaxed) { return Err("Cancelled".into()); }
    let source = std::fs::read_dir(temporary.path()).map_err(|e| e.to_string())?.filter_map(Result::ok)
        .map(|e| e.path()).find(|p| p.is_file() && p.file_stem().is_some_and(|s| s == "source") && !p.extension().is_some_and(|s| s == "part" || s == "ytdl"))
        .ok_or("The downloader did not produce a media file.")?;
    let mut conversion = r.clone();
    conversion.kind = if audio { "audio" } else if r.format == "gif" { "gif" } else { "video" }.into();
    conversion.inputs = vec![source.to_string_lossy().into()];
    conversion.start = 0.0;
    conversion.duration = None;
    conversion.video_fps = 0;
    progress(45.0);
    engine::run_task(&Task { request: conversion, ..task.clone() }, cancelled, |p| progress(45.0 + p * 0.55))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_youtube_video_urls() {
        for url in ["https://youtu.be/abc", "https://www.youtube.com/watch?v=abc&list=123", "https://youtube.com/shorts/abc", "https://music.youtube.com/watch?v=abc"] { assert!(valid_url(url), "{url}"); }
        for url in ["--exec=bad", "file:///tmp/test", "https://youtube.com.evil.com/watch?v=x", "https://evil.com", "https://user@youtube.com/watch?v=x", "https://youtube.com/playlist?list=x", "https://youtu.be/", "https://youtube.com/watch"] { assert!(!valid_url(url), "{url}"); }
    }
}
