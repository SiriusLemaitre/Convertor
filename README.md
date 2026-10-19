# Convertor

Convert images, PDFs, audio, and video locally. Includes batch processing, previews, presets, and a cancellable job queue. Original files are preserved; duplicate output names receive numbered suffixes.

## Desktop

Download your platform from [GitHub Releases](https://github.com/SiriusLemaitre/Convertor/releases/latest):

| Platform | Package |
| --- | --- |
| Windows 10/11, x64 | Setup executable; includes offline WebView2 installation |
| macOS 15+, Intel or Apple Silicon | DMG for your processor; drag Convertor to Applications |
| Linux x64, Ubuntu 22.04 or newer compatible desktop | AppImage; make executable and run. Without FUSE, use `--appimage-extract-and-run`. |

FFmpeg/FFprobe, qpdf, Poppler, yt-dlp, Deno, and their runtime libraries are bundled. No separate engine, Python, or package-manager installation is required. Desktop builds are unsigned; macOS may require approval in Privacy & Security on first launch.

**YouTube Converter:** paste up to 50 HTTPS video links, choose audio, video, or GIF, and download. The default destination is your OS Downloads folder; a selected output folder takes precedence. Playlists are not expanded. Internet access is required, and YouTube restrictions may prevent downloads.

Other tools convert/edit images; merge, split, and render PDFs; convert/trim media; extract audio or frames; compress to a size limit; and remove metadata. Settings control the output folder, concurrency, appearance, and optional engine overrides. Local conversions work offline.

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
