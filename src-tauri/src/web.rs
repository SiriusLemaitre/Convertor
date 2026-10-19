//! Loopback-only transport for the shared desktop commands. GitHub Pages serves
//! only the UI; a per-launch capability in the URL fragment pairs it to this PC.
use super::*;
use serde_json::{json, Value};
use std::{collections::HashSet, io::{Read, Seek, SeekFrom}, sync::{atomic::{AtomicUsize, Ordering}, OnceLock}};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const HOSTED: &str = "https://siriuslemaitre.github.io/Convertor/";
const HOSTED_ORIGIN: &str = "https://siriuslemaitre.github.io";
const MAX_BODY: u64 = 1024 * 1024;
include!(concat!(env!("OUT_DIR"), "/web_assets.rs"));

struct Bridge { port: u16, token: String, files: Mutex<HashSet<PathBuf>> }
static BRIDGE: OnceLock<Mutex<Option<Arc<Bridge>>>> = OnceLock::new();

pub fn open(app: &tauri::AppHandle, hosted: bool) -> Result<String, String> {
    let mut running = BRIDGE.get_or_init(|| Mutex::new(None)).lock().unwrap();
    if running.is_none() {
        if !ASSETS.iter().any(|(name, _)| *name == "/index.html") { return Err("Build the web interface first: npm run build".into()); }
        let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = server.server_addr().to_ip().ok_or("Loopback server unavailable")?.port();
        let mut random = [0u8; 32];
        getrandom::fill(&mut random).map_err(|e| e.to_string())?;
        let bridge = Arc::new(Bridge { port, token: random.iter().map(|b| format!("{b:02x}")).collect(), files: Mutex::new(HashSet::new()) });
        let shared = bridge.clone();
        let handle = app.clone();
        std::thread::spawn(move || {
            let active = Arc::new(AtomicUsize::new(0));
            for request in server.incoming_requests() {
                if active.fetch_add(1, Ordering::SeqCst) >= 16 {
                    active.fetch_sub(1, Ordering::SeqCst);
                    let _ = request.respond(Response::from_string("Helper is busy").with_status_code(503));
                    continue;
                }
                let bridge = shared.clone(); let app = handle.clone(); let active = active.clone();
                std::thread::spawn(move || { serve(request, &bridge, &app); active.fetch_sub(1, Ordering::SeqCst); });
            }
        });
        *running = Some(bridge);
    }
    let bridge = running.as_ref().unwrap();
    let base = if hosted { HOSTED.to_string() } else { format!("http://127.0.0.1:{}/", bridge.port) };
    let url = format!("{base}#bridge={}.{}", bridge.port, bridge.token);
    if std::env::var_os("CONVERTOR_WEB_NO_OPEN").is_some() { return Ok(url); }
    // ShellExecute through the OS URL handler, with the URL as one argument.
    #[cfg(windows)] let result = engine::command(Path::new("rundll32.exe")).args(["url.dll,FileProtocolHandler", &url]).spawn();
    #[cfg(target_os = "macos")] let result = engine::command(Path::new("open")).arg(&url).spawn();
    #[cfg(target_os = "linux")] let result = engine::command(Path::new("xdg-open")).arg(&url).spawn();
    result.map(|_| url).map_err(|e| e.to_string())
}

