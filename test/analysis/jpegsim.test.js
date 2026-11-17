import { describe, expect, it } from 'vitest';
import { requantize } from '../../src/analysis/jpegsim.js';
import { createRaster, downscaleToFit, resizeBox, toLuma } from '../../src/core/raster.js';
import { LUMA_BASE, scaleTable } from '../../src/jpeg/tables.js';
import { texture } from '../../tools/fixtures/synth.mjs';
import { decodeJpegJs, encodeJpegJs } from '../helpers/jpegjs.js';

/**
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
function meanDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length;
}

const image = texture(70, 52, 9);
const luma = toLuma(image);
/** @param {Float32Array} plane @param {number} q */
const resave = (plane, q) => requantize(plane, 70, 52, scaleTable(LUMA_BASE, q));

describe('raster helpers', () => {
  it('computes BT.601 luma', () => {
    const r = createRaster(3, 1);
    r.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const y = toLuma(r);
    expect(y[0]).toBeCloseTo(76.245, 3);
    expect(y[1]).toBeCloseTo(149.685, 3);
    expect(y[2]).toBeCloseTo(29.07, 3);
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

describe('requantize', () => {
  it('is nearly lossless with all steps equal to 1', () => {
    expect(meanDiff(resave(luma, 100), luma)).toBeLessThan(0.5);
  });

  it('loses more at lower quality', () => {
    expect(meanDiff(resave(luma, 50), luma)).toBeGreaterThan(meanDiff(resave(luma, 90), luma));
  });

  it('barely changes a plane that was already saved at the same quality', () => {
    const saved = toLuma(decodeJpegJs(encodeJpegJs(image, 75)));
    const again = meanDiff(resave(saved, 75), saved);
    const fresh = meanDiff(resave(luma, 75), luma);
    expect(again).toBeLessThan(0.6);
    expect(fresh).toBeGreaterThan(again * 3);
  });
});
