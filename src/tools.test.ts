import { describe, expect, it } from 'vitest';
import { acceptsFile, fileName, tools } from './tools';

describe('tool input routing', () => {
  it('lets FFmpeg inspect video-to-audio inputs without an extension allowlist', () => {
    const tool = tools.find(t => t.id === 'mp3')!;
    expect(tool.name).toBe('Video to Audio');
    expect(acceptsFile('recording.unusual-extension', tool.extensions)).toBe(true);
    expect(acceptsFile('recording', tool.extensions)).toBe(true);
  });
  it('handles Windows and Unix filenames and case-insensitive extensions', () => {
    expect(fileName('C:\\Videos\\my clip.MP4')).toBe('my clip.MP4');
    expect(fileName('/home/video.mp4')).toBe('video.mp4');
    expect(acceptsFile('C:\\Videos\\my clip.MP4', tools.find(t => t.id === 'video')!.extensions)).toBe(true);
  });
  it('rejects unrelated files and files without an extension', () => {
    expect(acceptsFile('invoice.pdf', tools.find(t => t.id === 'video')!.extensions)).toBe(false);
    expect(acceptsFile('pdf', tools.find(t => t.id === 'pdf')!.extensions)).toBe(false);
    expect(acceptsFile('document.pdf.exe', tools.find(t => t.id === 'pdf')!.extensions)).toBe(false);
  });
});
