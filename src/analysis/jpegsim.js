import { createRaster } from '../core/raster.js';
import { fdct8x8, idct8x8 } from '../jpeg/dct.js';
import { CHROMA_BASE, LUMA_BASE, scaleTable } from '../jpeg/tables.js';

/** @typedef {import('../core/raster.js').Raster} Raster */

/**
 * Simulates saving the raster as a baseline JPEG at `quality` and decoding it again.
 *
 * Only the lossy steps of JPEG are reproduced (colour conversion, 8x8 DCT, quantization with
 * the IJG tables, inverse DCT); entropy coding is lossless and therefore skipped. Chroma is
 * kept at full resolution (4:4:4). This keeps ELA deterministic and identical in Node and in
 * the browser, without depending on a canvas encoder.
 *
 * @param {Raster} raster
 * @param {number} quality 1..100
 * @returns {Raster}
 */
export function jpegRoundTrip(raster, quality) {
  const { width, height, data } = raster;
  const luma = scaleTable(LUMA_BASE, quality);
  const chroma = scaleTable(CHROMA_BASE, quality);
  const n = width * height;
  const planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const [Y, Cb, Cr] = planes;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
    Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
  }

  const block = new Float64Array(64);
  const coef = new Float64Array(64);
  const back = new Float64Array(64);
  for (let c = 0; c < 3; c++) {
    const plane = planes[c];
    const table = c === 0 ? luma : chroma;
    for (let by = 0; by < height; by += 8) {
      for (let bx = 0; bx < width; bx += 8) {
        // Edge blocks are padded by replicating the last row/column, as encoders do.
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
            // Decoders store 8-bit samples, so round and clamp per plane.
            const v = Math.round(back[y * 8 + x] + 128);
            plane[(by + y) * width + bx + x] = v < 0 ? 0 : v > 255 ? 255 : v;
          }
        }
      }
    }
  }

  const out = createRaster(width, height);
  const o = out.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const y = Y[i];
    const cb = Cb[i] - 128;
    const cr = Cr[i] - 128;
    o[p] = y + 1.402 * cr;
    o[p + 1] = y - 0.344136 * cb - 0.714136 * cr;
    o[p + 2] = y + 1.772 * cb;
    o[p + 3] = 255;
  }
  return out;
}
