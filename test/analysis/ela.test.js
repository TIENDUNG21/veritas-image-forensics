import { describe, expect, it } from 'vitest';
import { errorLevel } from '../../src/analysis/ela.js';
import { blockComponents } from '../../src/core/regions.js';
import { copyRect, solid, texture } from '../../tools/fixtures/synth.mjs';
import { decodeJpegJs, encodeJpegJs } from '../helpers/jpegjs.js';

const W = 256;
const patch = { x: 96, y: 96, w: 64, h: 64 };

/**
 * A JPEG-saved background with a never-compressed patch pasted in afterwards
 * (as when an edited JPEG is exported to PNG).
 * @param {number} quality
 */
function pastedAfterSave(quality) {
  const background = decodeJpegJs(encodeJpegJs(texture(W, W, 5), quality));
  copyRect(texture(W, W, 77), patch, background, patch.x, patch.y);
  return background;
}

/**
 * @param {Float32Array} map
 * @returns {[number, number]} mean inside the patch, mean outside
 */
function insideOutside(map) {
  let a = 0;
  let na = 0;
  let b = 0;
  let nb = 0;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const inside = x >= patch.x && x < patch.x + patch.w && y >= patch.y && y < patch.y + patch.h;
      if (inside) {
        a += map[y * W + x] ?? 0;
        na++;
      } else {
        b += map[y * W + x] ?? 0;
        nb++;
      }
    }
  }
  return [a / na, b / nb];
}

describe('errorLevel', () => {
  it.each([75, 90])('highlights content pasted after the last save at quality %i', (q) => {
    const ela = errorLevel(pastedAfterSave(q), { quality: q });
    const [inside, outside] = insideOutside(ela.map);
    expect(inside / outside).toBeGreaterThan(3);
    expect(ela.hotspots).toHaveLength(1);
    const box = ela.hotspots[0];
    expect(box?.x).toBeGreaterThanOrEqual(patch.x - 8);
    expect(box?.y).toBeGreaterThanOrEqual(patch.y - 8);
    expect((box?.x ?? 0) + (box?.w ?? 0)).toBeLessThanOrEqual(patch.x + patch.w + 8);
    expect(box?.w).toBeGreaterThanOrEqual(patch.w - 16);
  });

  it('finds no hotspot in an untouched JPEG', () => {
    const untouched = decodeJpegJs(encodeJpegJs(texture(W, W, 5), 75));
    const ela = errorLevel(untouched, { quality: 75 });
    expect(ela.hotspots).toEqual([]);
    expect(ela.uniform).toBe(false);
  });

  it('calls a never-compressed image uniform rather than inventing a hotspot', () => {
    const ela = errorLevel(texture(W, W, 5), { quality: 75 });
    expect(ela.hotspots).toEqual([]);
    expect(ela.uniform).toBe(true);
  });

  it('is essentially zero on a flat image and sizes its maps', () => {
    const ela = errorLevel(solid(30, 20, [120, 130, 140]), { quality: 90 });
    expect(ela.width).toBe(30);
    expect(ela.map.length).toBe(600);
    expect([ela.blocksW, ela.blocksH]).toEqual([4, 3]);
    expect(ela.max).toBeLessThan(1);
  });
});

describe('blockComponents', () => {
  it('groups 4-connected blocks and reports their boxes', () => {
    // 4 x 3 grid: two separate groups.
    const hot = Uint8Array.from([1, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1]);
    const parts = blockComponents(hot, 4, 3);
    expect(parts).toEqual([
      { bx: 0, by: 0, bw: 2, bh: 2, count: 3 },
      { bx: 3, by: 1, bw: 1, bh: 2, count: 2 },
    ]);
  });
});
