# Convertor

A local desktop toolbox built with Tauri, React, TypeScript, and Rust. Native FFmpeg handles video-to-MP3 and video-to-GIF; native qpdf merges PDFs without rasterizing pages.

## Use

On Windows, double-click `Start-Convertor.cmd`. If a portable build exists in `release/`, it opens directly. Otherwise the launcher uses the development setup.

- **Video to MP3:** add one or more videos, select 128/192/320 kbps, and convert.
- **Video:** batch-convert videos to MP4, MKV, WebM, or MOV. Adjust quality (1–100), resolution (original or up to 360p–2160p), and frame rate (original or up to 15–60 fps). Dimensions keep aspect ratio and never upscale; frame rates never exceed the source. MP4/MKV/MOV use H.264 + AAC; WebM uses VP9 + Opus. Size estimates use each video's duration and target bitrate, including audio and approximate container overhead. Actual size varies with content and may exceed the input size. The first video stream and optional first audio stream are exported; subtitles and additional tracks are omitted. FFprobe must be beside FFmpeg for this tool.
- **Merge PDFs:** add at least two documents, reorder with the arrows, name the output, and merge.
- **Video to GIF:** converts the full video by default. Choose max width and frame rate, or select **Trim** to set start and end times. GIFs loop continuously and use an optimized palette. Two streaming passes keep memory use bounded for long videos.
- **Images:** convert between PNG, JPG, WebP, BMP, and TIFF. A 0–100% resolution slider scales each image from its own original dimensions, keeping aspect ratio; 100% preserves the original dimensions. At 0%, conversion is disabled because an image needs at least one pixel. JPG and WebP offer quality controls. Output size is measured by encoding temporary files using the same settings as export; previews refresh automatically and are cancelled when settings change. Animated inputs export the first frame.
- **Audio:** convert MP3, OGG (Vorbis), WAV (16-bit PCM), FLAC, and M4A (AAC). Common AAC, Opus, AIFF, and WMA inputs are also supported. MP3/M4A offer bitrate controls; OGG offers quality presets; WAV and FLAC use lossless codecs.
- **Split & extract PDFs:** extract selected pages into a new PDF, remove pages, or save each page as a separate PDF. Selections use `1, 3-5`; split accepts an empty selection for all pages. Selection order is preserved, and duplicate pages are removed.
- **Images to PDF:** arrange photos or scans in list order, then save one image per page. Each page preserves the image's aspect ratio within A4 dimensions. Images are encoded as JPEG, and transparency is flattened.
- **PDF to images:** export all or selected pages as PNG or JPG at 72–300 DPI. Each source document gets a separate output folder. Uses bundled Poppler (`pdftoppm` and `pdfinfo`).
- **Trim audio & video:** set start and end times, or use the source player's current position. Play the selected range before exporting. Audio exports as AAC in M4A; video exports as H.264/AAC in MP4. Re-encoding gives accurate cuts. Playback depends on WebView2's supported codecs; still-frame previews work through FFmpeg.
- **Compress to size:** set a maximum decimal MB size per file. Images export as JPG with reduced quality/resolution when needed; audio as MP3; video as MP4 using two-pass encoding. Actual size is checked before publishing. Impossible limits fail without saving an oversized output. PDFs are not accepted.
- **Resize, crop & rotate:** choose an image format, dimensions or an aspect-preserving bounding box, centered crop ratio, and clockwise rotation. Operations run in the order rotation, crop, resize. Both dimensions at 0 preserve the size after cropping. Before/after previews are scaled for display; exports use the selected dimensions.
- **Extract video frames:** export one frame at a timestamp, or frames at intervals from a start timestamp to the end. Interval exports are saved in a new folder. Limited to 10,000 frames per source.
- **Remove metadata:** save clean copies of supported images, audio, videos, and PDFs. Images are re-encoded and their orientation is applied to pixels. Media tags, chapters, attachments, and private data tracks are omitted; audio/video/subtitle streams are copied. PDF document information and XMP metadata are removed. Visible text, annotations, form contents, and other embedded document content are not redacted.
- **Job queue:** view progress, cancel queued/running jobs, preview completed files, or open the output folder.
- **Settings:** choose the default output folder, 1–4 simultaneous jobs, and optional custom engine executables.

