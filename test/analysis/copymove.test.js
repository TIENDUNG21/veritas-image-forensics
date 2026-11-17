import { describe, expect, it } from 'vitest';
import { detectCopyMove, extractBlockFeatures } from '../../src/analysis/copymove.js';
import { toLuma } from '../../src/core/raster.js';
import { addNoise, copyRect, solid, texture } from '../../tools/fixtures/synth.mjs';
import { decodeJpegJs, encodeJpegJs } from '../helpers/jpegjs.js';

const S = 384;
const source = { x: 40, y: 50, w: 64, h: 64 };
const shift = { dx: 173, dy: 141 };

function forged() {
  const image = texture(S, S, 3);
  copyRect(image, source, image, source.x + shift.dx, source.y + shift.dy);
  return image;
}

/**
 * Share of a rectangle covered by the mask.
 * @param {ReturnType<typeof detectCopyMove>} result
 * @param {{ x: number, y: number, w: number, h: number }} r
 */
function coverage(result, r) {
  let hit = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) hit += result.mask[y * result.width + x] ? 1 : 0;
  }
  return hit / (r.w * r.h);
}

/** @param {ReturnType<typeof detectCopyMove>} result */
function falsePositiveShare(result) {
  const target = { ...source, x: source.x + shift.dx, y: source.y + shift.dy };
  let outside = 0;
  let flagged = 0;
  for (let y = 0; y < result.height; y++) {
    for (let x = 0; x < result.width; x++) {
      const inA =
        x >= source.x - 8 &&
        x < source.x + source.w + 8 &&
        y >= source.y - 8 &&
        y < source.y + source.h + 8;
      const inB =
        x >= target.x - 8 &&
        x < target.x + target.w + 8 &&
        y >= target.y - 8 &&
        y < target.y + target.h + 8;
      if (inA || inB) continue;
      outside++;
      flagged += result.mask[y * result.width + x] ? 1 : 0;
    }
  }
  return flagged / outside;
}

describe('extractBlockFeatures', () => {
  it('gives identical features to identical blocks and skips flat ones', () => {
    const image = texture(64, 64, 8);
    copyRect(image, { x: 0, y: 0, w: 8, h: 8 }, image, 40, 30);
    const flat = solid(64, 64, [90, 90, 90]);
    copyRect(image, { x: 0, y: 0, w: 64, h: 16 }, flat, 0, 0);
    const luma = toLuma(image);
    const f = extractBlockFeatures(luma, 64, 64);
    const a = [...f.positions.subarray(0, f.count)].indexOf(0);
    const b = [...f.positions.subarray(0, f.count)].indexOf(30 * 64 + 40);
    expect(a).toBeGreaterThanOrEqual(0);
    expect([...f.features.subarray(a * 16, a * 16 + 16)]).toEqual([
      ...f.features.subarray(b * 16, b * 16 + 16),
    ]);
    const flatFeatures = extractBlockFeatures(toLuma(flat), 64, 64);
    // Only blocks overlapping the textured top band survive.
    expect(flatFeatures.count).toBeLessThanOrEqual(57 * 16);
    expect(flatFeatures.count).toBeGreaterThan(0);
  });
});

describe('detectCopyMove', () => {
  it('finds a cloned region, its shift and both locations', () => {
    const result = detectCopyMove(forged());
    expect(result.pairs[0]).toMatchObject({ dx: shift.dx, dy: shift.dy });
    expect(coverage(result, source)).toBeGreaterThan(0.9);
    expect(
      coverage(result, { ...source, x: source.x + shift.dx, y: source.y + shift.dy }),
    ).toBeGreaterThan(0.9);
    expect(falsePositiveShare(result)).toBeLessThan(0.01);
  });

  it('still finds the clone after JPEG compression at quality 90', () => {
    const result = detectCopyMove(decodeJpegJs(encodeJpegJs(forged(), 90)));
    expect(result.pairs[0]).toMatchObject({ dx: shift.dx, dy: shift.dy });
    expect(coverage(result, source)).toBeGreaterThan(0.6);
    expect(falsePositiveShare(result)).toBeLessThan(0.01);
  });

  it('reports nothing for an untouched image', () => {
    const result = detectCopyMove(decodeJpegJs(encodeJpegJs(texture(S, S, 3), 90)));
    expect(result.pairs).toEqual([]);
    expect(result.mask.some((v) => v > 0)).toBe(false);
  });

  it('ignores flat areas with mild noise instead of matching them everywhere', () => {
    const image = solid(S, S, [120, 160, 200]);
    addNoise(image, 2, 4);
    expect(detectCopyMove(image).pairs).toEqual([]);
  });

  it('works on a downscaled copy and maps regions back to full size', () => {
    const big = texture(1536, 1024, 12, { cell: 96 });
    const src = { x: 200, y: 160, w: 160, h: 160 };
    copyRect(big, src, big, 900, 600);
    const result = detectCopyMove(big, { maxSide: 768 });
    expect(result.scale).toBeCloseTo(0.5, 6);
    expect([result.width, result.height]).toEqual([768, 512]);
    const pair = result.pairs[0];
    if (!pair) throw new Error('expected a clone');
    expect(pair.dx).toBeCloseTo(700, -1);
    expect(pair.dy).toBeCloseTo(440, -1);
    expect(pair.source.x).toBeGreaterThan(180);
    expect(pair.source.x).toBeLessThan(230);
  });

  it('handles images smaller than one block', () => {
    const result = detectCopyMove(solid(5, 5, [1, 2, 3]));
    expect(result.pairs).toEqual([]);
    expect(result.blocksAnalysed).toBe(0);
  });
});
