import type { JobRequest } from './api';
import { fileBlob } from './browserFiles';
import { withMedia, readBytes, mediaMime, checkCancelled } from './browserMedia';

export function canvasFor(width: number, height: number) {
  width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
  if (width * height > 40_000_000 || width > 16384 || height > 16384) throw new Error('This image is too large for browser processing. Reduce the requested dimensions.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  return canvas;
}
export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = .9): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob && blob.type === type ? resolve(blob) : reject(new Error(`This browser cannot encode ${type}. Choose PNG or JPG.`)), type, quality));
}
async function decode(path: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const source = fileBlob(path);
  try { return await createImageBitmap(source); }
  catch {
    const png = await withMedia([path], signal, undefined, async (ffmpeg, [input], execute) => {
      await execute(['-i',input,'-frames:v','1','decoded.png']); return readBytes(ffmpeg, 'decoded.png');
    });
    return createImageBitmap(new Blob([png], { type:'image/png' }));
  }
}
export async function imageCanvas(path: string, request: Partial<JobRequest> = {}, signal?: AbortSignal) {
  checkCancelled(signal);
  const image = await decode(path, signal);
  try {
    const sourceWidth = image.width, sourceHeight = image.height;
    const rotation = ((request.rotation || 0) % 360 + 360) % 360;
    const rotated = canvasFor(rotation === 90 || rotation === 270 ? sourceHeight : sourceWidth, rotation === 90 || rotation === 270 ? sourceWidth : sourceHeight);
    const context = rotated.getContext('2d')!;
    context.translate(rotated.width / 2, rotated.height / 2); context.rotate(rotation * Math.PI / 180);
    context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2);
    let cropWidth = rotated.width, cropHeight = rotated.height;
    if (request.cropRatio) {
      const [a,b] = request.cropRatio.split(':').map(Number);
      if (!(a > 0 && b > 0)) throw new Error('Choose a valid crop ratio.');
      if (cropWidth / cropHeight > a / b) cropWidth = cropHeight * a / b; else cropHeight = cropWidth * b / a;
    }
    let width = cropWidth, height = cropHeight;
    if (request.kind === 'image') {
      const scale = request.imageScalePercent ?? 100;
      if (!(scale > 0 && scale <= 100)) throw new Error('Choose an image resolution above 0%.');
      width *= scale / 100; height *= scale / 100;
    } else if (request.imageWidth && request.imageHeight) {
      if (request.keepAspect !== false) { const scale = Math.min(request.imageWidth / width, request.imageHeight / height); width *= scale; height *= scale; }
      else { width = request.imageWidth; height = request.imageHeight; }
    }
    const canvas = canvasFor(width, height); const target = canvas.getContext('2d')!;
    if (request.format === 'jpg') { target.fillStyle = '#fff'; target.fillRect(0,0,canvas.width,canvas.height); }
    target.drawImage(rotated, (rotated.width - cropWidth) / 2, (rotated.height - cropHeight) / 2, cropWidth,cropHeight,0,0,canvas.width,canvas.height);
    checkCancelled(signal);
    return { canvas, sourceWidth, sourceHeight };
  } finally { image.close(); }
}
export async function encodeImage(path: string, request: Partial<JobRequest>, signal?: AbortSignal) {
  const { canvas, sourceWidth, sourceHeight } = await imageCanvas(path, request, signal);
  const format = request.format || 'png';
  let blob: Blob;
  if (['png','jpg','webp'].includes(format)) blob = await canvasBlob(canvas, mediaMime(format), (request.imageQuality ?? 90) / 100);
  else {
    const png = await canvasBlob(canvas);
    // Encode formats browsers cannot write through the bundled WASM engine.
    blob = await withMedia([], signal, undefined, async (ffmpeg, _inputs, execute) => {
      await ffmpeg.writeFile('canvas.png', new Uint8Array(await png.arrayBuffer()));
      await execute(['-i','canvas.png','-frames:v','1',`encoded.${format}`]);
      return new Blob([await readBytes(ffmpeg, `encoded.${format}`)], { type: mediaMime(format) });
    });
  }
  checkCancelled(signal);
  return { blob, width:canvas.width, height:canvas.height, sourceWidth, sourceHeight };
}
export async function compressImage(path: string, limit: number, signal?: AbortSignal) {
  const { canvas: original } = await imageCanvas(path, { format:'jpg' }, signal);
  let width = original.width, height = original.height;
  for (let attempt = 0; attempt < 25; attempt++) {
    checkCancelled(signal);
    const canvas = canvasFor(width,height); canvas.getContext('2d')!.drawImage(original,0,0,canvas.width,canvas.height);
    let low = .05, high = .96; let best: Blob | undefined;
    for (let step = 0; step < 7; step++) {
      checkCancelled(signal); const quality = (low + high) / 2; const candidate = await canvasBlob(canvas,'image/jpeg',quality);
      if (candidate.size <= limit) { best = candidate; low = quality; } else high = quality;
    }
    if (best) return best;
    if (width <= 1 && height <= 1) break;
    width = Math.max(1,Math.floor(width * .75)); height = Math.max(1,Math.floor(height * .75));
  }
  throw new Error('This image cannot fit under the chosen size limit.');
}
