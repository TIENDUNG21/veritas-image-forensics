import { describe, expect, it } from 'vitest';
import { noiseMap } from '../../src/analysis/noise.js';
import { addNoise, solid, texture } from '../../tools/fixtures/synth.mjs';

const W = 256;
const square = { x: 96, y: 96, w: 64, h: 64 };

/**
 * Mean block sigma inside and outside `square`.
 * @param {ReturnType<typeof noiseMap>} noise
 */
function insideOutside(noise) {
  let a = 0;
  let na = 0;
  let b = 0;
  let nb = 0;
  for (let by = 0; by < noise.blocksH; by++) {
    for (let bx = 0; bx < noise.blocksW; bx++) {
      const s = noise.sigma[by * noise.blocksW + bx] ?? 0;
      const x = bx * noise.block;
      const y = by * noise.block;
      const inside =
        x >= square.x &&
        x + noise.block <= square.x + square.w &&
        y >= square.y &&
        y + noise.block <= square.y + square.h;
      if (inside) {
        a += s;
        na++;
      } else {
        b += s;
        nb++;
      }
    }
  }
  return [a / na, b / nb];
}

/**
 * Box-blurs a rectangle in place (3x3, two passes) to remove its noise.
 * @param {import('../../src/core/raster.js').Raster} r
 */
function blurSquare(r) {
  for (let pass = 0; pass < 2; pass++) {
    const copy = r.data.slice();
    for (let y = square.y; y < square.y + square.h; y++) {
      for (let x = square.x; x < square.x + square.w; x++) {
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) s += copy[((y + dy) * W + x + dx) * 4 + c] ?? 0;
          }
          r.data[(y * W + x) * 4 + c] = s / 9;
        }
      }
    }
  }
}

describe('noiseMap', () => {
  it('estimates the level of pure Gaussian noise', () => {
    const r = solid(W, W, [128, 128, 128]);
    addNoise(r, 5, 1);
    const noise = noiseMap(r);
    // Each channel gets independent noise; luma noise = 5 * sqrt(0.299^2 + 0.587^2 + 0.114^2).
    const expected = 5 * Math.hypot(0.299, 0.587, 0.114);
    expect(noise.globalSigma).toBeGreaterThan(expected * 0.85);
    expect(noise.globalSigma).toBeLessThan(expected * 1.15);
  });

  it('localises a region with stronger noise', () => {
    const r = texture(W, W, 3, { grain: 0 });
    addNoise(r, 4, 2);
    addNoise(r, 12, 3, square);
    const noise = noiseMap(r);
    const [inside, outside] = insideOutside(noise);
    expect(inside / outside).toBeGreaterThan(2);
    const region = noise.regions[0];
    expect(region?.score).toBeGreaterThan(1);
    expect(region?.x).toBeGreaterThanOrEqual(square.x - 16);
    expect((region?.x ?? 0) + (region?.w ?? 0)).toBeLessThanOrEqual(square.x + square.w + 16);
  });

  it('localises a smoothed region with weaker noise', () => {
    const r = texture(W, W, 4, { grain: 0 });
    addNoise(r, 6, 5);
    blurSquare(r);
    const noise = noiseMap(r);
    const [inside, outside] = insideOutside(noise);
    expect(inside / outside).toBeLessThan(0.5);
    expect(noise.regions.some((g) => g.score < 1)).toBe(true);
  });

  it('reports nothing for a consistent image and zero for a flat one', () => {
    const r = texture(W, W, 6, { grain: 0 });
    addNoise(r, 5, 7);
    expect(noiseMap(r).regions).toEqual([]);
    const flat = noiseMap(solid(64, 48, [10, 200, 30]));
    expect(flat.globalSigma).toBe(0);
    expect(flat.residual.length).toBe(64 * 48);
  });
});
