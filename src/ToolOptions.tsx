import type { Dispatch, SetStateAction } from 'react';
import ImageOptions, { imageFields, validImageSettings } from './ImageOptions';
import VideoOptions from './VideoOptions';
import type { InputFile, JobRequest } from './api';
import type { ToolId } from './tools';
import { videoAudioFormats } from './tools';
import type { Preferences } from './preferences';

export function requestFor(kind: ToolId, files: InputFile[], p: Preferences, outputDir = ''): JobRequest {
  return { kind, inputs: files.map(f => f.path), outputDir, outputName: p.outputName,
    bitrate: p.bitrate, width: p.width, fps: p.fps, start: p.start,
    duration: kind === 'trim' || kind === 'gif' && p.trim ? p.end - p.start : null,
    ...(kind === 'gif' && !p.trim ? { start: 0 } : {}),
    pages: p.pages, operation: kind === 'frames' ? (p.operation === 'interval' ? 'interval' : 'single') : p.operation,
    targetMb: p.targetMb, imageWidth: p.imageWidth, imageHeight: p.imageHeight, keepAspect: p.keepAspect,
    imageQuality: 90, rotation: p.rotation, cropRatio: p.cropRatio, interval: p.interval, dpi: p.dpi,
    ...(kind === 'image' ? imageFields(p.image) : kind === 'video' ? p.video : kind === 'audio' || kind === 'mp3' ? { format: p.audioFormat } : { format: p.format }),
  };
}
export function validOptions(kind: ToolId, p: Preferences) {
  if (kind === 'image') return validImageSettings(p.image);
  if (kind === 'trim' || kind === 'gif' && p.trim) return p.start >= 0 && p.end > p.start;
  if (kind === 'pdf-pages') return p.operation === 'split' || /^\s*\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*\s*$/.test(p.pages);
  if (kind === 'compress') return p.targetMb >= 0.01 && p.targetMb <= 10000;
  if (kind === 'frames') return p.start >= 0 && p.interval >= 0.1;
  if (kind === 'image-edit') return p.imageWidth >= 0 && p.imageHeight >= 0 && (p.imageWidth === 0) === (p.imageHeight === 0);
  return true;
}
export default function ToolOptions({ kind, files, enabled, value: p, onChange }: { kind: ToolId; files: InputFile[]; enabled: boolean; value: Preferences; onChange: Dispatch<SetStateAction<Preferences>> }) {
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => onChange(s => ({ ...s, [key]: value }));
  const number = (label: string, key: 'start' | 'end' | 'targetMb' | 'interval' | 'imageWidth' | 'imageHeight', min: number, step = 1) => <label className="field"><span>{label}</span><input type="number" min={min} step={step} value={p[key]} onChange={e => set(key, Number(e.target.value))} /></label>;
  const select = (label: string, key: 'format' | 'audioFormat' | 'rotation' | 'cropRatio' | 'dpi' | 'width' | 'fps', options: [string | number, string][]) => <label className="field"><span>{label}</span><div className="select-wrap"><select value={p[key]} onChange={e => set(key, (typeof p[key] === 'number' ? Number(e.target.value) : e.target.value) as never)}>{options.map(([v, name]) => <option key={v} value={v}>{name}</option>)}</select></div></label>;
  return <>
    {kind === 'image' && <ImageOptions files={files} enabled={enabled} value={p.image} onChange={next => onChange(s => ({ ...s, image: typeof next === 'function' ? next(s.image) : next }))} />}
    {kind === 'video' && <VideoOptions files={files} enabled={enabled} value={p.video} onChange={next => onChange(s => ({ ...s, video: typeof next === 'function' ? next(s.video) : next }))} />}
    {(kind === 'audio' || kind === 'mp3') && select('Format', 'audioFormat', (kind === 'mp3' ? videoAudioFormats : ['mp3', 'ogg', 'wav', 'flac', 'm4a']).map(f => [f, f.toUpperCase()]))}
    {(kind === 'mp3' || kind === 'audio') && !['wav', 'flac', 'aiff'].includes(p.audioFormat) && <div className="field"><span>{p.audioFormat === 'ogg' ? 'Quality' : 'Bitrate'}</span><div className="segmented">{[128,192,320].map((b, i) => <button key={b} className={p.bitrate === b ? 'active' : ''} onClick={() => set('bitrate', b)}>{p.audioFormat === 'ogg' ? ['Small', 'Balanced', 'High'][i] : `${b} kbps`}</button>)}</div></div>}
    {kind === 'mp3' && <p className="option-hint">Accepts any video format your FFmpeg engine can decode, including uncommon extensions. Exports the first audio track. WAV, FLAC, and AIFF use lossless encoding.</p>}
    {kind === 'gif' && <><div className="field-pair">{select('Max width', 'width', [320,480,640,960,1280].map(n => [n, `${n} px`]))}{select('Frame rate', 'fps', [10,15,24,30].map(n => [n, `${n} fps`]))}</div><div className="field"><span>Duration</span><div className="segmented"><button className={!p.trim ? 'active' : ''} aria-pressed={!p.trim} onClick={() => set('trim', false)}>Full video</button><button className={p.trim ? 'active' : ''} aria-pressed={p.trim} onClick={() => set('trim', true)}>Trim</button></div></div></>}
    {(kind === 'trim' || kind === 'gif' && p.trim) && <><div className="field-pair">{number('Start (seconds)', 'start', 0, .1)}{number('End (seconds)', 'end', .1, .1)}</div><p className="option-hint">Clip length: {Math.max(0, p.end - p.start).toFixed(2)} seconds. Use the preview to choose the start and end.</p></>}
    {(kind === 'pdf' || kind === 'images-pdf') && <label className="field"><span>Document name</span><input value={p.outputName} maxLength={100} onChange={e => set('outputName', e.target.value)} /></label>}
    {kind === 'images-pdf' && <p className="option-hint">One image per page, in list order. Pages fit within A4 dimensions and keep each image’s aspect ratio. Transparency is flattened.</p>}
    {kind === 'pdf-pages' && <div className="field"><span>Action</span><div className="segmented">{[['extract','Extract'],['remove','Remove'],['split','Split']].map(([v,n]) => <button key={v} className={p.operation === v ? 'active' : ''} onClick={() => set('operation',v)}>{n}</button>)}</div></div>}
    {(kind === 'pdf-pages' || kind === 'pdf-images') && <label className="field"><span>{kind === 'pdf-pages' && p.operation === 'remove' ? 'Pages to remove' : 'Pages'}</span><input aria-label={kind === 'pdf-pages' && p.operation === 'remove' ? 'Pages to remove' : 'Pages'} placeholder="e.g. 1, 3-5" value={p.pages} onChange={e => set('pages', e.target.value)} /><small className="option-hint">{kind === 'pdf-images' || p.operation === 'split' ? 'Leave empty for all pages. ' : ''}Page numbers start at 1. Split saves a PDF for each selected page.</small></label>}
    {kind === 'pdf-images' && <div className="field-pair">{select('Format', 'format', [['png','PNG'],['jpg','JPG']])}{select('Resolution', 'dpi', [72,150,200,300].map(n => [n, `${n} DPI`]))}</div>}
    {kind === 'compress' && <>{number('Maximum size per file (MB)', 'targetMb', .01, .1)}<div className="segmented size-presets">{[1,5,10,25].map(n => <button key={n} className={p.targetMb === n ? 'active' : ''} onClick={() => set('targetMb', n)}>{n} MB</button>)}</div><p className="option-hint">Images export as JPG, audio as MP3, and videos as MP4. Quality and image resolution may decrease to fit. Each output is checked against the limit.</p></>}
    {kind === 'image-edit' && <>
      {select('Format', 'format', ['png','jpg','webp','bmp','tiff'].map(f => [f,f.toUpperCase()]))}
      <div className="field-pair">{number('Width (px)', 'imageWidth', 0)}{number('Height (px)', 'imageHeight', 0)}</div>
      <p className="option-hint">Set both to 0 to keep the size after cropping. Dimensions apply after rotation and cropping.</p>
      <label className="checkbox-field"><input type="checkbox" checked={p.keepAspect} onChange={e => set('keepAspect', e.target.checked)} />Fit within dimensions; keep aspect ratio</label>
      {select('Center crop', 'cropRatio', [['','No crop'],...['1:1','4:3','3:2','16:9','9:16'].map(r => [r,r] as [string,string])])}
      {select('Rotate clockwise', 'rotation', [0,90,180,270].map(n => [n, `${n}°`]))}
    </>}
    {kind === 'frames' && <><div className="field"><span>Capture</span><div className="segmented"><button className={p.operation !== 'interval' ? 'active' : ''} onClick={() => set('operation','single')}>Single frame</button><button className={p.operation === 'interval' ? 'active' : ''} onClick={() => set('operation','interval')}>At intervals</button></div></div>{number('Start / timestamp (seconds)', 'start', 0, .1)}{p.operation === 'interval' && number('Every (seconds)', 'interval', .1, .1)}{select('Format', 'format', [['png','PNG'],['jpg','JPG']])}<p className="option-hint">Interval captures are saved together in a new folder.</p></>}
    {kind === 'metadata' && <p className="option-hint">Save copies without embedded location, author, title, and other tags. Image orientation is baked into pixels. Media attachments, private data tracks, and chapters are omitted. Visible content and PDF annotations remain; this tool does not redact them.</p>}
    {!validOptions(kind,p) && <p className="preview-error" role="alert">Check the settings above before continuing.</p>}
  </>;
}
