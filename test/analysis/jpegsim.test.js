import { describe, expect, it } from 'vitest';
import { jpegRoundTrip } from '../../src/analysis/jpegsim.js';
import { createRaster, downscaleToFit, resizeBox, toLuma } from '../../src/core/raster.js';
import { texture } from '../../tools/fixtures/synth.mjs';
import { decodeJpegJs, encodeJpegJs } from '../helpers/jpegjs.js';

/** @typedef {import('../../src/core/raster.js').Raster} Raster */

/**
 * @param {Raster} a
 * @param {Raster} b
 */
function meanDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) sum += Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0));
  }
  return sum / ((a.data.length / 4) * 3);
}

const image = texture(70, 52, 9);

describe('raster helpers', () => {
  it('computes BT.601 luma', () => {
    const r = createRaster(3, 1);
    r.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const luma = toLuma(r);
    expect(luma[0]).toBeCloseTo(76.245, 3);
    expect(luma[1]).toBeCloseTo(149.685, 3);
    expect(luma[2]).toBeCloseTo(29.07, 3);
  });

  it('averages areas when shrinking', () => {
    const r = createRaster(4, 2);
    for (let i = 0; i < 8; i++) r.data.set([(i % 2) * 200, 0, 0, 255], i * 4);
    const small = resizeBox(r, 2, 1);
    expect([small.width, small.height]).toEqual([2, 1]);
    expect(small.data[0]).toBe(100);
    expect(small.data[4]).toBe(100);
  });

  it('downscales only when the image is above the pixel budget', () => {
    const big = createRaster(100, 50);
    const fit = downscaleToFit(big, 1250);
    expect([fit.raster.width, fit.raster.height]).toEqual([50, 25]);
    expect(fit.scale).toBeCloseTo(0.5, 9);
    const same = downscaleToFit(big, 10_000);
    expect(same.raster).toBe(big);
    expect(same.scale).toBe(1);
  });
});

describe('jpegRoundTrip', () => {
  it('is nearly lossless at quality 100', () => {
    const out = jpegRoundTrip(image, 100);
    expect([out.width, out.height]).toEqual([70, 52]);
    expect(meanDiff(out, image)).toBeLessThan(1);
    expect(out.data[3]).toBe(255);
  });

  it('loses more at lower quality', () => {
    expect(meanDiff(jpegRoundTrip(image, 50), image)).toBeGreaterThan(
      meanDiff(jpegRoundTrip(image, 90), image),
    );
  });

  it('barely changes an image that was already saved at the same quality', () => {
    const saved = decodeJpegJs(encodeJpegJs(image, 75));
    const again = meanDiff(jpegRoundTrip(saved, 75), saved);
    const lower = meanDiff(jpegRoundTrip(saved, 50), saved);
    expect(again).toBeLessThan(1.5);
    expect(lower).toBeGreaterThan(again * 2);
  });
});
