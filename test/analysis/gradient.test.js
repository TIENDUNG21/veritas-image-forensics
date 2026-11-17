import { describe, expect, it } from 'vitest';
import { luminanceGradient } from '../../src/analysis/gradient.js';
import { createRaster } from '../../src/core/raster.js';
import { solid } from '../../tools/fixtures/synth.mjs';

/**
 * @param {number} w
 * @param {number} h
 * @param {(x: number, y: number) => number} f grey level
 */
function grey(w, h, f) {
  const r = createRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) r.data.set([f(x, y), f(x, y), f(x, y), 255], (y * w + x) * 4);
  }
  return r;
}

describe('luminanceGradient', () => {
  it('points along +x on a horizontal ramp with Sobel gain 8', () => {
    const g = luminanceGradient(grey(20, 10, (x) => 10 + 3 * x));
    const i = 5 * 20 + 10;
    expect(g.gx[i]).toBeCloseTo(24, 3);
    expect(g.gy[i]).toBeCloseTo(0, 3);
    expect(g.magnitude[i]).toBeCloseTo(24, 3);
    expect(Math.atan2(g.gy[i] ?? 0, g.gx[i] ?? 0)).toBeCloseTo(0, 6);
  });

  it('points along +y on a vertical ramp', () => {
    const g = luminanceGradient(grey(10, 20, (_x, y) => 5 * y));
    const i = 10 * 10 + 5;
    expect(Math.atan2(g.gy[i] ?? 0, g.gx[i] ?? 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(g.max).toBeCloseTo(40, 3);
  });

  it('replicates borders instead of inventing edges, and is zero on flat images', () => {
    const ramp = luminanceGradient(grey(20, 10, (x) => 2 * x));
    expect(ramp.gy[0]).toBeCloseTo(0, 6);
    expect(ramp.gx[5 * 20]).toBeGreaterThan(0);
    const flat = luminanceGradient(solid(8, 8, [90, 90, 90]));
    expect(flat.max).toBe(0);
  });
});
