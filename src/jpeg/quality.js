import { CHROMA_BASE, LUMA_BASE, scaleTable } from './tables.js';

/**
 * @typedef {import('./parser.js').QuantTable} QuantTable
 * @typedef {{ id: number, role: 'luminance' | 'chrominance', quality: number, exact: boolean, meanError: number }} TableQuality
 * @typedef {{ quality: number | null, exact: boolean, standard: boolean, perTable: TableQuality[] }} QualityEstimate
 */

/** Mean absolute step difference per entry below which a table counts as IJG-standard. */
const STANDARD_TOLERANCE = 1;

/** Precomputed IJG tables for every quality, so estimation is 100 cheap comparisons. */
const SCALED = Array.from({ length: 101 }, (_, q) =>
  q === 0 ? null : { luma: scaleTable(LUMA_BASE, q), chroma: scaleTable(CHROMA_BASE, q) },
);

/**
 * Estimates the IJG quality setting (1..100) that produced the quantization tables, by
 * comparing them with the Annex K tables scaled for every quality. `exact` means every
 * step matches; `standard` is false when even the closest quality is far off, which points
 * to an encoder with its own tables (cameras, some editors).
 *
 * @param {import('./parser.js').JpegStructure | QuantTable[]} input
 * @returns {QualityEstimate}
 */
export function estimateQuality(input) {
  const tables = Array.isArray(input) ? input : collect(input);
  if (tables.length === 0) return { quality: null, exact: false, standard: false, perTable: [] };
  const lumaId = Array.isArray(input) ? 0 : (input.frame?.components[0]?.tq ?? 0);

  let best = 1;
  let bestError = Infinity;
  for (let q = 1; q <= 100; q++) {
    let error = 0;
    for (const t of tables) error += meanError(t.values, reference(q, t.id === lumaId));
    if (error < bestError - 1e-12) {
      bestError = error;
      best = q;
    }
  }

  /** @type {TableQuality[]} */
  const perTable = tables.map((t) => {
    const luma = t.id === lumaId;
    let q = 1;
    let err = Infinity;
    for (let c = 1; c <= 100; c++) {
      const e = meanError(t.values, reference(c, luma));
      if (e < err - 1e-12) {
        err = e;
        q = c;
      }
    }
    return {
      id: t.id,
      role: luma ? 'luminance' : 'chrominance',
      quality: q,
      exact: err === 0,
      meanError: err,
    };
  });
  return {
    quality: best,
    exact: bestError === 0,
    standard: bestError / tables.length <= STANDARD_TOLERANCE,
    perTable,
  };
}

/**
 * Tables actually used by the frame components (or all defined ones if there is no frame).
 * @param {import('./parser.js').JpegStructure} jpeg
 */
function collect(jpeg) {
  const used = jpeg.frame ? new Set(jpeg.frame.components.map((c) => c.tq)) : null;
  return jpeg.quantTables.filter(
    /** @returns {t is QuantTable} */ (t) => t !== undefined && (!used || used.has(t.id)),
  );
}

/**
 * @param {number} q
 * @param {boolean} luma
 */
function reference(q, luma) {
  const entry = /** @type {{ luma: Uint16Array, chroma: Uint16Array }} */ (SCALED[q]);
  return luma ? entry.luma : entry.chroma;
}

/**
 * @param {Uint16Array} a
 * @param {Uint16Array} b
 */
function meanError(a, b) {
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += Math.abs(a[i] - b[i]);
  return sum / 64;
}
