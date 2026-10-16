import { AudioLines, Files, Film, Image, Music2, Scissors, FileImage, FileOutput, Scaling, Minimize2, ShieldCheck, Camera } from 'lucide-react';
const videos = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'];
const images = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'];
const audio = ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'opus', 'aiff', 'aif', 'wma'];
export const categories = ['Documents', 'Images', 'Audio', 'Video', 'Utilities'] as const;
export type Category = typeof categories[number];
export const tools = [
  { id: 'mp3', name: 'Video to MP3', short: 'MP3', category: 'Audio', icon: AudioLines, extensions: videos, color: 'violet', output: 'MP3 audio', batch: true, description: 'Extract the soundtrack from videos.' },
  { id: 'pdf', name: 'Merge PDFs', short: 'PDF', category: 'Documents', icon: Files, extensions: ['pdf'], color: 'coral', output: 'PDF document', batch: false, description: 'Combine documents in your chosen order.' },
  { id: 'gif', name: 'Video to GIF', short: 'GIF', category: 'Video', icon: Film, extensions: videos, color: 'green', output: 'Animated GIF', batch: true, description: 'Create looping GIFs from videos or clips.' },
  { id: 'image', name: 'Images', short: 'image', category: 'Images', icon: Image, extensions: images, color: 'blue', output: 'Image', batch: true, description: 'Convert image formats and adjust quality.' },
  { id: 'audio', name: 'Audio', short: 'audio', category: 'Audio', icon: Music2, extensions: audio, color: 'violet', output: 'Audio', batch: true, description: 'Convert recordings between audio formats.' },
  { id: 'video', name: 'Video', short: 'video', category: 'Video', icon: Film, extensions: videos, color: 'green', output: 'Video', batch: true, description: 'Convert videos, resolution, and frame rate.' },
  { id: 'pdf-pages', name: 'Split & extract PDFs', short: 'PDF', category: 'Documents', icon: Scissors, extensions: ['pdf'], color: 'coral', output: 'PDF pages', batch: true, description: 'Extract, remove, or split document pages.' },
  { id: 'images-pdf', name: 'Images to PDF', short: 'PDF', category: 'Documents', icon: FileImage, extensions: images, color: 'coral', output: 'PDF document', batch: false, description: 'Turn photos and scans into one document.' },
  { id: 'pdf-images', name: 'PDF to images', short: 'images', category: 'Documents', icon: FileOutput, extensions: ['pdf'], color: 'coral', output: 'Page images', batch: true, description: 'Export selected pages as PNG or JPG.' },
  { id: 'image-edit', name: 'Resize, crop & rotate', short: 'images', category: 'Images', icon: Scaling, extensions: images, color: 'blue', output: 'Edited image', batch: true, description: 'Set dimensions, crop ratios, and rotation.' },
  { id: 'trim', name: 'Trim audio & video', short: 'clip', category: 'Video', icon: Scissors, extensions: [...videos, ...audio], color: 'green', output: 'Media clip', batch: true, description: 'Save a clip between a start and end time.' },
  { id: 'frames', name: 'Extract video frames', short: 'frames', category: 'Video', icon: Camera, extensions: videos, color: 'green', output: 'Video frames', batch: true, description: 'Save a still or capture frames at intervals.' },
  { id: 'compress', name: 'Compress to size', short: 'files', category: 'Utilities', icon: Minimize2, extensions: [...videos, ...audio, ...images], color: 'violet', output: 'Compressed file', batch: true, description: 'Fit images, audio, and video under a size limit.' },
  { id: 'metadata', name: 'Remove metadata', short: 'files', category: 'Utilities', icon: ShieldCheck, extensions: [...images, ...videos, ...audio, 'pdf'], color: 'blue', output: 'Clean copy', batch: true, description: 'Remove embedded tags from copies of files.' },
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
