import { blockComponents, median } from '../core/regions.js';
import { LUMA_BASE, ZIGZAG, scaleTable } from './tables.js';

/**
 * Double JPEG compression analysis on quantized luminance DCT coefficients.
 *
 * When a JPEG saved with step q1 is decoded and saved again with a finer step q2 (q1 > q2),
 * each coefficient can only land on the bins round(n * q1 / q2): its histogram becomes a comb
 * with empty bins in between. For each low-frequency AC coefficient this module tests every
 * candidate q1 and measures how much more of the histogram sits on the q1 "lattice" than a
 * smooth single-compression model (a fitted discrete Laplacian) would put there.
 *
 * Localisation follows the idea of Lin et al. (2009): blocks of the doubly compressed
 * background put their coefficients on the lattice, while a region pasted in between the two
 * saves was compressed only once and does not. A naive-Bayes log-likelihood per block gives a
 * posterior probability that the block does NOT share the background's history.
 *
 * Limits: a second save at the same or lower quality (q2 >= q1) leaves no comb and is not
 * detected; heavy resizing or cropping off the 8x8 grid between saves also erases it.
 *
 * @typedef {import('./coefficients.js').CoefficientPlane} CoefficientPlane
 * @typedef {import('../core/regions.js').Region} Region
 * @typedef {{
 *   k: number, q2: number, q1: number | null, score: number, samples: number
 * }} FrequencyEvidence
 *   `k` is the zigzag index; `score` the excess lattice mass (0 = none, ~0.8 = strong).
 * @typedef {{
 *   likely: boolean, score: number, frequencies: FrequencyEvidence[],
 *   primaryQuality: number | null, blocksW: number, blocksH: number,
 *   map: Float32Array | null, regions: Region[]
 * }} DoubleCompressionResult
 */

/** Histogram half-width in quantization steps. */
const RANGE = 64;
/** Frequencies with fewer non-zero coefficients than this are not tested. */
const MIN_SAMPLES = 100;
/** Per-frequency evidence threshold, and threshold on the median over frequencies. */
const FREQUENCY_THRESHOLD = 0.25;
const GLOBAL_THRESHOLD = 0.25;
/** Largest q1/q2 ratio tested. */
const MAX_RATIO = 16;
/** Share of the background model given to off-lattice values (noise, misfit). */
const LAMBDA = 0.05;

/**
 * @param {CoefficientPlane} plane Luminance coefficients (needs `quant`).
 * @param {{ frequencies?: number }} [options] Number of zigzag AC frequencies examined.
 * @returns {DoubleCompressionResult}
 */
export function analyzeDoubleCompression(plane, { frequencies = 20 } = {}) {
  const { blocksW, blocksH } = plane;
  /** @type {DoubleCompressionResult} */
  const result = {
    likely: false,
    score: 0,
    frequencies: [],
    primaryQuality: null,
    blocksW,
    blocksH,
    map: null,
    regions: [],
  };
  const quant = plane.quant;
  if (!quant || plane.coeffs.length === 0) return result;

  /** @type {{ evidence: FrequencyEvidence, hist: Float64Array, rho: number, index: number }[]} */
  const tested = [];
  for (let k = 1; k <= Math.min(63, frequencies); k++) {
    const index = ZIGZAG[k];
    const hist = histogram(plane, index);
    const { nonzero, rho } = fitGeometric(hist);
    const q2 = quant[index];
    /** @type {FrequencyEvidence} */
    const evidence = { k, q2, q1: null, score: 0, samples: nonzero };
    if (nonzero >= MIN_SAMPLES && rho > 0) {
      const best = bestPrimaryStep(hist, nonzero, rho, q2);
      evidence.q1 = best.q1;
      evidence.score = best.score;
    }
    result.frequencies.push(evidence);
    if (evidence.q1 !== null) tested.push({ evidence, hist, rho, index });
  }
  if (tested.length === 0) return result;

  result.score = median(tested.map((t) => t.evidence.score));
  result.likely = result.score > GLOBAL_THRESHOLD;
  if (!result.likely) return result;

  const informative = tested.filter((t) => t.evidence.score > FREQUENCY_THRESHOLD);
  result.primaryQuality = primaryQuality(informative.map((t) => t.evidence));
  result.map = posteriorMap(plane, informative);
  result.regions = regionsOf(result.map, blocksW, blocksH);
  return result;
}

/**
 * Histogram of one coefficient over the real (non-padding) blocks, bins -RANGE..RANGE.
 * @param {CoefficientPlane} plane
 * @param {number} index Natural-order coefficient index.
 */
function histogram(plane, index) {
  const hist = new Float64Array(2 * RANGE + 1);
  for (let by = 0; by < plane.blocksH; by++) {
    const row = by * plane.stride;
    for (let bx = 0; bx < plane.blocksW; bx++) {
      const v = plane.coeffs[(row + bx) * 64 + index];
      if (v >= -RANGE && v <= RANGE) hist[v + RANGE]++;
    }
  }
  return hist;
}

/**
 * Fits P(|v| = j) proportional to rho^(j-1), j >= 1 (maximum likelihood: mean |v| = 1/(1-rho)).
 * The zero bin is left out everywhere: it is inflated by both single and double compression.
 * @param {Float64Array} hist
 */
function fitGeometric(hist) {
  let nonzero = 0;
  let sumAbs = 0;
  for (let i = 0; i < hist.length; i++) {
    if (i === RANGE) continue;
    nonzero += hist[i];
    sumAbs += hist[i] * Math.abs(i - RANGE);
  }
  return { nonzero, rho: nonzero > 0 ? 1 - nonzero / sumAbs : 0 };
}

