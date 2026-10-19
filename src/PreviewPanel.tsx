import { useEffect, useRef, useState } from 'react';
import { Eye, LoaderCircle } from 'lucide-react';
import { api, desktop, fileSource, type JobRequest } from './api';
import { fileName } from './tools';
import ImageViewer from './ImageViewer';

let revision = Date.now();
export default function PreviewPanel({ request, onSelection, autoImagePreview = true, previewEnabled = true }: { request: JobRequest; autoImagePreview?: boolean; previewEnabled?: boolean; onSelection?: (key: 'start' | 'end', time: number) => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [mediaError, setMediaError] = useState(false);
  const [expanded, setExpanded] = useState<{ src: string; label: string } | null>(null);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const current = useRef(0);
  const source = request.inputs[0];
  const extension = source?.split('.').pop()?.toLowerCase() || '';
  const image = ['png','jpg','jpeg','webp','bmp','tiff','tif','gif'].includes(extension);
  const audio = ['mp3','ogg','wav','flac','m4a','aac','opus','aiff','aif','wma','ac3'].includes(extension);
  const pdf = extension === 'pdf';
  const encodedRequest = JSON.stringify(request);
  useEffect(() => {
    setUrl(''); setExpanded(null); setError(''); setLoading(false);
    const timer = image && autoImagePreview && previewEnabled && desktop && ['image', 'image-edit'].includes(request.kind)
      ? setTimeout(() => void preview(), 250) : undefined;
    return () => { clearTimeout(timer); const id = current.current; current.current = 0; if (id) void api.cancelVisualPreview(id).catch(() => {}); };
  }, [encodedRequest, autoImagePreview, previewEnabled]);
  useEffect(() => { setMediaError(false); setTime(0); }, [source]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function preview() {
    if (!source || !desktop || !previewEnabled) return;
    if (current.current) void api.cancelVisualPreview(current.current).catch(() => {});
    const id = revision = Math.max(Date.now(), revision+1); current.current = id;
    setLoading(true); setError('');
    try {
      const data = await api.visualPreview(request, id);
      if (current.current !== id) return;
      setUrl(URL.createObjectURL(new Blob([new Uint8Array(data.bytes)], { type: data.mime })));
    } catch (e) { if (current.current === id) setError(String(e)); }
    finally { if (current.current === id) setLoading(false); }
  }
  if (!source) return null;
  const src = desktop ? fileSource(source) : '';
  const isSelection = request.kind === 'trim' || request.kind === 'gif' && request.duration !== null;
  function timeUpdate() {
    const element = media.current; if (!element) return;
    setTime(element.currentTime);
    if (isSelection && request.duration !== null && element.currentTime >= request.start + request.duration) element.pause();
  }
  return <section className="preview-panel" aria-label="File preview">
    <div className="panel-heading"><h2>Preview</h2><span title={source}>{fileName(source)}</span></div>
    {image && <div className="comparison"><figure><figcaption>Original</figcaption><button className="preview-image-button" aria-label="Enlarge original image" onClick={() => setExpanded({ src, label: 'Original image' })}><img src={src} alt="Original image" /></button></figure>{url && <figure><figcaption>{request.kind === 'image-edit' || request.kind === 'image' ? 'After changes' : 'Preview'}</figcaption><button className="preview-image-button" aria-label="Enlarge output preview" onClick={() => setExpanded({ src: url, label: 'Output preview' })}><img src={url} alt="Output preview" /></button></figure>}</div>}
    {!image && !pdf && <>
      {audio ? <audio ref={media} controls src={src} onTimeUpdate={timeUpdate} onError={() => setMediaError(true)} /> : <video ref={media} controls preload="metadata" src={src} onTimeUpdate={timeUpdate} onError={() => setMediaError(true)} />}
      {mediaError && <p className="option-hint">This format cannot play in the preview. Conversion is still available.{!audio && ' Use Preview frame below to inspect a still.'}</p>}
      <div className="preview-controls"><span>{time.toFixed(2)} s</span>{onSelection && <><button className="secondary-button" onClick={() => onSelection('start', time)}>Use as start</button>{request.kind !== 'frames' && <button className="secondary-button" onClick={() => onSelection('end', time)}>Use as end</button>}</>}{isSelection && <button className="secondary-button" onClick={() => { if (media.current) { media.current.currentTime = request.start; void media.current.play().catch(e => setError(String(e))); } }}>Play selection</button>}</div>
    </>}
    {!audio && <button className="secondary-button" disabled={loading || !desktop || !previewEnabled} onClick={preview}>{loading ? <LoaderCircle size={15} className="spin" /> : <Eye size={15} />}{image ? 'Preview changes' : pdf ? 'Preview selected page' : 'Preview frame'}</button>}
    {!image && url && <button className="preview-image-button" aria-label="Enlarge rendered preview" onClick={() => setExpanded({ src: url, label: pdf ? 'PDF page preview' : 'Video frame preview' })}><img className="rendered-preview" src={url} alt={pdf ? 'PDF page preview' : 'Video frame preview'} /></button>}
    {error && <p className="preview-error" role="alert">{error}</p>}
    <p className="option-hint">{request.inputs.length > 1 ? 'Preview shows the first file. ' : ''}{pdf ? 'The first selected page is shown.' : image ? 'Visual previews are scaled to fit. Export uses your chosen dimensions.' : 'Playback uses the source file. Preview frame uses the start timestamp.'}</p>
    {expanded && <ImageViewer src={expanded.src} label={expanded.label} onClose={() => setExpanded(null)} />}
  </section>;
}
