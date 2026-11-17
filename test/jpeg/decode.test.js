import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decodeJpeg } from '../../src/jpeg/decode.js';
import { fdct8x8, idct8x8 } from '../../src/jpeg/dct.js';
import { ParseError } from '../../src/core/errors.js';
import { texture } from '../../tools/fixtures/synth.mjs';
import { encodeJpeg } from '../../tools/fixtures/jpeg-writer.mjs';
import { decodeJpegJs, encodeJpegJs } from '../helpers/jpegjs.js';
import { findMarker } from '../helpers/bytes.js';

/** @typedef {import('../../src/core/raster.js').Raster} Raster */

/**
 * @param {Raster} a
 * @param {Raster} b
 */
function compare(a, b) {
  let sum = 0;
  let max = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0));
      sum += d;
      max = Math.max(max, d);
      n++;
    }
  }
  return { mean: sum / n, max };
}

const image = texture(61, 45, 5);

describe('8x8 DCT', () => {
  it('inverse undoes forward for any block', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -128, max: 127 }), { minLength: 64, maxLength: 64 }),
        (block) => {
          const coef = new Float64Array(64);
          const back = new Float64Array(64);
          fdct8x8(block, coef);
          idct8x8(coef, back);
          return block.every((v, i) => Math.abs(v - (back[i] ?? 0)) < 1e-9);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('puts a flat block entirely into DC = 8 x value', () => {
    const coef = new Float64Array(64);
    fdct8x8(new Array(64).fill(10), coef);
    expect(coef[0]).toBeCloseTo(80, 9);
    expect(Math.max(...[...coef.subarray(1)].map(Math.abs))).toBeLessThan(1e-9);
  });
});

describe('decodeJpeg', () => {
  it('matches the independent jpeg-js decoder on a jpeg-js file', () => {
    const bytes = encodeJpegJs(image, 85);
    const ours = decodeJpeg(bytes);
    expect([ours.width, ours.height]).toEqual([61, 45]);
    const { mean, max } = compare(ours, decodeJpegJs(bytes));
    expect(mean).toBeLessThan(1);
    expect(max).toBeLessThanOrEqual(4);
  });

  it.each([
    ['4:2:0 with restart markers', { sampling: /** @type {const} */ ('420'), restartInterval: 3 }],
    ['4:2:2', { sampling: /** @type {const} */ ('422') }],
  ])('matches jpeg-js on %s', (_label, options) => {
    const bytes = encodeJpeg(image, { quality: 90, ...options });
    const { mean } = compare(decodeJpeg(bytes), decodeJpegJs(bytes));
    expect(mean).toBeLessThan(1.5);
  });

  it('decodes grayscale files to equal R, G and B', () => {
    const ours = decodeJpeg(encodeJpeg(image, { quality: 90, grayscale: true }));
    for (let i = 0; i < ours.data.length; i += 4) {
      expect(ours.data[i]).toBe(ours.data[i + 1]);
      expect(ours.data[i]).toBe(ours.data[i + 2]);
      expect(ours.data[i + 3]).toBe(255);
    }
  });

  it('refuses four-component (CMYK) files with a clear reason', () => {
    const bytes = encodeJpegJs(image, 90);
    const sof = findMarker(bytes, 0xc0);
    const cmyk = new Uint8Array(bytes.length + 3);
    cmyk.set(bytes.subarray(0, sof));
    // Rebuild SOF0 with a fourth component.
    const header = [
      0xff, 0xc0, 0, 20, 8, 0, 45, 0, 61, 4, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 4, 0x11, 0,
    ];
    cmyk.set(header, sof);
    cmyk.set(bytes.subarray(sof + 19), sof + header.length);
    expect(() => decodeJpeg(cmyk)).toThrow(ParseError);
    expect(() => decodeJpeg(cmyk)).toThrow(/CMYK/);
  });
});
