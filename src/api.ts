import { invoke as nativeInvoke, isTauri, convertFileSrc } from '@tauri-apps/api/core';
import type { ToolId } from './tools';

export const nativeDesktop = isTauri();
const pairingPattern = /^(\d{1,5})\.([a-f0-9]{64})$/;
function pairingFrom(value: string): string {
  const match = pairingPattern.exec(value);
  return match && Number(match[1]) > 0 && Number(match[1]) <= 65535 ? value : '';
}
const fragment = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.hash.slice(1));
const incoming = pairingFrom(fragment.get('bridge') || '');
if (incoming) {
  sessionStorage.setItem('convertor.bridge', incoming);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
const pairing = nativeDesktop || typeof sessionStorage === 'undefined' ? '' : pairingFrom(sessionStorage.getItem('convertor.bridge') || '');
const [port, token] = pairing.split('.');
const helper = `http://127.0.0.1:${port}`;
// Existing tool panels use this flag to enable native processing in either shell.
export const desktop = nativeDesktop || Boolean(pairing);
export function connectHelper(link: string) {
  let value = link.trim();
  try { value = new URLSearchParams(new URL(value).hash.slice(1)).get('bridge') || ''; } catch { /* Accept a bare pairing code too. */ }
  value = pairingFrom(value);
  if (!value) throw new Error('Paste the browser link opened by Convertor on this computer.');
  sessionStorage.setItem('convertor.bridge', value);
  window.location.reload();
}
export function disconnectHelper() { sessionStorage.removeItem('convertor.bridge'); window.location.reload(); }
export function fileSource(path: string) {
  return nativeDesktop ? convertFileSrc(path) : pairing ? `${helper}/media?${new URLSearchParams({ path, token })}` : '';
}
async function invoke<T = void>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (nativeDesktop) return nativeInvoke<T>(command, args);
  if (!pairing) throw new Error('Start Convertor in browser mode on this computer to process files.');
  let response: Response;
  try {
    response = await fetch(`${helper}/api/${command}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(args), referrerPolicy: 'no-referrer',
    });
  } catch { throw new Error('Cannot reach Convertor. Start browser mode on this computer and allow local network access if your browser asks.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The local helper could not complete this request.');
  return data as T;
}
export type InputFile = { path: string; name: string; size: number };
export type Job = {
  id: string; kind: ToolId; label: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; output: string | null; outputIsDirectory: boolean; error: string | null; created: number;
};
export type Settings = { outputDir: string; concurrency: number; ffmpegPath: string; qpdfPath: string; pdfRendererPath: string };
export type EngineInfo = { name: string; path: string | null; version: string | null };
export type AppInfo = { settings: Settings; engines: EngineInfo[]; cpuCount: number };
export type JobRequest = {
  kind: ToolId; inputs: string[]; outputDir: string; outputName: string;
  bitrate: number; width: number; fps: number; start: number; duration: number | null;
  format?: string; imageWidth?: number; imageHeight?: number; keepAspect?: boolean; imageQuality?: number; imageScalePercent?: number;
  videoQuality?: number; videoHeight?: number; videoFps?: number;
  pages?: string; operation?: string; targetMb?: number; rotation?: number; cropRatio?: string; interval?: number; dpi?: number;
};
export type VideoEstimate = { path: string; size: number; width: number; height: number; fps: number; bitrate: number };
export type ImagePreview = { path: string; size: number; width: number; height: number; sourceWidth: number; sourceHeight: number };
export const api = {
  browser: (hosted = false) => invoke<string>('open_browser', { hosted }),
  quit: () => invoke<void>('quit'),
  info: () => invoke<AppInfo>('app_info'),
  files: (extensions: readonly string[]) => invoke<InputFile[]>('pick_files', { extensions }),
  inspect: (paths: string[]) => invoke<InputFile[]>('inspect_files', { paths }),
  folder: () => invoke<string | null>('pick_folder'),
  executable: () => invoke<string | null>('pick_executable'),
  enqueue: (request: JobRequest) => invoke<Job[]>('enqueue', { request }),
  jobs: () => invoke<Job[]>('list_jobs'),
  cancel: (id: string) => invoke<void>('cancel_job', { id }),
  clear: () => invoke<void>('clear_finished'),
  settings: (settings: Settings) => invoke<AppInfo>('save_settings', { settings }),
  reveal: (path: string) => invoke<void>('reveal_file', { path }),
  open: (path: string) => invoke<void>('open_file', { path }),
  previewImages: (request: JobRequest, revision: number) => invoke<ImagePreview[]>('preview_images', { request, revision }),
  cancelPreview: (revision: number) => invoke<void>('cancel_image_preview', { revision }),
  estimateVideos: (request: JobRequest) => invoke<VideoEstimate[]>('estimate_videos', { request }),
  visualPreview: (request: JobRequest, revision: number) => invoke<{ bytes: number[]; mime: string }>('visual_preview', { request, revision }),
  cancelVisualPreview: (revision: number) => invoke<void>('cancel_visual_preview', { revision }),
};