fn header(request: &Request, name: &str) -> Option<String> {
    request.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.to_string())
}
fn allowed_origin(origin: &str, port: u16) -> bool {
    origin == HOSTED_ORIGIN || origin == format!("http://127.0.0.1:{port}") || origin == "http://127.0.0.1:1420"
}
fn headers(origin: Option<&str>) -> Vec<Header> {
    let mut values = vec![("Cache-Control", "no-store"), ("Referrer-Policy", "no-referrer"), ("X-Content-Type-Options", "nosniff")];
    if let Some(origin) = origin {
        values.extend([("Access-Control-Allow-Origin", origin), ("Vary", "Origin"), ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"), ("Access-Control-Allow-Headers", "Authorization, Content-Type, Range"), ("Access-Control-Allow-Private-Network", "true")]);
    }
    values.into_iter().map(|(k, v)| Header::from_bytes(k, v).unwrap()).collect()
}
fn reply(request: Request, status: u16, data: Value, origin: Option<&str>) {
    let mut response = Response::from_string(data.to_string()).with_status_code(status).with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
    for h in headers(origin) { response.add_header(h); }
    let _ = request.respond(response);
}
fn serve(mut request: Request, bridge: &Bridge, app: &tauri::AppHandle) {
    // Validate Host as well as Origin to reject DNS rebinding and foreign sites.
    if header(&request, "Host").as_deref() != Some(format!("127.0.0.1:{}", bridge.port).as_str()) {
        reply(request, 403, json!({"error":"Invalid host"}), None); return;
    }
    let origin = header(&request, "Origin");
    if origin.as_ref().is_some_and(|o| !allowed_origin(o, bridge.port)) {
        reply(request, 403, json!({"error":"This website is not allowed to connect"}), None); return;
    }
    if request.method() == &Method::Options { reply(request, 200, Value::Null, origin.as_deref()); return; }
    let Ok(url) = tauri::Url::parse(&format!("http://127.0.0.1:{}{}", bridge.port, request.url())) else {
        reply(request, 400, json!({"error":"Invalid URL"}), origin.as_deref()); return;
    };
    if url.path().starts_with("/api/") || url.path() == "/media" {
        let authorization = header(&request, "Authorization");
        let media_token = if url.path() == "/media" { url.query_pairs().find(|(k, _)| k == "token").map(|(_, v)| v.into_owned()) } else { None };
        if authorization.as_deref() != Some(format!("Bearer {}", bridge.token).as_str()) && media_token.as_deref() != Some(&bridge.token) {
            reply(request, 401, json!({"error":"Launch browser mode again to reconnect to Convertor"}), origin.as_deref()); return;
        }
        if request.method() == &Method::Get && url.path() == "/media" {
            let path = url.query_pairs().find(|(k, _)| k == "path").map(|(_, v)| PathBuf::from(v.into_owned()));
            let path = path.and_then(|p| dunce::canonicalize(p).ok());
            if let Some(path) = path.filter(|p| bridge.files.lock().unwrap().contains(p)) { media(request, &path, origin.as_deref()); }
            else { reply(request, 403, json!({"error":"Select this file in Convertor first"}), origin.as_deref()); }
            return;
        }
        if request.method() != &Method::Post { reply(request, 405, json!({"error":"POST required"}), origin.as_deref()); return; }
        if request.body_length().is_some_and(|n| n as u64 > MAX_BODY) { reply(request, 413, json!({"error":"Request too large"}), origin.as_deref()); return; }
        let mut body = Vec::new();
        if request.as_reader().take(MAX_BODY + 1).read_to_end(&mut body).is_err() || body.len() as u64 > MAX_BODY {
            reply(request, 413, json!({"error":"Request too large"}), origin.as_deref()); return;
        }
        let result = serde_json::from_slice(&body).map_err(|e| e.to_string()).and_then(|args| dispatch(url.path().trim_start_matches("/api/"), args, bridge, app));
        let (status, value) = match result { Ok(value) => (200, value), Err(error) => (400, json!({"error":error})) };
        reply(request, status, value, origin.as_deref()); return;
    }
    if request.method() != &Method::Get { reply(request, 405, json!({"error":"GET required"}), origin.as_deref()); return; }
    let name = if url.path() == "/" { "/index.html" } else { url.path() };
    if let Some((_, bytes)) = ASSETS.iter().find(|(path, _)| *path == name) {
        let mut response = Response::from_data(*bytes).with_header(Header::from_bytes("Content-Type", mime(Path::new(name))).unwrap());
        for h in headers(None) { response.add_header(h); }
        response.add_header(Header::from_bytes("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'").unwrap());
        let _ = request.respond(response);
    } else { reply(request, 404, json!({"error":"Not found"}), origin.as_deref()); }
}

fn remember(bridge: &Bridge, paths: impl IntoIterator<Item = String>) {
    let mut files = bridge.files.lock().unwrap();
    for path in paths { if let Ok(path) = dunce::canonicalize(path) { if path.is_file() { files.insert(path); } } }
}
fn arg<T: serde::de::DeserializeOwned>(args: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null)).map_err(|e| format!("Invalid {name}: {e}"))
}
fn dispatch(command: &str, args: Value, bridge: &Bridge, app: &tauri::AppHandle) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let result = tauri::async_runtime::block_on(async {
        Ok(match command {
            "app_info" => serde_json::to_value(app_info(state).await?),
            "save_settings" => serde_json::to_value(save_settings(arg(&args, "settings")?, state).await?),
            "pick_files" => {
                let files = pick_files(arg(&args, "extensions")?).await?;
                remember(bridge, files.iter().map(|f| f.path.clone())); serde_json::to_value(files)
            },
            "inspect_files" => {
                let files = inspect_files(arg(&args, "paths")?)?;
                remember(bridge, files.iter().map(|f| f.path.clone())); serde_json::to_value(files)
            },
            "pick_folder" => serde_json::to_value(pick_folder().await),
            "pick_executable" => serde_json::to_value(pick_executable().await),
            "enqueue" => serde_json::to_value(enqueue(arg(&args, "request")?, state)?),
            "list_jobs" => {
                let jobs = list_jobs(state); remember(bridge, jobs.iter().filter_map(|j| j.output.clone())); serde_json::to_value(jobs)
            },
            "cancel_job" => { cancel_job(arg(&args, "id")?, state)?; Ok(Value::Null) },
            "clear_finished" => { clear_finished(state); Ok(Value::Null) },
            "open_file" => { open_file(arg(&args, "path")?)?; Ok(Value::Null) },
            "reveal_file" => { reveal_file(arg(&args, "path")?)?; Ok(Value::Null) },
            "preview_images" => {
                let previews = preview_images(arg(&args, "request")?, arg(&args, "revision")?, state).await?;
                remember(bridge, previews.iter().map(|p| p.path.clone())); serde_json::to_value(previews)
            },
            "visual_preview" => serde_json::to_value(visual_preview(arg(&args, "request")?, arg(&args, "revision")?, state).await?),
            "estimate_videos" => serde_json::to_value(estimate_videos(arg(&args, "request")?, state).await?),
            "cancel_image_preview" => { cancel_image_preview(arg(&args, "revision")?, state); Ok(Value::Null) },
            "cancel_visual_preview" => { cancel_visual_preview(arg(&args, "revision")?, state); Ok(Value::Null) },
            "quit" => {
                let handle = app.clone();
                std::thread::spawn(move || { std::thread::sleep(std::time::Duration::from_millis(200)); handle.exit(0); });
                Ok(Value::Null)
            },
            _ => return Err("Unknown command".into()),
        }.map_err(|e| e.to_string())?)
    });
    result
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8", "js" => "text/javascript", "css" => "text/css", "svg" => "image/svg+xml",
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "bmp" => "image/bmp",
        "mp4" | "m4v" => "video/mp4", "webm" => "video/webm", "mov" => "video/quicktime", "mp3" => "audio/mpeg", "m4a" => "audio/mp4",
        "wav" => "audio/wav", "ogg" | "opus" => "audio/ogg", "flac" => "audio/flac", "pdf" => "application/pdf", "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}