/**
 * Bins a value can occupy after quantization with q1 then q2. Lattice points close to a
 * half-way point can round either way (decoder rounding noise), so both neighbours count.
 * @param {number} q1
 * @param {number} q2
 */
function lattice(q1, q2) {
  const reach = new Uint8Array(2 * RANGE + 1);
  const limit = Math.ceil((RANGE * q2) / q1) + 1;
  for (let n = -limit; n <= limit; n++) {
    const x = (n * q1) / q2;
    const frac = x - Math.floor(x);
    const candidates =
      Math.abs(frac - 0.5) < 0.15 ? [Math.floor(x), Math.ceil(x)] : [Math.round(x)];
    for (const v of candidates) if (v >= -RANGE && v <= RANGE) reach[v + RANGE] = 1;
  }
  return reach;
}

/**
 * Candidate q1 with the largest excess of histogram mass on its lattice.
 * @param {Float64Array} hist
 * @param {number} nonzero
 * @param {number} rho
 * @param {number} q2
 */
function bestPrimaryStep(hist, nonzero, rho, q2) {
  let best = { q1: q2, score: 0 };
  for (let q1 = q2 + 1; q1 <= Math.min(255, q2 * MAX_RATIO); q1++) {
    const reach = lattice(q1, q2);
    let onLattice = 0;
    let model = 0;
    let modelTotal = 0;
    for (let i = 0; i < hist.length; i++) {
      if (i === RANGE) continue;
      const p = rho ** (Math.abs(i - RANGE) - 1);
      modelTotal += p;
      if (reach[i]) {
        onLattice += hist[i];
        model += p;
      }
    }
    const score = onLattice / nonzero - model / modelTotal;
    if (score > best.score + 1e-9) best = { q1, score };
  }
  return best;
}

/**
 * The IJG quality whose luminance table agrees with the most estimated q1 values.
 * @param {FrequencyEvidence[]} evidence
 */
function primaryQuality(evidence) {
  let best = null;
  let bestMatches = 0;
  let bestError = Infinity;
  for (let q = 1; q <= 100; q++) {
    const table = scaleTable(LUMA_BASE, q);
    let matches = 0;
    let error = 0;
    for (const e of evidence) {
      const step = table[ZIGZAG[e.k]];
      if (step === e.q1) matches++;
      error += Math.abs(step - (e.q1 ?? 0));
    }
    if (matches > bestMatches || (matches === bestMatches && error < bestError)) {
      best = q;
      bestMatches = matches;
      bestError = error;
    }
  }
  return bestMatches >= 3 && bestMatches >= 0.4 * evidence.length ? best : null;
}

/**
 * Per-block posterior that the block was compressed once (not on the lattice), smoothed over
 * 3 x 3 blocks. NaN where no informative coefficient exists nearby.
 * @param {CoefficientPlane} plane
 * @param {{ evidence: FrequencyEvidence, hist: Float64Array, rho: number, index: number }[]} informative
 */
function posteriorMap(plane, informative) {
  const { blocksW, blocksH } = plane;
  const llr = new Float64Array(blocksW * blocksH);
  const count = new Uint16Array(blocksW * blocksH);
  for (const { evidence, hist, rho, index } of informative) {
    const reach = lattice(evidence.q1 ?? evidence.q2, evidence.q2);
    let modelTotal = 0;
    let latticeTotal = 0;
    for (let i = 0; i < hist.length; i++) {
      if (i === RANGE) continue;
      modelTotal += rho ** (Math.abs(i - RANGE) - 1);
      if (reach[i]) latticeTotal += hist[i];
    }
    const table = new Float64Array(hist.length);
    for (let i = 0; i < hist.length; i++) {
      if (i === RANGE) continue;
      const single = rho ** (Math.abs(i - RANGE) - 1) / modelTotal;
      const background = (1 - LAMBDA) * (reach[i] ? hist[i] / latticeTotal : 0) + LAMBDA * single;
      table[i] = Math.log(single + 1e-12) - Math.log(background + 1e-12);
    }
    for (let by = 0; by < blocksH; by++) {
      for (let bx = 0; bx < blocksW; bx++) {
        const v = plane.coeffs[(by * plane.stride + bx) * 64 + index];
        if (v === 0 || v < -RANGE || v > RANGE) continue;
        llr[by * blocksW + bx] += table[v + RANGE];
        count[by * blocksW + bx]++;
      }
    }
  }
  const map = new Float32Array(blocksW * blocksH);
  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx;
          const y = by + dy;
          if (x < 0 || y < 0 || x >= blocksW || y >= blocksH) continue;
          sum += llr[y * blocksW + x];
          n += count[y * blocksW + x];
        }
      }
      map[by * blocksW + bx] = n === 0 ? NaN : 1 / (1 + Math.exp(-sum));
    }
  }
  return map;
}

/**
 * @param {Float32Array} map
 * @param {number} bw
 * @param {number} bh
 * @returns {Region[]}
 */
function regionsOf(map, bw, bh) {
  const cells = new Uint8Array(map.length);
  let flagged = 0;
  for (let i = 0; i < map.length; i++) {
    if (map[i] > 0.5) {
      cells[i] = 1;
      flagged++;
    }
  }
  // If most of the image disagrees, there is no single "background" history to compare with.
  if (flagged > map.length / 2) return [];
  return blockComponents(cells, bw, bh)
    .filter((c) => c.count >= 4)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((c) => {
      let s = 0;
      for (let y = c.by; y < c.by + c.bh; y++) {
        for (let x = c.bx; x < c.bx + c.bw; x++) if (cells[y * bw + x]) s += map[y * bw + x];
      }
      return { x: c.bx * 8, y: c.by * 8, w: c.bw * 8, h: c.bh * 8, score: s / c.count };
    });
}
