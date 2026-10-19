Standalone website update after v0.3.0

- The public GitHub Pages app now processes files directly in the browser. No desktop app, local helper, pairing, account, or uploads are required.
- Image, PDF, audio, and video tools run on your device, with previews, a cancellable queue, and download buttons. Multi-file exports download as ZIP archives.
- Audio/video processing lazily loads a bundled single-thread FFmpeg WASM engine. Browser limits: 256 MB per file, 512 MB per selection, 200 PDF page images or 1,000 video frames per export.
- YouTube downloading is explicitly unavailable in the standalone website. Local video-file conversion works in the browser; the Windows app retains its YouTube tool.
- This is a website update. The published v0.3.0 Windows installer and portable app remain available separately.