Processing runs offline. Original inputs are never changed. Outputs are first written to a temporary file and committed without overwriting existing files; collisions receive numbered suffixes. Temporary files are removed on cancellation/failure. Closing the app cancels active work. Queue history lasts for the current session; preferences are saved in the OS application config directory.

PDF merging combines pages in order. It does not promise to preserve document-level bookmarks, signatures, attachments, or interactive form behavior. Password-protected inputs require an unprotected copy in this version.

Tools are grouped into Documents, Images, Audio, Video, and Utilities. Filter by category or search by tool, description, or format. Trimming is also linked under Audio. Mouse side buttons, toolbar arrows, and Alt+Left/Right navigate through visited tools and pages. Navigation preserves each tool's selected files for the session.

Each tool remembers its options between launches and supports named presets. These are stored locally in the WebView profile. Reset options restores that tool's defaults; saved presets can be selected or deleted separately. Source players, image comparisons, PDF page previews, and video still previews help inspect inputs before export. Completed single-file jobs offer an output preview; multi-file exports offer an open-folder button.

Poppler is kept in `binaries/poppler/Library/bin/` with its runtime DLLs. Custom PDF renderer paths should point to `pdftoppm`, with `pdfinfo` beside it. `scripts/setup-engines.ps1` downloads the pinned renderer build and checks its SHA-256 hash. Its source and license notices ship alongside the other engines.

## Development

Requirements: Node.js 22.12+, Rust, the platform's Tauri prerequisites, and FFmpeg/qpdf/Poppler. Windows users normally use the MSVC Rust toolchain and Visual Studio C++ Build Tools. A workspace-local GNU toolchain is also supported by `scripts/env.ps1` when present.

```powershell
# If this workspace has locally provisioned tools:
. ./scripts/env.ps1
npm install
npm run desktop
```

If PowerShell blocks scripts, use the launcher or run a separate process with
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1`.

`npm run dev` shows the interface in a browser. Native dialogs and processing require the desktop app; the browser view clearly labels this limitation.

Engines are found in bundled `binaries/`, beside the executable, or on PATH. Custom paths override discovery. FFprobe, when available beside FFmpeg, supplies duration for progress tracking. Put Windows binaries and any dependent DLLs in `src-tauri/binaries/`. These are excluded from source control; use `scripts/setup-engines.ps1` to fetch them.

```powershell
npm run build                  # TypeScript + production frontend
npm test                       # Input routing tests
cargo test --manifest-path src-tauri/Cargo.toml
./scripts/build.ps1            # Release app + Windows installer
```

Native integration tests require the bundled engines:

```powershell
$env:CONVERTOR_ENGINE_DIR = (Resolve-Path src-tauri/binaries).Path
cargo test --manifest-path src-tauri/Cargo.toml -- --include-ignored
```

For UI checks, run `npm run dev` then `node scripts/check-ui.mjs`. Set `BROWSER_PATH` to a Chromium-based browser executable if Brave is not installed.

After building the portable app, `node scripts/check-desktop.mjs` launches a test instance with WebView2 debugging enabled, supplies generated fixtures through a drop event, and runs all fourteen tools through the real interface. It uses an isolated WebView2 profile and closes the test instance afterwards. Normal launches do not enable debugging.

## Add a tool

1. Register metadata, accepted extensions, and the icon in `src/tools.ts`.
2. Add its options and typed request fields in `src/api.ts` and the tool panel.
3. Add validation and execution in `src-tauri/src/engine.rs`. Use direct process arguments rather than a shell.
4. Reuse the job queue, cancellation, progress, and safe output commit.

## Distribution

Bundle the entire `release/` folder when sharing a portable build; the engines and DLLs are required. The NSIS installer bundles them automatically. Builds are unsigned.

Third-party binary licenses and source links are shipped alongside the engines. The included FFmpeg build is GPL-licensed; review the supplied terms and provide corresponding source when distributing binaries. qpdf is Apache-2.0. This repository's own code is MIT licensed; see `LICENSE`.
