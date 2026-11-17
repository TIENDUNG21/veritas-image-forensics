import { describe, expect, it } from 'vitest';
import { parseJpeg } from '../../src/jpeg/parser.js';
import { decodeCoefficients } from '../../src/jpeg/coefficients.js';
import { buildHuffmanTable } from '../../src/jpeg/huffman.js';
import { idct8x8 } from '../../src/jpeg/dct.js';
import { ParseError } from '../../src/core/errors.js';
import { solid, texture } from '../../tools/fixtures/synth.mjs';
import { encodeJpeg } from '../../tools/fixtures/jpeg-writer.mjs';
import { encodeJpegJs } from '../helpers/jpegjs.js';
import { findMarker } from '../helpers/bytes.js';

/** @typedef {import('../../src/core/raster.js').Raster} Raster */

/** @param {Uint8Array} bytes */
const decode = (bytes) => decodeCoefficients(parseJpeg(bytes));

/**
 * Mean absolute difference between the luma reconstructed from the Y coefficients and
 * the luma of the source raster.
 * @param {ReturnType<typeof decode>} data
 * @param {Raster} source
 */
function lumaError(data, source) {
  const y = data.components[0];
  if (!y?.quant) throw new Error('no luma plane');
  const block = new Float32Array(64);
  const out = new Float32Array(64);
  let sum = 0;
  let n = 0;
  for (let by = 0; by < y.blocksH; by++) {
    for (let bx = 0; bx < y.blocksW; bx++) {
      const base = (by * y.stride + bx) * 64;
      for (let i = 0; i < 64; i++) block[i] = (y.coeffs[base + i] ?? 0) * (y.quant[i] ?? 0);
      idct8x8(block, out);
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const x = bx * 8 + px;
          const yy = by * 8 + py;
          if (x >= source.width || yy >= source.height) continue;
          const p = (yy * source.width + x) * 4;
          const ref =
            0.299 * (source.data[p] ?? 0) +
            0.587 * (source.data[p + 1] ?? 0) +
            0.114 * (source.data[p + 2] ?? 0);
          sum += Math.abs((out[py * 8 + px] ?? 0) + 128 - ref);
          n++;
        }
      }
    }
  }
  return sum / n;
}

const image = texture(61, 45, 11);

describe('buildHuffmanTable', () => {
  it('decodes canonical codes and rejects over-subscribed lengths', () => {
    const counts = new Uint8Array(16);
    counts[1] = 3; // three 2-bit codes: 00, 01, 10
    const table = buildHuffmanTable({
      tableClass: 0,
      id: 0,
      counts,
      symbols: Uint8Array.from([5, 6, 7]),
      offset: 0,
    });
    expect(table.lookup[0b10_0000000]).toBe((2 << 8) | 7);
    const bad = new Uint8Array(16);
    bad[0] = 3; // three 1-bit codes cannot exist
    expect(() =>
      buildHuffmanTable({
        tableClass: 0,
        id: 0,
        counts: bad,
        symbols: Uint8Array.from([1, 2, 3]),
        offset: 9,
      }),
    ).toThrow(ParseError);
  });
});

