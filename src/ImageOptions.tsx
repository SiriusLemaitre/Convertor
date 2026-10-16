import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { api, desktop, type ImagePreview, type JobRequest, type InputFile } from './api';
import { fileName, formatBytes } from './tools';

export type ImageSettings = { format: string; scale: number; quality: number };
export const defaultImageSettings: ImageSettings = { format: 'png', scale: 100, quality: 80 };
let previewRevision = Date.now();
export function imageFields(settings: ImageSettings) {
  return { format: settings.format, imageScalePercent: settings.scale, imageQuality: settings.quality };
}
export function validImageSettings(settings: ImageSettings) {
  return Number.isInteger(settings.scale) && settings.scale > 0 && settings.scale <= 100;
}

export default function ImageOptions({ files, enabled, value, onChange }: { files: InputFile[]; enabled: boolean; value: ImageSettings; onChange: Dispatch<SetStateAction<ImageSettings>> }) {
  const [previews, setPreviews] = useState<ImagePreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { format, imageScalePercent, imageQuality } = imageFields(value);
  const valid = validImageSettings(value);

  useEffect(() => {
    setPreviews([]); setError('');
    if (!desktop || !enabled || files.length === 0 || !valid) { setLoading(false); return; }
    const revision = previewRevision = Math.max(Date.now(), previewRevision + 1);
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      const request: JobRequest = { kind: 'image', inputs: files.map(file => file.path), outputDir: '', outputName: '', bitrate: 192, width: 640, fps: 15, start: 0, duration: null, format, imageScalePercent, imageQuality };
      api.previewImages(request, revision).then(results => {
        if (!active) return;
        setPreviews(results);
      }).catch(reason => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); void api.cancelPreview(revision).catch(() => {}); };
  }, [files, enabled, valid, format, imageScalePercent, imageQuality]);

  return <>
    <label className="field"><span>Format</span><div className="select-wrap"><select value={value.format} onChange={event => onChange(current => ({ ...current, format: event.target.value }))}>{['png', 'jpg', 'webp', 'bmp', 'tiff'].map(format => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select><ChevronDown size={15} /></div></label>
    <label className="field"><span>Resolution <strong>{value.scale}%</strong></span><input aria-label="Resolution" type="range" min="0" max="100" step="1" value={value.scale} onChange={event => onChange(current => ({ ...current, scale: Number(event.target.value) }))} /></label>
    {!valid && <p className="preview-error">Select more than 0%.</p>}
    {['jpg', 'webp'].includes(value.format) && <label className="field"><span>Quality <strong>{value.quality}</strong></span><input type="range" min="1" max="100" value={value.quality} onChange={event => onChange(current => ({ ...current, quality: Number(event.target.value) }))} /></label>}
    <div className="size-preview">
      <div className="preview-heading"><span>Output size</span>{loading ? <LoaderCircle size={15} className="spin" aria-label="Calculating output size" /> : <strong data-testid="image-preview-size" data-bytes={previews.length ? previews.reduce((total, preview) => total + preview.size, 0) : undefined}>{previews.length ? formatBytes(previews.reduce((total, preview) => total + preview.size, 0)) : '—'}</strong>}</div>
      {previews.map(preview => <div className="preview-row" key={preview.path} data-width={preview.width} data-height={preview.height}><span title={preview.path}>{fileName(preview.path)}</span><small>{preview.width} × {preview.height}</small>{previews.length > 1 && <span title={`${preview.size} bytes`}>{formatBytes(preview.size)}</span>}</div>)}
      {error && <p className="preview-error" role="alert">{error}</p>}
    </div>
  </>;
}
