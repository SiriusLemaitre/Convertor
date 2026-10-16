import { describe, expect, it } from 'vitest';
import { acceptsFile, fileName, tools } from './tools';

describe('tool input routing', () => {
  it('handles Windows and Unix filenames and case-insensitive extensions', () => {
    expect(fileName('C:\\Videos\\my clip.MP4')).toBe('my clip.MP4');
    expect(fileName('/home/video.mp4')).toBe('video.mp4');
    expect(acceptsFile('C:\\Videos\\my clip.MP4', tools[0].extensions)).toBe(true);
  });
  it('rejects unrelated files and files without an extension', () => {
    expect(acceptsFile('invoice.pdf', tools[0].extensions)).toBe(false);
    expect(acceptsFile('pdf', tools[1].extensions)).toBe(false);
    expect(acceptsFile('document.pdf.exe', tools[1].extensions)).toBe(false);
  });
});
