import { toLuma } from '../core/raster.js';
import { blockComponents, median, quantile } from './regions.js';

/**
 * @typedef {import('../core/raster.js').Raster} Raster
 * @typedef {import('./regions.js').Region} Region
 * @typedef {{
 *   width: number, height: number, residual: Float32Array, block: number,
 *   blocksW: number, blocksH: number, sigma: Float32Array, globalSigma: number,
 *   regions: Region[]
 * }} NoiseResult
 *   `residual` is |Laplacian-difference response| per pixel; `sigma` the estimated noise
 *   standard deviation per block (NaN where too few smooth pixels remain).
 */

/** sqrt(pi/2) / 6: scales mean |N * I| to a Gaussian standard deviation (Immerkaer 1996). */
const SCALE = Math.sqrt(Math.PI / 2) / 6;
/** Share of strongest-gradient pixels excluded as edges (Tai and Yang 2008 use 10%). */
const EDGE_SHARE = 0.1;
/** Block noise counts as inconsistent beyond this ratio to the image median (either way). */
const RATIO = 2;
const MIN_REGION_BLOCKS = 3;

/**
 * Local noise level map. Each pixel is convolved with the kernel
 * [1 -2 1; -2 4 -2; 1 -2 1], which cancels flat areas, ramps and most texture and leaves
 * mostly sensor/compression noise. Strong edges are excluded, then the noise standard
 * deviation is estimated per block. Pasted, retouched or smoothed regions often carry a
 * different noise level from the rest of the photo.
 *
 * @param {Raster} raster
 * @param {{ block?: number }} [options] Block size in pixels (default 16, or 32 above 4 MP).
 * @returns {NoiseResult}
 */
export function noiseMap(raster, options = {}) {
  const { width, height } = raster;
  const block = options.block ?? (width * height > 4_000_000 ? 32 : 16);
  const luma = toLuma(raster);
  const residual = new Float32Array(luma.length);
  const gradient = new Float32Array(luma.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const a = luma[i - width - 1];
      const b = luma[i - width];
      const c = luma[i - width + 1];
      const d = luma[i - 1];
      const e = luma[i];
      const f = luma[i + 1];
      const g = luma[i + width - 1];
      const h = luma[i + width];
      const k = luma[i + width + 1];
      residual[i] = Math.abs(a - 2 * b + c - 2 * d + 4 * e - 2 * f + g - 2 * h + k);
      const gx = c + 2 * f + k - a - 2 * d - g;
      const gy = g + 2 * h + k - a - 2 * b - c;
      gradient[i] = Math.abs(gx) + Math.abs(gy);
    }
  }
  const edgeLimit = Math.max(1e-6, sampledQuantile(gradient, 1 - EDGE_SHARE));

  const blocksW = Math.ceil(width / block);
  const blocksH = Math.ceil(height / block);
  const sigma = new Float32Array(blocksW * blocksH).fill(NaN);
  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      let sum = 0;
      let n = 0;
      for (let y = Math.max(1, by * block); y < Math.min(height - 1, (by + 1) * block); y++) {
        for (let x = Math.max(1, bx * block); x < Math.min(width - 1, (bx + 1) * block); x++) {
          const i = y * width + x;
          if (gradient[i] > edgeLimit) continue;
          sum += residual[i];
          n++;
        }
      }
      if (n >= (block * block) / 4) sigma[by * blocksW + bx] = (SCALE * sum) / n;
    }
  }
  const valid = [...sigma].filter((s) => Number.isFinite(s));
  const globalSigma = median(valid);
  return {
    width,
    height,
    residual,
    block,
    blocksW,
    blocksH,
    sigma,
    globalSigma,
    regions: inconsistentRegions(sigma, blocksW, blocksH, block, globalSigma),
  };
}

/**
 * Quantile from a strided sample (exact enough for a threshold, fast on large images).
 * @param {Float32Array} values
 * @param {number} q
 */
function sampledQuantile(values, q) {
  const step = Math.max(1, Math.floor(values.length / 200_000));
  const sample = new Float32Array(Math.ceil(values.length / step));
  for (let i = 0, j = 0; i < values.length; i += step, j++) sample[j] = values[i];
  return quantile(sample, q);
}

/**
 * Connected groups of blocks whose noise level differs from the image median by more than
 * `RATIO` in either direction. `score` is the group's median ratio (above 1 = noisier).
 * @param {Float32Array} sigma
 * @param {number} bw
 * @param {number} bh
 * @param {number} block
 * @param {number} global
 * @returns {Region[]}
 */
function inconsistentRegions(sigma, bw, bh, block, global) {
  if (!(global > 0.25)) return [];
  /** @type {Region[]} */
  const regions = [];
  for (const direction of [1, -1]) {
    const cells = new Uint8Array(sigma.length);
    for (let i = 0; i < sigma.length; i++) {
      const r = sigma[i] / global;
      if (Number.isFinite(r) && (direction > 0 ? r > RATIO : r < 1 / RATIO)) cells[i] = 1;
    }
    for (const c of blockComponents(cells, bw, bh)) {
      if (c.count < MIN_REGION_BLOCKS || c.count > sigma.length / 3) continue;
      /** @type {number[]} */
      const ratios = [];
      for (let y = c.by; y < c.by + c.bh; y++) {
        for (let x = c.bx; x < c.bx + c.bw; x++) {
          if (cells[y * bw + x]) ratios.push(sigma[y * bw + x] / global);
        }
      }
      regions.push({
        x: c.bx * block,
        y: c.by * block,
        w: c.bw * block,
        h: c.bh * block,
        score: median(ratios),
      });
    }
  }
  return regions.sort((a, b) => Math.abs(Math.log(b.score)) - Math.abs(Math.log(a.score)));
}
