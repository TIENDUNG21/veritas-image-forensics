// Procedural image synthesis for tests, samples and benchmarks.
// Everything is seeded, so a given seed always produces the same pixels.
import { createRaster } from '../../src/core/raster.js';

/** @typedef {import('../../src/core/raster.js').Raster} Raster */

/**
 * Small, fast seeded PRNG (mulberry32). Returns floats in [0, 1).
 * @param {number} seed
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal samples via Box-Muller.
 * @param {() => number} rand
 */
export function gaussian(rand) {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Fractal value noise in [0, 1]: a sum of smoothly interpolated random lattices.
 * @param {number} width
 * @param {number} height
 * @param {{ seed: number, cell?: number, octaves?: number, persistence?: number }} options
 */
export function valueNoise(width, height, { seed, cell = 64, octaves = 5, persistence = 0.55 }) {
  const rand = mulberry32(seed);
  const out = new Float32Array(width * height);
  let amplitude = 1;
  let total = 0;
  let size = cell;
  for (let o = 0; o < octaves && size >= 1; o++) {
    const gw = Math.ceil(width / size) + 2;
    const gh = Math.ceil(height / size) + 2;
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    for (let y = 0; y < height; y++) {
      const gy = y / size;
      const y0 = Math.floor(gy);
      const ty = smooth(gy - y0);
      for (let x = 0; x < width; x++) {
        const gx = x / size;
        const x0 = Math.floor(gx);
        const tx = smooth(gx - x0);
        const a = grid[y0 * gw + x0] ?? 0;
        const b = grid[y0 * gw + x0 + 1] ?? 0;
        const c = grid[(y0 + 1) * gw + x0] ?? 0;
        const d = grid[(y0 + 1) * gw + x0 + 1] ?? 0;
        const top = a + (b - a) * tx;
        const bottom = c + (d - c) * tx;
        out[y * width + x] = (out[y * width + x] ?? 0) + amplitude * (top + (bottom - top) * ty);
      }
    }
    total += amplitude;
    amplitude *= persistence;
    size = Math.max(1, Math.floor(size / 2));
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / total;
  return out;
}

/** @param {number} t */
function smooth(t) {
  return t * t * (3 - 2 * t);
}

/**
 * A colourful natural-looking texture with fine grain, so that JPEG statistics resemble a photo.
 * @param {number} width
 * @param {number} height
 * @param {number} seed
 * @param {{ grain?: number, cell?: number }} [options]
 * @returns {Raster}
 */
export function texture(width, height, seed, { grain = 3, cell = 48 } = {}) {
  const r = valueNoise(width, height, { seed, cell });
  const g = valueNoise(width, height, { seed: seed + 101, cell: Math.round(cell * 1.3) });
  const b = valueNoise(width, height, { seed: seed + 202, cell: Math.round(cell * 0.8) });
  const rand = mulberry32(seed + 303);
  const raster = createRaster(width, height);
  const d = raster.data;
  for (let i = 0, p = 0; i < r.length; i++, p += 4) {
    const n = grain * gaussian(rand);
    const base = r[i] ?? 0;
    d[p] = 30 + 200 * base + n;
    d[p + 1] = 25 + 160 * (0.6 * (g[i] ?? 0) + 0.4 * base) + n;
    d[p + 2] = 20 + 150 * (0.7 * (b[i] ?? 0) + 0.3 * base) + n;
    d[p + 3] = 255;
  }
  return raster;
}

/**
 * Fills the whole raster with one colour.
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number]} rgb
 */
export function solid(width, height, [red, green, blue]) {
  const raster = createRaster(width, height);
  for (let p = 0; p < raster.data.length; p += 4) {
    raster.data[p] = red;
    raster.data[p + 1] = green;
    raster.data[p + 2] = blue;
    raster.data[p + 3] = 255;
  }
  return raster;
}

/**
 * Copies a rectangle from `src` into `dst` (they may be the same raster).
 * @param {Raster} src
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {Raster} dst
 * @param {number} dx
 * @param {number} dy
 */
export function copyRect(src, rect, dst, dx, dy) {
  const tmp = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    const from = ((rect.y + y) * src.width + rect.x) * 4;
    tmp.set(src.data.subarray(from, from + rect.w * 4), y * rect.w * 4);
  }
  for (let y = 0; y < rect.h; y++) {
    const to = ((dy + y) * dst.width + dx) * 4;
    dst.data.set(tmp.subarray(y * rect.w * 4, (y + 1) * rect.w * 4), to);
  }
}

/**
 * Adds zero-mean Gaussian noise to every channel inside `rect` (or the whole image).
 * @param {Raster} raster
 * @param {number} sigma
 * @param {number} seed
 * @param {{ x: number, y: number, w: number, h: number }} [rect]
 */
export function addNoise(raster, sigma, seed, rect) {
  const rand = mulberry32(seed);
  const r = rect ?? { x: 0, y: 0, w: raster.width, h: raster.height };
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const p = (y * raster.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        raster.data[p + c] = (raster.data[p + c] ?? 0) + sigma * gaussian(rand);
      }
    }
  }
}
