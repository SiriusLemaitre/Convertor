import { validCrop } from './cropGeometry';
import type { JobRequest } from './api';

export function cropVideoFilter(r: JobRequest): string {
  if (r.cropRatio === 'custom' && r.cropRect) {
    if (!validCrop(r.cropRect)) throw new Error('Choose a crop area inside the source.');
    const c = r.cropRect;
    return `crop=w='max(2,trunc(iw*${c.width}/2)*2)':h='max(2,trunc(ih*${c.height}/2)*2)':x='min(iw-ow,round(iw*${c.x}))':y='min(ih-oh,round(ih*${c.y}))':exact=1`;
  }
  if (r.cropRatio === 'custom') {
    const values = [r.cropX, r.cropY, r.imageWidth, r.imageHeight];
    if (!values.every(v => Number.isSafeInteger(v) && v! >= 0 && v! <= 32768) || r.imageWidth! < 2 || r.imageHeight! < 2) throw new Error('Enter a valid crop rectangle.');
    // A rectangle outside the decoded frame must fail rather than silently move.
    const fits = `gte(iw,${r.cropX! + r.imageWidth!})*gte(ih,${r.cropY! + r.imageHeight!})`;
    return `crop=w='if(${fits},${r.imageWidth},0)':h=${r.imageHeight}:x=${r.cropX}:y=${r.cropY}:exact=1,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
  }
  const ratio = r.cropRatio || '1:1';
  if (!['1:1','4:3','3:2','16:9','9:16'].includes(ratio)) throw new Error('Choose a supported crop ratio.');
  const [a,b] = ratio.split(':');
  return `crop=w='trunc(min(iw,ih*${a}/${b})/2)*2':h='trunc(min(ih,iw*${b}/${a})/2)*2':x='(iw-ow)/2':y='(ih-oh)/2':exact=1`;
}
