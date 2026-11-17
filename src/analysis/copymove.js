import { COPY_MOVE_MAX_SIDE } from '../core/limits.js';
import { resizeBox, toLuma } from '../core/raster.js';
import { blockComponents } from '../core/regions.js';
import { LUMA_BASE, ZIGZAG } from '../jpeg/tables.js';

/**
 * Copy-move (clone) detection after Fridrich, Soukal and Lukas (2003).
 *
 * 1. Every overlapping 8x8 block (stride 1) of the luminance gets a feature vector: its 16
 *    lowest-frequency DCT coefficients, quantized with the JPEG luminance steps x `factor`.
 *    Flat blocks are skipped, since they would match everywhere.
 * 2. Feature rows are sorted lexicographically, so identical or near-identical blocks end up
 *    next to each other; each row is compared with the next `window` rows.
 * 3. Every matching pair votes for its shift vector (dx, dy). A cloned region produces
 *    thousands of pairs with the same shift; coincidental matches scatter their votes.
 * 4. Shifts with enough votes are kept if their pairs form a spatially coherent cluster, and
 *    both ends of those pairs are painted into the mask.
 *
 * @typedef {import('../core/raster.js').Raster} Raster
 * @typedef {import('../core/regions.js').Region} Region
 * @typedef {{ dx: number, dy: number, votes: number, source: Region, target: Region }} ClonePair
 *   Shift and rectangles in original image pixels. "source" is the upper-left end of the
 *   pair; which copy is the original cannot be told from pixels alone.
 * @typedef {{
 *   width: number, height: number, scale: number, mask: Uint8Array, pairs: ClonePair[],
 *   blocksAnalysed: number
 * }} CopyMoveResult
 *   `width`, `height` and `mask` are at the analysis resolution (`scale` x original).
 * @typedef {{
 *   maxSide?: number, minShift?: number, minVotes?: number, window?: number,
 *   tolerance?: number, factor?: number, minStd?: number
 * }} CopyMoveOptions
 */

const COEFFS = 16;
const DEFAULTS = {
  maxSide: COPY_MOVE_MAX_SIDE,
  minShift: 16,
  minVotes: 40,
  window: 8,
  tolerance: 1,
  factor: 0.5,
  minStd: 2.5,
};

/** DCT basis images for the first COEFFS zigzag positions. */
const BASIS = (() => {
  const out = new Float64Array(COEFFS * 64);
  for (let k = 0; k < COEFFS; k++) {
    const idx = ZIGZAG[k];
    const u = idx % 8;
    const v = idx >> 3;
    const cu = u === 0 ? Math.SQRT1_2 : 1;
    const cv = v === 0 ? Math.SQRT1_2 : 1;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        out[k * 64 + y * 8 + x] =
          ((cu * cv) / 4) *
          Math.cos(((2 * x + 1) * u * Math.PI) / 16) *
          Math.cos(((2 * y + 1) * v * Math.PI) / 16);
      }
    }
  }
  return out;
})();

/**
 * Quantized low-frequency DCT features of every textured 8x8 block.
 * @param {Float32Array} luma
 * @param {number} width
 * @param {number} height
 * @param {{ factor?: number, minStd?: number }} [options]
 * @returns {{ features: Int16Array, positions: Int32Array, count: number }}
 *   Row r of `features` (16 values) belongs to the block whose top-left pixel index is
 *   `positions[r]`.
 */
export function extractBlockFeatures(luma, width, height, options = {}) {
  const factor = options.factor ?? DEFAULTS.factor;
  const minVar = (options.minStd ?? DEFAULTS.minStd) ** 2;
  const total = Math.max(0, width - 7) * Math.max(0, height - 7);
  const features = new Int16Array(total * COEFFS);
  const positions = new Int32Array(total);
  const steps = new Float64Array(COEFFS);
  for (let k = 0; k < COEFFS; k++) steps[k] = LUMA_BASE[ZIGZAG[k]] * factor;
  const block = new Float64Array(64);
  let count = 0;
  for (let y = 0; y + 8 <= height; y++) {
    for (let x = 0; x + 8 <= width; x++) {
      let s = 0;
      let s2 = 0;
      for (let yy = 0; yy < 8; yy++) {
        const row = (y + yy) * width + x;
        for (let xx = 0; xx < 8; xx++) {
          const v = luma[row + xx];
          block[yy * 8 + xx] = v;
          s += v;
          s2 += v * v;
        }
      }
      if (s2 / 64 - (s / 64) ** 2 < minVar) continue;
      const o = count * COEFFS;
      for (let k = 0; k < COEFFS; k++) {
        let c = 0;
        const b = k * 64;
        for (let i = 0; i < 64; i++) c += block[i] * BASIS[b + i];
        features[o + k] = Math.round(c / steps[k]);
      }
      positions[count++] = y * width + x;
    }
  }
  return { features, positions, count };
}

