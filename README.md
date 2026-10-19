# Convertor

Convert images, PDFs, audio, and video locally.

## Features

- Audio conversion
- Video conversion
- Image conversion
- Video to audio
- Video to GIF
- PDF merging
- PDF splitting, page extraction, and page removal
- Images to PDF
- PDF to images
- Image resizing, cropping, and rotation
- Audio and video trimming
- Single-frame and interval video frame extraction
- Image, audio, and video compression to a target size
- Image, audio, video, and PDF metadata removal
- YouTube to audio, video, and GIF (desktop)
- Quality, bitrate, resolution, and frame rate controls
- Batch processing
- Drag-and-drop file selection
- Tool search and category filters
- Source and output previews
- Image comparisons, zoom, and pan
- Saved tool options and named presets
- Job queue, progress tracking, and cancellation
- Concurrent jobs (desktop)
- Output folder selection (desktop)
- File and folder opening (desktop)
- Duplicate filename protection
- Custom processing engine paths (desktop)
- Light and dark themes
- Local, offline file processing (desktop)
- Browser-based file conversion

## Desktop

Download your platform from [GitHub Releases](https://github.com/SiriusLemaitre/Convertor/releases/latest):

| Platform | Package |
| --- | --- |
| Windows 10/11, x64 | Setup executable; includes offline WebView2 installation |
| macOS 15+, Intel or Apple Silicon | DMG for your processor; drag Convertor to Applications |
| Linux x64, Ubuntu 22.04 or newer compatible desktop | AppImage; make executable and run. Without FUSE, use `--appimage-extract-and-run`. |

FFmpeg/FFprobe, qpdf, Poppler, yt-dlp, Deno, and their runtime libraries are bundled. No separate engine, Python, or package-manager installation is required. Desktop builds are unsigned; macOS may require approval in Privacy & Security on first launch.

YouTube downloads default to your OS Downloads folder; a selected output folder takes precedence. Up to 50 HTTPS video links per batch; playlists are not expanded. Internet access is required, and YouTube restrictions may prevent downloads.

## Browser

[Open Convertor](https://siriuslemaitre.github.io/Convertor/) without installing anything. Files stay on your device; conversion uses bundled browser libraries and WebAssembly. Results download through your browser.

YouTube downloading requires the desktop app. Browser limits: 256 MB per file, 512 MB per selection, 200 PDF page images or 1,000 interval frames per export. Keep the tab open until results are downloaded. Media conversion is slower than desktop; browser memory and codecs impose additional limits.

## Development

Use Node.js 22.12+, Rust, and [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run dev       # Browser
npm test
npm run build
npm run desktop   # Native app; requires engines below
```

For native builds, run `scripts/setup-engines.ps1` on Windows. On macOS/Linux, install the build dependencies listed in `.github/workflows/release.yml`, then run `python3 scripts/setup-engines-unix.py`. Run native integration checks with `CONVERTOR_ENGINE_DIR` pointing to `src-tauri/binaries`:

```sh
cargo test --manifest-path src-tauri/Cargo.toml -- --include-ignored
npm run package -- --bundles nsis     # Windows
npm run package -- --bundles dmg      # macOS
npm run package -- --bundles appimage # Linux
```

The release workflow builds and tests each platform, then publishes all packages and SHA-256 checksums together when a matching `vX.Y.Z` tag is pushed. Manual runs produce artifacts only. GitHub Pages deploys separately from `main`.

App code: [MIT](LICENSE). Bundled engines have separate licenses, including GPL components; their notices, versions, and source links ship in `binaries/licenses`. See also [browser library notices](public/THIRD-PARTY-WEB.txt).
