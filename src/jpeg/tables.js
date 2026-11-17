/**
 * Static JPEG tables: zigzag order and the example quantization tables from
 * ITU-T T.81 Annex K that the IJG library (and most software encoders) scale by quality.
 */

/** `ZIGZAG[k]` is the natural (row-major) index of the k-th coefficient in zigzag order. */
export const ZIGZAG = Uint8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

/** Annex K.1 luminance table, natural order. */
export const LUMA_BASE = Uint16Array.from([
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]);

/** Annex K.2 chrominance table, natural order. */
export const CHROMA_BASE = Uint16Array.from([
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
]);

/**
 * IJG quality scaling (libjpeg `jpeg_quality_scaling`): quality 1..100 maps to a percentage
 * applied to the base table, values clamped to 1..255 as for baseline JPEG.
 * @param {Uint16Array} base Natural-order base table.
 * @param {number} quality 1..100 (clamped).
 * @returns {Uint16Array}
 */
export function scaleTable(base, quality) {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  const out = new Uint16Array(64);
  for (let i = 0; i < 64; i++) {
    const v = Math.floor(((base[i] ?? 0) * scale + 50) / 100);
    out[i] = Math.min(255, Math.max(1, v));
  }
  return out;
}