fn byte_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let (first, last) = value.strip_prefix("bytes=")?.split_once('-')?;
    if size == 0 { return None; }
    let (start, end) = if first.is_empty() {
        let suffix = last.parse::<u64>().ok()?; if suffix == 0 { return None; }
        (size.saturating_sub(suffix), size - 1)
    } else { (first.parse::<u64>().ok()?, if last.is_empty() { size - 1 } else { last.parse::<u64>().ok()?.min(size - 1) }) };
    if start > end || start >= size { None } else { Some((start, end)) }
}
fn media(request: Request, path: &Path, origin: Option<&str>) {
    let Ok(mut file) = fs::File::open(path) else { reply(request, 404, json!({"error":"File unavailable"}), origin); return; };
    let Ok(metadata) = file.metadata() else { reply(request, 404, json!({"error":"File unavailable"}), origin); return; };
    let size = metadata.len();
    let range = header(&request, "Range");
    let selected = range.as_ref().and_then(|r| byte_range(r, size));
    if range.is_some() && selected.is_none() {
        let response = Response::empty(416).with_header(Header::from_bytes("Content-Range", format!("bytes */{size}")).unwrap());
        let _ = request.respond(response); return;
    }
    let (start, length) = selected.map(|(start, end)| (start, end - start + 1)).unwrap_or((0, size));
    if file.seek(SeekFrom::Start(start)).is_err() { reply(request, 500, json!({"error":"Cannot seek file"}), origin); return; }
    let mut values = headers(origin);
    // Never serve an HTML/SVG file as active content under the helper's origin.
    let content_type = match mime(path) { "text/html; charset=utf-8" | "image/svg+xml" | "text/javascript" | "text/css" => "application/octet-stream", other => other };
    values.push(Header::from_bytes("Content-Type", content_type).unwrap());
    values.push(Header::from_bytes("Accept-Ranges", "bytes").unwrap());
    if selected.is_some() { values.push(Header::from_bytes("Content-Range", format!("bytes {start}-{}/{size}", start + length - 1)).unwrap()); }
    let response = Response::new(StatusCode(if selected.is_some() { 206 } else { 200 }), values, file.take(length), Some(length as usize), None);
    let _ = request.respond(response);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits_browser_origins() {
        assert!(allowed_origin(HOSTED_ORIGIN, 12345));
        assert!(allowed_origin("http://127.0.0.1:12345", 12345));
        for origin in ["null", "https://siriuslemaitre.github.io.evil.com", "http://localhost:12345", "https://evil.com"] { assert!(!allowed_origin(origin, 12345)); }
    }
    #[test]
    fn media_ranges_support_seeking_and_reject_invalid_ranges() {
        assert_eq!(byte_range("bytes=2-5", 10), Some((2, 5)));
        assert_eq!(byte_range("bytes=2-", 10), Some((2, 9)));
        assert_eq!(byte_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(byte_range("bytes=0-99", 10), Some((0, 9)));
        for value in ["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=0-1,3-4", "bytes=a-b"] { assert_eq!(byte_range(value, 10), None); }
        assert_eq!(byte_range("bytes=0-", 0), None);
    }
}
