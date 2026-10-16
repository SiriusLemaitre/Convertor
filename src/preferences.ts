import { useEffect, useState } from 'react';
import { defaultImageSettings } from './ImageOptions';
import { defaultVideoSettings } from './VideoOptions';

export const defaultPreferences = {
  bitrate: 192, width: 640, fps: 15, start: 0, end: 5, trim: false,
  audioFormat: 'mp3', outputName: 'My document', image: defaultImageSettings, video: defaultVideoSettings,
  operation: 'extract', pages: '', targetMb: 10, format: 'png', imageWidth: 0, imageHeight: 0,
  keepAspect: true, rotation: 0, cropRatio: '', interval: 5, dpi: 150,
};
export type Preferences = typeof defaultPreferences;
export function readStored<T>(key: string, fallback: T): T {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch { return fallback; }
}
export function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, fallback));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* A full disk must not block conversion. */ } }, [key, value]);
  return [value, setValue] as const;
}
