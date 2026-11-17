import { fdct8x8, idct8x8 } from '../jpeg/dct.js';

/**
 * Simulates saving one image plane as JPEG with the given quantization table and decoding
 * it again: 8x8 DCT, quantize, dequantize, inverse DCT, round and clamp to 8 bits.
 *
 * Only the lossy steps are reproduced (entropy coding is lossless), so the result is exactly
 * what any baseline decoder would show, and identical in Node and in the browser without a
 * canvas encoder. Edge blocks are padded by replicating the last row/column, as encoders do.
 *
 * @param {Float32Array} plane Samples 0..255, row-major.
 * @param {number} width
 * @param {number} height
 * @param {Uint16Array} table Quantization steps, natural order.
 * @returns {Float32Array}
 */
export function requantize(plane, width, height, table) {
  const out = new Float32Array(plane.length);
  const block = new Float64Array(64);
  const coef = new Float64Array(64);
  const back = new Float64Array(64);
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const row = Math.min(height - 1, by + y) * width;
        for (let x = 0; x < 8; x++) {
          block[y * 8 + x] = plane[row + Math.min(width - 1, bx + x)] - 128;
        }
      }
      fdct8x8(block, coef);
      for (let i = 0; i < 64; i++) coef[i] = Math.round(coef[i] / table[i]) * table[i];
      idct8x8(coef, back);
      for (let y = 0; y < 8 && by + y < height; y++) {
        for (let x = 0; x < 8 && bx + x < width; x++) {
          const v = Math.round(back[y * 8 + x] + 128);
          out[(by + y) * width + bx + x] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
  }
  return out;
}
