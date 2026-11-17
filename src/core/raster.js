/**
 * An 8-bit RGBA image in row-major order, the common currency of all pixel analyses.
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray }} Raster
 */

/**
 * @param {number} width
 * @param {number} height
 * @returns {Raster}
 */
export function createRaster(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/**
 * ITU-R BT.601 luma (the Y of JPEG's YCbCr), one float per pixel.
 * @param {Raster} raster
 * @returns {Float32Array}
 */
export function toLuma(raster) {
  const { data } = raster;
  const out = new Float32Array(raster.width * raster.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return out;
}

/**
 * Area-averaging (box filter) resize, intended for shrinking.
 * @param {Raster} src
 * @param {number} width
 * @param {number} height
 * @returns {Raster}
 */
export function resizeBox(src, width, height) {
  const out = createRaster(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  const sums = new Float64Array(4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(src.width, Math.floor((x + 1) * sx)));
      sums.fill(0);
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const p = (yy * src.width + xx) * 4;
          sums[0] += src.data[p];
          sums[1] += src.data[p + 1];
          sums[2] += src.data[p + 2];
          sums[3] += src.data[p + 3];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * 4;
      out.data[o] = sums[0] / n;
      out.data[o + 1] = sums[1] / n;
      out.data[o + 2] = sums[2] / n;
      out.data[o + 3] = sums[3] / n;
    }
  }
  return out;
}

/**
 * Shrinks the raster so it has at most `maxPixels` pixels (aspect ratio kept).
 * @param {Raster} raster
 * @param {number} maxPixels
 * @returns {{ raster: Raster, scale: number }} `scale` = new width / old width.
 */
export function downscaleToFit(raster, maxPixels) {
  const pixels = raster.width * raster.height;
  if (pixels <= maxPixels) return { raster, scale: 1 };
  const s = Math.sqrt(maxPixels / pixels);
  const width = Math.max(1, Math.floor(raster.width * s));
  const height = Math.max(1, Math.floor(raster.height * s));
  return { raster: resizeBox(raster, width, height), scale: width / raster.width };
}
