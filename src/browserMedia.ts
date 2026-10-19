import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { fileBlob } from './browserFiles';

let engine: FFmpeg | undefined;
let loading: Promise<FFmpeg> | undefined;
let warmed = false;
let serial = Promise.resolve();
export function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const next = serial.then(operation);
  serial = next.then(() => {}, () => {});
  return next;
}
export function checkCancelled(signal?: AbortSignal) { if (signal?.aborted) throw new Error('Cancelled'); }
export async function withMedia<T>(paths: string[], signal: AbortSignal | undefined, progress: ((n: number) => void) | undefined, operation: (ffmpeg: FFmpeg, inputs: string[], execute: (args: string[]) => Promise<void>) => Promise<T>): Promise<T> {
  return serialized(async () => {
    checkCancelled(signal);
    if (!loading) {
      engine = new FFmpeg();
      const fresh = engine;
      window.dispatchEvent(new CustomEvent('convertor-engine', { detail: warmed ? 'Preparing audio/video conversion…' : 'Loading audio/video engine (about 31 MB)…' }));
      loading = fresh.load({ coreURL, wasmURL }).then(() => {
        warmed = true; window.dispatchEvent(new CustomEvent('convertor-engine', { detail: '' })); return fresh;
      }).catch(error => { fresh.terminate(); if (engine === fresh) { loading = undefined; engine = undefined; } window.dispatchEvent(new CustomEvent('convertor-engine', { detail: '' })); throw error; });
    }
    const ffmpeg = engine!;
    const abort = () => { ffmpeg.terminate(); if (engine === ffmpeg) { loading = undefined; engine = undefined; } window.dispatchEvent(new CustomEvent('convertor-engine', { detail: '' })); };
    signal?.addEventListener('abort', abort, { once: true });
    const report = ({ progress: value }: { progress: number }) => progress?.(Math.max(1, Math.min(98, value * 100)));
    const logs: string[] = [];
    const log = ({ message }: { message: string }) => { logs.push(message); if (logs.length > 12) logs.shift(); };
    try {
      await loading; checkCancelled(signal);
      ffmpeg.on('progress', report); ffmpeg.on('log', log);
      const inputs = paths.map((path, i) => `input-${i}.${path.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'bin'}`);
      for (const [i, path] of paths.entries()) { checkCancelled(signal); await ffmpeg.writeFile(inputs[i], new Uint8Array(await fileBlob(path).arrayBuffer())); }
      const execute = async (args: string[]) => {
        checkCancelled(signal);
        if (await ffmpeg.exec(['-hide_banner', ...args], 1200000) !== 0) throw new Error(`This conversion could not finish. The format may be unsupported or browser memory may be exhausted. ${logs.slice(-3).join(' ').slice(0, 450)}`);
        checkCancelled(signal);
      };
      return await operation(ffmpeg, inputs, execute);
    } finally {
      signal?.removeEventListener('abort', abort);
      ffmpeg.off('progress', report); ffmpeg.off('log', log);
      // Each operation gets a fresh native heap. Reusing FFmpeg's C runtime
      // across unlike codecs can retain substantial memory and stale state.
      ffmpeg.terminate();
      if (engine === ffmpeg) { engine = undefined; loading = undefined; }
    }
  });
}
export async function readBytes(ffmpeg: FFmpeg, path: string): Promise<Uint8Array<ArrayBuffer>> {
  const value = await ffmpeg.readFile(path);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  return new Uint8Array(value);
}
export const audioCodecs: Record<string, string[]> = {
  mp3: ['-c:a','libmp3lame'], m4a: ['-c:a','aac'], aac: ['-c:a','aac'], ogg: ['-c:a','libvorbis'], opus: ['-c:a','opus','-strict','-2','-ac','2','-ar','48000'],
  wav: ['-c:a','pcm_s16le'], flac: ['-c:a','flac'], aiff: ['-c:a','pcm_s16be'], wma: ['-c:a','wmav2','-ac','2'], ac3: ['-c:a','ac3','-ac','2'],
};
export function isImage(path: string) { return /\.(png|jpe?g|webp|bmp|tiff?|gif)$/i.test(path); }
export function isAudio(path: string) { return /\.(mp3|m4a|aac|ogg|opus|wav|flac|aiff?|wma|ac3)$/i.test(path); }
export function mediaMime(format: string): string {
  return ({ jpg:'image/jpeg', png:'image/png', webp:'image/webp', bmp:'image/bmp', tiff:'image/tiff', gif:'image/gif', mp3:'audio/mpeg', wav:'audio/wav', m4a:'audio/mp4', aac:'audio/aac', ogg:'audio/ogg', opus:'audio/ogg', flac:'audio/flac', mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', mkv:'video/x-matroska', pdf:'application/pdf', zip:'application/zip' } as Record<string,string>)[format] || 'application/octet-stream';
}
