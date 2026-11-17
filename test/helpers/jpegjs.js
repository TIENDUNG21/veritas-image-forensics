// Thin wrappers around the independent jpeg-js codec, used only to build fixtures
// and to cross-check Veritas' own decoder.
import jpeg from 'jpeg-js';

/** @typedef {import('../../src/core/raster.js').Raster} Raster */

/**
 * Encodes a raster with jpeg-js (baseline, 4:4:4, IJG tables scaled to `quality`).
 * @param {Raster} raster
 * @param {number} quality
 * @param {{ comments?: string[], exif?: Uint8Array }} [extra]
 * @returns {Uint8Array}
 */
export function encodeJpegJs(raster, quality, extra = {}) {
  /** @type {any} */
  const image = { width: raster.width, height: raster.height, data: raster.data };
  if (extra.comments) image.comments = extra.comments;
  if (extra.exif) image.exifBuffer = extra.exif;
  return new Uint8Array(jpeg.encode(image, quality).data);
}

/**
 * Decodes with jpeg-js into a raster.
 * @param {Uint8Array} bytes
 * @returns {Raster}
 */
export function decodeJpegJs(bytes) {
  const out = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  return { width: out.width, height: out.height, data: new Uint8ClampedArray(out.data) };
}
