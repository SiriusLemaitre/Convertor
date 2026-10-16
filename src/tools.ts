import { AudioLines, Files, Film, Image, Music2 } from 'lucide-react';

// Register new tools here; native implementations live in engine.rs.
export const tools = [
  { id: 'mp3', name: 'Video to MP3', short: 'MP3', category: 'Audio', icon: AudioLines,
    extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'], color: 'violet', output: 'MP3 audio', batch: true },
  { id: 'pdf', name: 'Merge PDFs', short: 'PDF', category: 'Documents', icon: Files,
    extensions: ['pdf'], color: 'coral', output: 'PDF document', batch: false },
  { id: 'gif', name: 'Video to GIF', short: 'GIF', category: 'Video', icon: Film,
    extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'], color: 'green', output: 'Animated GIF', batch: true },
  { id: 'image', name: 'Images', short: 'image', category: 'Images', icon: Image,
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'], color: 'blue', output: 'Image', batch: true },
  { id: 'audio', name: 'Audio', short: 'audio', category: 'Audio', icon: Music2,
    extensions: ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'opus', 'aiff', 'aif', 'wma'], color: 'violet', output: 'Audio', batch: true },
  { id: 'video', name: 'Video', short: 'video', category: 'Video', icon: Film,
    extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v'], color: 'green', output: 'Video', batch: true },
] as const;
export type ToolId = typeof tools[number]['id'];
export type Tool = typeof tools[number];
export function fileName(path: string) { return path.split(/[\\/]/).pop() || path; }
export function acceptsFile(path: string, extensions: readonly string[]) {
  const name = fileName(path);
  return name.includes('.') && extensions.includes(name.split('.').pop()?.toLowerCase() || '');
}
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes >= 1024 ** 3 ? 3 : bytes >= 1024 ** 2 ? 2 : 1;
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
