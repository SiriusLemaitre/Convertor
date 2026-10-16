import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';

export default function ImageViewer({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fitZoom, setFitZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const fitMode = useRef(true);
  const maxZoom = Math.max(8, fitZoom * 4);
  const zoomLimit = useRef(maxZoom); zoomLimit.current = maxZoom;
  const drag = useRef<{ pointer: number; x: number; y: number; left: number; top: number } | null>(null);
  const changeZoom = (value: number) => { fitMode.current = false; setZoom(Math.min(maxZoom, Math.max(.01, value))); };
  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !size.width || !size.height) return;
    const measure = () => {
      const fitted = Math.min((element.clientWidth - 32) / size.width, (element.clientHeight - 32) / size.height);
      if (fitted <= 0) return;
      setFitZoom(fitted);
      if (fitMode.current) { setZoom(fitted); element.scrollTo(0, 0); }
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [size]);
  useEffect(() => {
    const element = viewport.current;
    const wheel = (event: WheelEvent) => { event.preventDefault(); fitMode.current = false; setZoom(value => Math.min(zoomLimit.current, Math.max(.01, value * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))); };
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, []);
  function fit() {
    fitMode.current = true; setZoom(fitZoom); viewport.current?.scrollTo(0, 0);
  }
  return <dialog ref={dialog} className="image-viewer" aria-label={label} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="viewer-toolbar"><strong>{label}</strong><button className="icon-button" aria-label="Zoom out" disabled={zoom <= .01} onClick={() => changeZoom(zoom / 1.25)}><Minus size={18} /></button><label className="viewer-zoom"><span>Zoom</span><input aria-label="Image zoom" type="range" min="1" max={Math.ceil(maxZoom * 100)} value={Math.round(zoom * 100)} onChange={e => changeZoom(Number(e.target.value) / 100)} /><output>{Math.round(zoom * 100)}%</output></label><button className="icon-button" aria-label="Zoom in" disabled={zoom >= maxZoom} onClick={() => changeZoom(zoom * 1.25)}><Plus size={18} /></button><button className="secondary-button" onClick={fit}>Fit</button><button className="secondary-button" onClick={() => changeZoom(1)}>100%</button><button autoFocus className="icon-button" aria-label="Close image preview" onClick={onClose}><X size={20} /></button></div>
    <div className={`viewer-viewport ${panning ? 'panning' : ''}`} ref={viewport}
      onPointerDown={e => {
        if (e.button !== 0) return;
        const element = e.currentTarget;
        drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, left: element.scrollLeft, top: element.scrollTop };
        element.setPointerCapture(e.pointerId); setPanning(true); e.preventDefault();
      }}
      onPointerMove={e => {
        const start = drag.current; if (!start || start.pointer !== e.pointerId) return;
        e.currentTarget.scrollLeft = start.left + start.x - e.clientX;
        e.currentTarget.scrollTop = start.top + start.y - e.clientY;
      }}
      onPointerUp={e => { if (drag.current?.pointer === e.pointerId) { drag.current = null; setPanning(false); e.currentTarget.releasePointerCapture(e.pointerId); } }}
      onPointerCancel={() => { drag.current = null; setPanning(false); }}
      onLostPointerCapture={() => { drag.current = null; setPanning(false); }}>
      <div className="viewer-canvas"><img src={src} alt={label} draggable={false} style={{ width: size.width ? size.width * zoom : undefined, height: size.height ? size.height * zoom : undefined }} onLoad={e => {
        const img = e.currentTarget; setSize({ width: img.naturalWidth, height: img.naturalHeight });
      }} /></div>
    </div>
    <p className="viewer-hint">Scroll to zoom. Click and drag to move around the image. Esc to close.</p>
  </dialog>;
}
