import { toLuma } from '../core/raster.js';
import { LUMA_BASE, scaleTable } from '../jpeg/tables.js';
import { requantize } from './jpegsim.js';
import { blockComponents, median } from '../core/regions.js';

/**
 * @typedef {import('../core/raster.js').Raster} Raster
 * @typedef {import('../core/regions.js').Region} Region
 * @typedef {{
 *   quality: number, width: number, height: number, map: Float32Array,
 *   blocksW: number, blocksH: number, blockMeans: Float32Array,
 *   mean: number, max: number, hotspots: Region[], uniform: boolean
 * }} ElaResult
 */

/** Blocks flatter than this (luma standard deviation) carry no ELA signal and are ignored. */
const MIN_BLOCK_STD = 3;
/** A block is "hot" when its error is this many times the image's typical block error... */
const HOT_FACTOR = 3;
/** ...and at least this large in absolute terms (luma levels). */
const HOT_FLOOR = 0.75;
/** If more than this share of textured blocks is hot, the whole image responds alike. */
const UNIFORM_SHARE = 0.4;
/** Smallest hotspot reported, in 8x8 blocks. */
const MIN_HOTSPOT_BLOCKS = 4;

/**
 * Error Level Analysis on luminance: the image is re-saved (simulated) at `quality` and the
 * absolute difference is measured per pixel. Content that was already saved at that quality
 * barely changes; content added after the last save changes much more.
 *
 * Luminance-only avoids the rounding noise of the RGB -> YCbCr -> RGB conversion and of
 * chroma subsampling, which an RGB round trip adds to every pixel and which lowers the
 * contrast between pasted and original content (see docs/adr/0002). Colour-only edits are
 * therefore not visible here.
 *
 * @param {Raster} raster
 * @param {{ quality?: number }} [options]
 * @returns {ElaResult}
 */
export function errorLevel(raster, { quality = 90 } = {}) {
  const { width, height } = raster;
  const luma = toLuma(raster);
  const resaved = requantize(luma, width, height, scaleTable(LUMA_BASE, quality));
  const map = new Float32Array(luma.length);
  let max = 0;
  let sum = 0;
  for (let i = 0; i < map.length; i++) {
    const d = Math.abs(luma[i] - resaved[i]);
    map[i] = d;
    sum += d;
    if (d > max) max = d;
  }

  const blocksW = Math.ceil(width / 8);
  const blocksH = Math.ceil(height / 8);
  const blockMeans = new Float32Array(blocksW * blocksH);
  const textured = new Uint8Array(blocksW * blocksH);
  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      let s = 0;
      let s2 = 0;
      let e = 0;
      let n = 0;
      for (let y = by * 8; y < Math.min(height, by * 8 + 8); y++) {
        for (let x = bx * 8; x < Math.min(width, bx * 8 + 8); x++) {
          const v = luma[y * width + x];
          s += v;
          s2 += v * v;
          e += map[y * width + x];
          n++;
        }
      }
      const variance = s2 / n - (s / n) ** 2;
      blockMeans[by * blocksW + bx] = e / n;
      textured[by * blocksW + bx] = variance > MIN_BLOCK_STD * MIN_BLOCK_STD ? 1 : 0;
    }
  }

  const { hotspots, uniform } = findHotspots(blockMeans, textured, blocksW, blocksH);
  return {
    quality,
    width,
    height,
    map,
    blocksW,
    blocksH,
    blockMeans,
    mean: sum / map.length,
    max,
    hotspots,
    uniform,
  };
}

/**
 * @param {Float32Array} means
 * @param {Uint8Array} textured
 * @param {number} bw
 * @param {number} bh
 * @returns {{ hotspots: Region[], uniform: boolean }}
 */
function findHotspots(means, textured, bw, bh) {
  /** @type {number[]} */
  const values = [];
  for (let i = 0; i < means.length; i++) if (textured[i]) values.push(means[i]);
  if (values.length === 0) return { hotspots: [], uniform: false };
  const threshold = Math.max(HOT_FACTOR * median(values), HOT_FLOOR);
  const hot = new Uint8Array(means.length);
  let hotCount = 0;
  for (let i = 0; i < means.length; i++) {
    if (textured[i] && means[i] > threshold) {
      hot[i] = 1;
      hotCount++;
    }
  }
  // Absolute error is high almost everywhere: the image was never saved at this quality.
  const fresh = values.filter((v) => v > HOT_FLOOR * 2).length / values.length;
  if (hotCount / values.length > UNIFORM_SHARE || fresh > 0.5) {
    return { hotspots: [], uniform: true };
  }
  const hotspots = blockComponents(hot, bw, bh)
    .filter((c) => c.count >= MIN_HOTSPOT_BLOCKS)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((c) => {
      let s = 0;
      for (let y = c.by; y < c.by + c.bh; y++) {
        for (let x = c.bx; x < c.bx + c.bw; x++) if (hot[y * bw + x]) s += means[y * bw + x];
      }
      return { x: c.bx * 8, y: c.by * 8, w: c.bw * 8, h: c.bh * 8, score: s / c.count / threshold };
    });
  return { hotspots, uniform: false };
}