/**
 * @param {Raster} raster
 * @param {CopyMoveOptions} [options]
 * @returns {CopyMoveResult}
 */
export function detectCopyMove(raster, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const longest = Math.max(raster.width, raster.height);
  const scale = longest > o.maxSide ? o.maxSide / longest : 1;
  const work =
    scale < 1
      ? resizeBox(
          raster,
          Math.max(1, Math.round(raster.width * scale)),
          Math.max(1, Math.round(raster.height * scale)),
        )
      : raster;
  const { width, height } = work;
  const realScale = width / raster.width;
  const mask = new Uint8Array(width * height);
  const { features, positions, count } = extractBlockFeatures(toLuma(work), width, height, o);
  /** @type {CopyMoveResult} */
  const result = { width, height, scale: realScale, mask, pairs: [], blocksAnalysed: count };
  if (count < 2) return result;

  // 2. Lexicographic sort of the feature rows.
  const order = new Int32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => {
    const pa = a * COEFFS;
    const pb = b * COEFFS;
    for (let k = 0; k < COEFFS; k++) {
      const d = features[pa + k] - features[pb + k];
      if (d !== 0) return d;
    }
    return 0;
  });

  const span = 2 * height + 1;
  const keyOf = (/** @type {number} */ dx, /** @type {number} */ dy) => dx * span + dy + height;
  const minShift2 = o.minShift * o.minShift;

  /**
   * Visits every matching pair as (first block, second block, dx, dy) with the shift
   * normalised to dx > 0, or dx = 0 and dy > 0.
   * @param {(a: number, b: number, dx: number, dy: number) => void} visit
   */
  const forEachMatch = (visit) => {
    for (let i = 0; i < count; i++) {
      const a = order[i];
      const pa = a * COEFFS;
      for (let j = i + 1; j <= Math.min(count - 1, i + o.window); j++) {
        const b = order[j];
        const pb = b * COEFFS;
        let dist = 0;
        for (let k = 0; k < COEFFS && dist <= o.tolerance; k++) {
          dist += Math.abs(features[pa + k] - features[pb + k]);
        }
        if (dist > o.tolerance) continue;
        const ax = positions[a] % width;
        const ay = (positions[a] - ax) / width;
        const bx = positions[b] % width;
        const by = (positions[b] - bx) / width;
        const dx = bx - ax;
        const dy = by - ay;
        if (dx * dx + dy * dy < minShift2) continue;
        if (dx < 0 || (dx === 0 && dy < 0)) visit(b, a, -dx, -dy);
        else visit(a, b, dx, dy);
      }
    }
  };

  // 3. Vote for shift vectors.
  /** @type {Map<number, number>} */
  const votes = new Map();
  forEachMatch((_a, _b, dx, dy) => {
    const key = keyOf(dx, dy);
    votes.set(key, (votes.get(key) ?? 0) + 1);
  });
  /** @param {number} dx @param {number} dy */
  const merged = (dx, dy) => {
    let s = 0;
    for (let ex = -1; ex <= 1; ex++) {
      for (let ey = -1; ey <= 1; ey++) s += votes.get(keyOf(dx + ex, dy + ey)) ?? 0;
    }
    return s;
  };
  /** @type {{ dx: number, dy: number, votes: number }[]} */
  const candidates = [];
  for (const key of votes.keys()) {
    const dx = Math.floor(key / span);
    const dy = key - dx * span - height;
    const v = merged(dx, dy);
    if (v >= o.minVotes) candidates.push({ dx, dy, votes: v });
  }
  candidates.sort((a, b) => b.votes - a.votes);
  // Neighbouring shifts (+-1 from JPEG noise) belong to the same clone.
  /** @type {{ dx: number, dy: number, votes: number }[]} */
  const accepted = [];
  for (const c of candidates) {
    if (accepted.some((a) => Math.abs(a.dx - c.dx) <= 2 && Math.abs(a.dy - c.dy) <= 2)) continue;
    accepted.push(c);
    if (accepted.length >= 8) break;
  }
  if (accepted.length === 0) return result;

  // 4. Collect the pairs of each accepted shift and keep coherent clusters.
  const cellsW = Math.ceil(width / 8);
  const cellsH = Math.ceil(height / 8);
  const perShift = accepted.map(() => ({
    cells: new Uint16Array(cellsW * cellsH),
    /** @type {number[]} */
    pairs: [],
  }));
  forEachMatch((a, b, dx, dy) => {
    const s = accepted.findIndex((c) => Math.abs(c.dx - dx) <= 1 && Math.abs(c.dy - dy) <= 1);
    if (s < 0) return;
    const entry = perShift[s];
    const pa = positions[a];
    const ax = pa % width;
    const ay = (pa - ax) / width;
    const cell = (ay >> 3) * cellsW + (ax >> 3);
    entry.cells[cell] = Math.min(65535, entry.cells[cell] + 1);
    entry.pairs.push(pa, positions[b]);
  });

  accepted.forEach((shift, s) => {
    const { cells, pairs } = perShift[s];
    const occupied = new Uint8Array(cells.length);
    for (let i = 0; i < cells.length; i++) occupied[i] = cells[i] > 0 ? 1 : 0;
    const label = new Int32Array(cells.length).fill(-1);
    const components = blockComponents(occupied, cellsW, cellsH);
    /** @type {number[]} */
    const keep = [];
    components.forEach((c, index) => {
      let weight = 0;
      for (let y = c.by; y < c.by + c.bh; y++) {
        for (let x = c.bx; x < c.bx + c.bw; x++) weight += cells[y * cellsW + x];
      }
      if (weight >= Math.max(20, o.minVotes / 2)) keep.push(index);
    });
    if (keep.length === 0) return;
    for (const index of keep) {
      const c = components[index];
      for (let y = c.by; y < c.by + c.bh; y++) {
        for (let x = c.bx; x < c.bx + c.bw; x++)
          if (occupied[y * cellsW + x]) label[y * cellsW + x] = index;
      }
    }
    /** @type {Map<number, { sx0: number, sy0: number, sx1: number, sy1: number, tx0: number, ty0: number, tx1: number, ty1: number, n: number }>} */
    const boxes = new Map();
    for (let p = 0; p < pairs.length; p += 2) {
      const pa = pairs[p];
      const pb = pairs[p + 1];
      const ax = pa % width;
      const ay = (pa - ax) / width;
      const index = label[(ay >> 3) * cellsW + (ax >> 3)];
      if (index < 0) continue;
      const bx = pb % width;
      const by = (pb - bx) / width;
      paint(mask, width, ax, ay);
      paint(mask, width, bx, by);
      const box = boxes.get(index) ?? {
        sx0: ax,
        sy0: ay,
        sx1: ax + 8,
        sy1: ay + 8,
        tx0: bx,
        ty0: by,
        tx1: bx + 8,
        ty1: by + 8,
        n: 0,
      };
      box.sx0 = Math.min(box.sx0, ax);
      box.sy0 = Math.min(box.sy0, ay);
      box.sx1 = Math.max(box.sx1, ax + 8);
      box.sy1 = Math.max(box.sy1, ay + 8);
      box.tx0 = Math.min(box.tx0, bx);
      box.ty0 = Math.min(box.ty0, by);
      box.tx1 = Math.max(box.tx1, bx + 8);
      box.ty1 = Math.max(box.ty1, by + 8);
      box.n++;
      boxes.set(index, box);
    }
    const inv = 1 / realScale;
    for (const box of boxes.values()) {
      result.pairs.push({
        dx: Math.round(shift.dx * inv),
        dy: Math.round(shift.dy * inv),
        votes: box.n,
        source: toRegion(box.sx0, box.sy0, box.sx1, box.sy1, inv, box.n),
        target: toRegion(box.tx0, box.ty0, box.tx1, box.ty1, inv, box.n),
      });
    }
  });
  result.pairs.sort((a, b) => b.votes - a.votes);
  return result;
}

/**
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} x
 * @param {number} y
 */
function paint(mask, width, x, y) {
  for (let yy = y; yy < y + 8; yy++) mask.fill(1, yy * width + x, yy * width + x + 8);
}

/**
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} inv
 * @param {number} score
 * @returns {Region}
 */
function toRegion(x0, y0, x1, y1, inv, score) {
  return {
    x: Math.round(x0 * inv),
    y: Math.round(y0 * inv),
    w: Math.round((x1 - x0) * inv),
    h: Math.round((y1 - y0) * inv),
    score,
  };
}
