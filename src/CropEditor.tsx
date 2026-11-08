import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { api, fileSource, type JobRequest } from './api';
import { changeCrop, fullCrop, ratioCrop, validCrop, type CropRect } from './cropGeometry';

const handles = [['nw','top left'],['n','top'],['ne','top right'],['e','right'],['se','bottom right'],['s','bottom'],['sw','bottom left'],['w','left']] as const;
let fallbackRevision = Date.now();
export default function CropEditor({ request, onChange }: { request: JobRequest; onChange: (rect: CropRect) => void }) {
  const video = request.kind === 'video-crop';
  const source = request.inputs[0], src = fileSource(source);
  const rotation = video ? 0 : request.rotation || 0;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fallback, setFallback] = useState('');
  const [error, setError] = useState('');
  const [time, setTime] = useState(0), [duration, setDuration] = useState(0), [playing, setPlaying] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null), media = useRef<HTMLVideoElement>(null), stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; handle: string; rect: CropRect } | null>(null);
  const fallbackId = useRef(0);
  const ready = size.width > 0 && size.height > 0;
  let rect = request.cropRatio === 'custom' && validCrop(request.cropRect) ? request.cropRect : ratioCrop(request.cropRatio || '', size.width, size.height);
  if (request.cropRatio === 'custom' && !request.cropRect && video && ready && request.imageWidth && request.imageHeight) {
    const legacy = { x: (request.cropX || 0) / size.width, y: (request.cropY || 0) / size.height, width: request.imageWidth / size.width, height: request.imageHeight / size.height };
    if (validCrop(legacy)) rect = legacy;
  }
  useEffect(() => () => { const id=fallbackId.current; fallbackId.current=0; if (id) void api.cancelVisualPreview(id).catch(() => {}); }, []);
  useEffect(() => () => { if (fallback) URL.revokeObjectURL(fallback); }, [fallback]);
  async function decodeFallback() {
    if (fallbackId.current) return;
    const id = ++fallbackRevision; fallbackId.current = id; setDecoding(true);
    try {
      const data = await api.visualPreview({ ...request, kind: video ? 'frames' : 'image-edit', operation: 'single', start: 0, format: 'png', cropRatio: '', cropRect: null, imageWidth: 0, imageHeight: 0 }, id);
      if (fallbackId.current === id) setFallback(URL.createObjectURL(new Blob([new Uint8Array(data.bytes)], { type: data.mime })));
    } catch (e) { setError(`Could not load this source for visual cropping: ${String(e)}`); }
    finally { setDecoding(false); }
  }
  useEffect(() => {
    if (video && !fallback) return;
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (!active || !canvas.current) return;
      const angle = fallback ? 0 : rotation;
      const width = angle % 180 ? img.naturalHeight : img.naturalWidth, height = angle % 180 ? img.naturalWidth : img.naturalHeight;
      setSize({ width, height });
      const scale = Math.min(1, 1200 / Math.max(width, height));
      const target = canvas.current; target.width = Math.round(width * scale); target.height = Math.round(height * scale);
      const ctx = target.getContext('2d')!; ctx.translate(target.width / 2, target.height / 2); ctx.rotate(angle * Math.PI / 180);
      ctx.drawImage(img, -img.naturalWidth * scale / 2, -img.naturalHeight * scale / 2, img.naturalWidth * scale, img.naturalHeight * scale);
    };
    img.onerror = () => { if (active && !fallback) void decodeFallback(); };
    img.src = fallback || src;
    return () => { active = false; };
  }, [src, rotation, fallback, video]);
  function down(e: PointerEvent, handle: string) {
    if (!ready || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); media.current?.pause();
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, handle, rect };
    stage.current!.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    const start = drag.current, bounds = stage.current?.getBoundingClientRect();
    if (!start || start.id !== e.pointerId || !bounds) return;
    onChange(changeCrop(start.rect, start.handle, (e.clientX-start.x)/bounds.width, (e.clientY-start.y)/bounds.height, Math.min(1,2/size.width), Math.min(1,2/size.height)));
  }
  function key(e: KeyboardEvent, handle: string) {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
    e.preventDefault(); const step = e.shiftKey ? 10 : 1;
    onChange(changeCrop(rect,handle,(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0)/size.width,(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)/size.height,Math.min(1,2/size.width),Math.min(1,2/size.height)));
  }
  return <div className="crop-editor" aria-label="Visual crop editor">
    <p className="crop-instructions">Drag inside the box to move it. Drag an edge or corner to resize.</p>
    <div className="crop-stage" ref={stage} style={{ aspectRatio: ready ? `${size.width}/${size.height}` : '4/3', maxWidth: ready ? `${480*size.width/size.height}px` : undefined, marginInline: 'auto' }} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      {video && !fallback ? <video ref={media} src={src} preload="auto" playsInline onLoadedMetadata={e => { const v=e.currentTarget; setSize({width:v.videoWidth,height:v.videoHeight}); setDuration(v.duration); }} onError={() => void decodeFallback()} onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} /> : <canvas ref={canvas} aria-label="Crop source" />}
      {ready && <div className="crop-box" role="group" aria-label="Crop selection" tabIndex={0} onKeyDown={e => key(e,'move')} onPointerDown={e => down(e,'move')} style={{ left:`${rect.x*100}%`, top:`${rect.y*100}%`, width:`${rect.width*100}%`, height:`${rect.height*100}%` }}>
        <div className="crop-grid" />
        {handles.map(([handle,label]) => <button key={handle} type="button" className={`crop-handle crop-${handle}`} aria-label={`Resize crop ${label}`} onPointerDown={e => down(e,handle)} onKeyDown={e => { e.stopPropagation(); key(e,handle); }} />)}
      </div>}
      {!ready && <span className="crop-loading">{decoding ? 'Preparing crop preview…' : 'Loading source…'}</span>}
    </div>
    {video && !fallback && ready && <div className="crop-playback"><button className="secondary-button" onClick={() => { const v=media.current!; if (v.paused) void v.play().catch(e => setError(String(e))); else v.pause(); }}>{playing?'Pause':'Play'}</button><input aria-label="Crop preview timestamp" type="range" min={0} max={Number.isFinite(duration)?duration:0} step={.01} value={time} onChange={e => { media.current!.currentTime=Number(e.target.value); }} /><span>{time.toFixed(2)} s</span></div>}
    {fallback && video && <p className="option-hint">Showing the first frame. The crop applies to the full video.</p>}
    {ready && <div className="crop-summary"><output aria-label="Crop dimensions">{video ? Math.max(2,Math.floor(rect.width*size.width/2)*2) : Math.round(rect.width*size.width)} × {video ? Math.max(2,Math.floor(rect.height*size.height/2)*2) : Math.round(rect.height*size.height)} px</output><button className="text-button" onClick={() => onChange(fullCrop)}>Use full frame</button></div>}
    <p className="crop-instructions">Arrow keys move a focused box or edge; hold Shift for larger steps.{request.inputs.length > 1 ? ' The same relative area applies to every file.' : ''}</p>
    {error && <p role="alert" className="preview-error">{error}</p>}
  </div>;
}
