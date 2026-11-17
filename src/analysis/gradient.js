import { toLuma } from '../core/raster.js';

/**
 * @typedef {import('../core/raster.js').Raster} Raster
 * @typedef {{
 *   width: number, height: number, gx: Float32Array, gy: Float32Array,
 *   magnitude: Float32Array, max: number
 * }} GradientResult
 */

/**
 * Sobel gradient of the luminance (borders replicated). Shown as a colour image where the
 * direction of every edge is visible: lighting that comes from a different direction, edges
 * that are too sharp or too soft, or smoothed patches stand out against their surroundings.
 * @param {Raster} raster
 * @returns {GradientResult}
 */
export function luminanceGradient(raster) {
  const { width, height } = raster;
  const luma = toLuma(raster);
  const n = luma.length;
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const magnitude = new Float32Array(n);
  let max = 0;
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1) * width;
    const row = y * width;
    const down = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x++) {
      const l = Math.max(0, x - 1);
      const r = Math.min(width - 1, x + 1);
      const a = luma[up + l];
      const b = luma[up + x];
      const c = luma[up + r];
      const d = luma[row + l];
      const f = luma[row + r];
      const g = luma[down + l];
      const h = luma[down + x];
      const k = luma[down + r];
      const sx = c + 2 * f + k - a - 2 * d - g;
      const sy = g + 2 * h + k - a - 2 * b - c;
      const i = row + x;
      gx[i] = sx;
      gy[i] = sy;
      const m = Math.hypot(sx, sy);
      magnitude[i] = m;
      if (m > max) max = m;
    }
  }
  return { width, height, gx, gy, magnitude, max };
}