describe('decodeCoefficients', () => {
  it('decodes a jpeg-js file completely', () => {
    const data = decode(encodeJpegJs(image, 90));
    expect(data.components).toHaveLength(3);
    expect(data.components[0]?.blocksW).toBe(8);
    expect(data.components[0]?.blocksH).toBe(6);
    expect(data.mcusDecoded).toBe(data.mcusTotal);
    expect(data.truncated).toBe(false);
    expect(data.warnings).toEqual([]);
    expect(lumaError(data, image)).toBeLessThan(2);
  });

  it('gives the expected DC value for a flat image', () => {
    const data = decode(
      encodeJpeg(solid(16, 16, [100, 100, 100]), { quality: 50, sampling: '444' }),
    );
    const y = data.components[0];
    // (100 - 128) * 8 / 16 = -14, where 16 is the quality-50 luminance DC step.
    for (let b = 0; b < 4; b++) {
      expect(y?.coeffs[b * 64]).toBe(-14);
      expect(y?.coeffs.subarray(b * 64 + 1, b * 64 + 64).every((v) => v === 0)).toBe(true);
    }
  });

  it.each([
    ['4:2:0', { sampling: /** @type {const} */ ('420') }],
    ['4:2:2', { sampling: /** @type {const} */ ('422') }],
    ['grayscale', { grayscale: true }],
  ])('handles %s sampling', (_label, options) => {
    const data = decode(encodeJpeg(image, { quality: 95, ...options }));
    expect(data.mcusDecoded).toBe(data.mcusTotal);
    expect(lumaError(data, image)).toBeLessThan(2);
    if (!('grayscale' in options)) {
      const cb = data.components[1];
      expect(cb?.blocksW).toBe(Math.ceil(Math.ceil(61 / 2) / 8));
    }
  });

  it('produces identical coefficients with and without restart markers', () => {
    const plain = decode(encodeJpeg(image, { quality: 80 }));
    const rst = decode(encodeJpeg(image, { quality: 80, restartInterval: 2 }));
    expect(rst.warnings).toEqual([]);
    for (let c = 0; c < 3; c++) {
      expect(rst.components[c]?.coeffs).toEqual(plain.components[c]?.coeffs);
    }
  });

  it('returns a partial result for truncated entropy data', () => {
    const full = encodeJpeg(image, { quality: 90 });
    const sos = findMarker(full, 0xda);
    const cut = full.subarray(0, sos + Math.floor((full.length - sos) / 2));
    const data = decode(cut);
    expect(data.truncated).toBe(true);
    expect(data.mcusDecoded).toBeGreaterThan(0);
    expect(data.mcusDecoded).toBeLessThan(data.mcusTotal);
    expect(data.warnings.join(' ')).toMatch(/truncated/);
    const reference = decode(full).components[0]?.coeffs;
    expect(data.components[0]?.coeffs.subarray(0, 64)).toEqual(reference?.subarray(0, 64));
  });

  describe('with restart markers and damaged data', () => {
    const bytes = encodeJpeg(image, { quality: 85, restartInterval: 1 });
    const reference = decode(bytes).components[0];
    const sos = findMarker(bytes, 0xda);
    const dataStart = sos + 2 + ((bytes[sos + 2] ?? 0) << 8) + (bytes[sos + 3] ?? 0);
    const lastRowOf = (/** @type {typeof reference} */ plane) =>
      ((plane?.rows ?? 1) - 1) * (plane?.stride ?? 0) * 64;

    it('limits overwritten bytes to the damaged interval', () => {
      const corrupt = bytes.slice();
      for (let i = dataStart + 2; i < dataStart + 6; i++) corrupt[i] = 0x5a;
      const y = decode(corrupt).components[0];
      const from = lastRowOf(y);
      expect(y?.coeffs.subarray(from)).toEqual(reference?.coeffs.subarray(from));
    });

    it('skips an interval whose data was cut short and resumes at the next marker', () => {
      const firstRst = findMarker(bytes.subarray(dataStart), 0xd0) + dataStart;
      const shortened = new Uint8Array(bytes.length - 20);
      shortened.set(bytes.subarray(0, firstRst - 30));
      shortened.set(bytes.subarray(firstRst - 10), firstRst - 30);
      const data = decode(shortened);
      expect(data.warnings.join(' ')).toMatch(/1 restart interval\(s\) were damaged/);
      expect(data.mcusDecoded).toBe(data.mcusTotal - 1);
      const y = data.components[0];
      const from = lastRowOf(y);
      expect(y?.coeffs.subarray(from)).toEqual(reference?.coeffs.subarray(from));
    });
  });

  it('rejects progressive frames and oversized images with clear errors', () => {
    const bytes = encodeJpegJs(image, 90);
    const progressive = bytes.slice();
    progressive[findMarker(progressive, 0xc0) + 1] = 0xc2;
    expect(() => decode(progressive)).toThrow(/progressive/i);

    const huge = bytes.slice();
    const sof = findMarker(huge, 0xc0);
    huge.set([0x75, 0x30, 0x75, 0x30], sof + 5); // 30000 x 30000
    try {
      decode(huge);
      throw new Error('expected an error');
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect(/** @type {ParseError} */ (error).code).toBe('too-large');
    }
  });

  it('can skip storing planes it does not need', () => {
    const data = decodeCoefficients(parseJpeg(encodeJpegJs(image, 90)), { componentIds: [1] });
    expect(data.components[0]?.coeffs.length).toBeGreaterThan(0);
    expect(data.components[1]?.coeffs.length).toBe(0);
    expect(data.mcusDecoded).toBe(data.mcusTotal);
  });
});
