import { describe, expect, it } from 'vitest';
import { markdownPages } from './pdfMarkdown';
import { cropVideoFilter } from './cropVideo';
import { requestFor, validOptions } from './ToolOptions';
import { defaultPreferences as p } from './preferences';

describe('Markdown text export', () => {
  it('keeps page boundaries, paragraphs, Unicode and literal Markdown characters', () => {
    const md = markdownPages(['Café *literal*\nwrapped line\n\nSecond paragraph', '', 'Last page']);
    expect(md).toContain('Café \\*literal\\* wrapped line\n\nSecond paragraph');
    expect(md).toContain('## Page 2\n\n*No selectable text on this page.*');
    expect(md).toContain('## Page 3\n\nLast page');
  });
  it('explains that a scanned or blank document needs OCR', () => {
    expect(() => markdownPages(['', ' \n'])).toThrow(/OCR/);
  });
});

describe('video crop validation', () => {
  it('rejects fractions, missing dimensions, negative offsets and filter injection', () => {
    for (const values of [{imageWidth:0}, {imageWidth:2.5}, {cropX:-1}, {cropRatio:'1:1,evil'}]) {
      expect(validOptions('video-crop',{...p,cropRatio:'custom',imageWidth:100,imageHeight:80,...values})).toBe(false);
    }
    expect(() => cropVideoFilter({...requestFor('video-crop',[],p),cropRatio:'1:1,evil'})).toThrow();
  });
  it('uses the center for a ratio and checks the entire custom rectangle fits', () => {
    expect(cropVideoFilter(requestFor('video-crop',[],p))).toContain('(iw-ow)/2');
    const r = requestFor('video-crop',[],{...p,cropRatio:'custom',cropX:10,cropY:20,imageWidth:100,imageHeight:80});
    expect(cropVideoFilter(r)).toContain('gte(iw,110)*gte(ih,100)');
  });
});
