import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { api, desktop, type InputFile, type JobRequest, type VideoEstimate } from './api';
import { fileName, formatBytes } from './tools';

export type VideoSettings = { format: string; videoQuality: number; videoHeight: number; videoFps: number };
export const defaultVideoSettings: VideoSettings = { format: 'mp4', videoQuality: 65, videoHeight: 0, videoFps: 0 };

export default function VideoOptions({ files, enabled, value, onChange }: { files: InputFile[]; enabled: boolean; value: VideoSettings; onChange: Dispatch<SetStateAction<VideoSettings>> }) {
  const [estimates, setEstimates] = useState<VideoEstimate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setEstimates([]); setError('');
    if (!desktop || !enabled || !files.length) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      const request: JobRequest = { kind: 'video', inputs: files.map(file => file.path), outputDir: '', outputName: '', bitrate: 192, width: 640, fps: 15, start: 0, duration: null, ...value };
      api.estimateVideos(request).then(results => { if (active) setEstimates(results); })
        .catch(reason => { if (active) setError(String(reason)); })
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [files, enabled, value]);
  const total = estimates.reduce((sum, item) => sum + item.size, 0);
  const sourceSize = files.reduce((sum, file) => sum + file.size, 0);
  return <>
    <label className="field"><span>Format</span><div className="select-wrap"><select value={value.format} onChange={e => onChange(s => ({ ...s, format: e.target.value }))}>{['mp4', 'mkv', 'webm', 'mov'].map(format => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select><ChevronDown size={15} /></div></label>
    <label className="field"><span>Quality <strong>{value.videoQuality}%</strong></span><input aria-label="Video quality" type="range" min="1" max="100" value={value.videoQuality} onChange={e => onChange(s => ({ ...s, videoQuality: Number(e.target.value) }))} /><small className="video-hint">Lower for smaller files · Higher for more detail</small></label>
    <div className="field-pair">
      <label className="field"><span>Resolution</span><div className="select-wrap"><select value={value.videoHeight} onChange={e => onChange(s => ({ ...s, videoHeight: Number(e.target.value) }))}><option value="0">Original</option>{[360, 480, 720, 1080, 1440, 2160].map(height => <option key={height} value={height}>Up to {height}p</option>)}</select><ChevronDown size={15} /></div></label>
      <label className="field"><span>Frame rate</span><div className="select-wrap"><select value={value.videoFps} onChange={e => onChange(s => ({ ...s, videoFps: Number(e.target.value) }))}><option value="0">Original</option>{[15, 24, 25, 30, 50, 60].map(fps => <option key={fps} value={fps}>Up to {fps} fps</option>)}</select><ChevronDown size={15} /></div></label>
    </div>
    <div className="size-preview" aria-live="polite">
      <div className="preview-heading"><span>Estimated output size</span>{loading ? <LoaderCircle size={15} className="spin" aria-label="Estimating output size" /> : <strong data-testid="video-estimate-size" data-bytes={estimates.length ? total : undefined}>{estimates.length ? `≈ ${formatBytes(total)}` : '—'}</strong>}</div>
      {estimates.map(item => <div className="preview-row" key={item.path}><span title={item.path}>{fileName(item.path)}</span><small>{item.width} × {item.height} · {Number(item.fps.toFixed(2))} fps</small><span>{formatBytes(item.size)}</span></div>)}
      {estimates.length > 0 && sourceSize > 0 && <p className="video-hint">{total < sourceSize ? `About ${Math.round((1 - total / sourceSize) * 100)}% smaller` : 'May be larger than the original. Try lower quality or resolution.'}</p>}
      <p className="video-hint">{files.length ? 'Based on duration and target bitrate. Actual size varies with video content.' : 'Add videos to estimate size.'}</p>
      {error && <p className="preview-error" role="alert">{error}</p>}
    </div>
  </>;
}
