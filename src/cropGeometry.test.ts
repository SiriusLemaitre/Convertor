import { describe, expect, it } from 'vitest';
import { changeCrop, fullCrop, ratioCrop, validCrop } from './cropGeometry';

describe('visual crop geometry', () => {
  it('keeps moves inside the source without changing dimensions', () => {
    expect(changeCrop({x:.2,y:.2,width:.5,height:.4},'move',10,-10)).toEqual({x:.5,y:0,width:.5,height:.4});
  });
  it('resizes all corners and edges without flipping or leaving the frame', () => {
    const original = {x:.2,y:.2,width:.6,height:.6};
    for (const handle of ['nw','n','ne','e','se','s','sw','w']) {
      for (const offset of [-5,5]) {
        const result = changeCrop(original,handle,offset,offset,.02,.02);
        expect(validCrop(result)).toBe(true);
        expect(result.width).toBeGreaterThanOrEqual(.01999999);
        expect(result.height).toBeGreaterThanOrEqual(.01999999);
      }
    }
    expect(changeCrop(fullCrop,'nw',.25,.25)).toEqual({x:.25,y:.25,width:.75,height:.75});
  });
  it('centers ratio presets correctly on portrait and landscape sources', () => {
    expect(ratioCrop('1:1',320,240)).toEqual({x:.125,y:0,width:.75,height:1});
    expect(ratioCrop('1:1',240,320)).toEqual({x:0,y:.125,width:1,height:.75});
    expect(ratioCrop('',320,240)).toEqual(fullCrop);
  });
  it('rejects invalid saved selections', () => {
    for(const rect of [{...fullCrop,width:NaN},{...fullCrop,x:-.1},{...fullCrop,width:0},{...fullCrop,y:.1}]) expect(validCrop(rect)).toBe(false);
    expect(validCrop(null)).toBe(false);
  });
});
