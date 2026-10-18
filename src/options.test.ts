import { describe, expect, it } from 'vitest';
import { defaultPreferences as p } from './preferences';
import { requestFor, validOptions } from './ToolOptions';
import { categories, tools } from './tools';

describe('tool requests and validation', () => {
  it('sends end minus start for clips and full duration for untrimmed GIFs', () => {
    expect(requestFor('trim', [], {...p,start: 2,end: 7}).duration).toBe(5);
    expect(requestFor('gif', [], {...p,start: 2,end: 7,trim: false})).toMatchObject({start:0,duration:null});
    expect(validOptions('trim', {...p,start:8,end:7})).toBe(false);
  });
  it('keeps format settings separate for each conversion tool', () => {
    expect(requestFor('audio', [], {...p,audioFormat:'flac'}).format).toBe('flac');
    expect(requestFor('mp3', [], {...p,audioFormat:'opus',format:'png'}).format).toBe('opus');
    expect(requestFor('video', [], {...p,video:{...p.video,format:'webm'}}).format).toBe('webm');
    expect(requestFor('image', [], {...p,image:{...p.image,format:'jpg',scale:50}})).toMatchObject({format:'jpg',imageScalePercent:50});
  });
  it('requires complete dimensions and valid page selections', () => {
    expect(validOptions('image-edit',{...p,imageWidth:400,imageHeight:0})).toBe(false);
    expect(validOptions('pdf-pages',{...p,pages:'1, 3-5'})).toBe(true);
    expect(validOptions('pdf-pages',{...p,pages:'--password=x'})).toBe(false);
    expect(validOptions('pdf-pages',{...p,operation:'split'})).toBe(true);
  });
  it('registers each tool once under a known category and excludes joining', () => {
    expect(new Set(tools.map(t => t.id)).size).toBe(tools.length);
    expect(tools.every(t => categories.includes(t.category))).toBe(true);
    expect(tools.some(t => /join/i.test(t.name))).toBe(false);
  });
});
