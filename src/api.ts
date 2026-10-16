import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ToolId } from './tools';

export const desktop = isTauri();
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
