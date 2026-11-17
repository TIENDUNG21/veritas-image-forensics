import { ParseError } from '../core/errors.js';
import { createRaster } from '../core/raster.js';
import { decodeCoefficients } from './coefficients.js';
import { idct8x8 } from './dct.js';
import { parseJpeg } from './parser.js';

/**
 * @typedef {import('../core/raster.js').Raster} Raster
 * @typedef {import('./coefficients.js').CoefficientData} CoefficientData
 * @typedef {import('./coefficients.js').CoefficientPlane} CoefficientPlane
 */

/**
 * Decodes a sequential 8-bit JPEG to RGBA pixels with the project's own decoder.
 *
 * Unlike a browser decode, the result is exactly the stored samples in stored orientation
 * (EXIF orientation is not applied), so the 8x8 block grid lines up with the pixel grid,
 * which ELA and the DCT analyses depend on.
 *
 * @param {Uint8Array | import('./parser.js').JpegStructure} input
 * @param {{ maxPixels?: number, coefficients?: CoefficientData }} [options]
 * @returns {Raster}
 */
export function decodeJpeg(input, options = {}) {
  const jpeg = input instanceof Uint8Array ? parseJpeg(input) : input;
  const frame = jpeg.frame;
  if (frame && frame.components.length === 4) {
    throw new ParseError('unsupported', 'four-component (CMYK/YCCK) JPEG is not decoded here');
  }
  if (frame && frame.components.length === 2) {
    throw new ParseError(
      'unsupported',
      'two-component JPEG is not a colour model this decoder knows',
    );
  }
  const data =
    options.coefficients ??
    decodeCoefficients(
      jpeg,
      options.maxPixels === undefined ? {} : { maxPixels: options.maxPixels },
    );
  const planes = data.components.map((plane) => samplePlane(plane));
  const raster = createRaster(data.width, data.height);
  const out = raster.data;
  const { width, height, hmax, vmax } = data;

  if (planes.length === 1) {
    const [p] = planes;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = p.samples[y * p.width + x];
        const o = (y * width + x) * 4;
        out[o] = v;
        out[o + 1] = v;
        out[o + 2] = v;
        out[o + 3] = 255;
      }
    }
    return raster;
  }

  const [p0, p1, p2] = planes;
  const rgbStored = storesRgb(jpeg);
  const sx = data.components.map((c) => c.h / hmax);
  const sy = data.components.map((c) => c.v / vmax);
  for (let y = 0; y < height; y++) {
    const r0 = Math.floor(y * sy[0]) * p0.width;
    const r1 = Math.floor(y * sy[1]) * p1.width;
    const r2 = Math.floor(y * sy[2]) * p2.width;
    for (let x = 0; x < width; x++) {
      const a = p0.samples[r0 + Math.floor(x * sx[0])];
      const b = p1.samples[r1 + Math.floor(x * sx[1])];
      const c = p2.samples[r2 + Math.floor(x * sx[2])];
      const o = (y * width + x) * 4;
      if (rgbStored) {
        out[o] = a;
        out[o + 1] = b;
        out[o + 2] = c;
      } else {
        // JFIF YCbCr -> RGB; Uint8ClampedArray rounds and clamps.
        out[o] = a + 1.402 * (c - 128);
        out[o + 1] = a - 0.344136 * (b - 128) - 0.714136 * (c - 128);
        out[o + 2] = a + 1.772 * (b - 128);
      }
      out[o + 3] = 255;
    }
  }
  return raster;
}

/**
 * Reconstructs the samples of one component (dequantize, inverse DCT, level shift, clamp).
 * @param {CoefficientPlane} plane
 * @returns {{ width: number, height: number, samples: Uint8ClampedArray }}
 */
export function samplePlane(plane) {
  const width = plane.stride * 8;
  const height = plane.rows * 8;
  const samples = new Uint8ClampedArray(width * height);
  const quant = plane.quant;
  if (!quant || plane.coeffs.length === 0) return { width, height, samples: samples.fill(128) };
  const block = new Float64Array(64);
  const pixels = new Float64Array(64);
  for (let by = 0; by < plane.rows; by++) {
    for (let bx = 0; bx < plane.stride; bx++) {
      const base = (by * plane.stride + bx) * 64;
      let acZero = true;
      for (let i = 1; i < 64; i++) {
        if (plane.coeffs[base + i] !== 0) {
          acZero = false;
          break;
        }
      }
      const origin = by * 8 * width + bx * 8;
      if (acZero) {
        // Only DC: the block is flat, no transform needed.
        const v = (plane.coeffs[base] * quant[0]) / 8 + 128;
        for (let y = 0; y < 8; y++) samples.fill(v, origin + y * width, origin + y * width + 8);
        continue;
      }
      for (let i = 0; i < 64; i++) block[i] = plane.coeffs[base + i] * quant[i];
      idct8x8(block, pixels);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) samples[origin + y * width + x] = pixels[y * 8 + x] + 128;
      }
    }
  }
  return { width, height, samples };
}

/**
 * True when the three components hold RGB rather than YCbCr: Adobe APP14 transform 0, or
 * component ids 'R', 'G', 'B' without a JFIF header.
 * @param {import('./parser.js').JpegStructure} jpeg
 */
function storesRgb(jpeg) {
  const adobe = jpeg.app.find((a) => a.label === 'Adobe');
  if (adobe && adobe.data.length >= 12) return adobe.data[11] === 0;
  const ids = jpeg.frame?.components.map((c) => c.id).join(',');
  return ids === '82,71,66' && !jpeg.app.some((a) => a.label === 'JFIF');
}
