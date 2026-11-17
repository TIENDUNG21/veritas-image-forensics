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
