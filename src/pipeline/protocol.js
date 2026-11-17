import { isParseError } from '../core/errors.js';

/**
 * Messages between the page and the analysis worker.
 *
 * @typedef {{ type: 'analyze', id: number, name: string, bytes: ArrayBuffer, elaQuality?: number }} AnalyzeRequest
 * @typedef {{ type: 'ela', id: number, raster: import('../core/raster.js').Raster, quality: number }} ElaRequest
 * @typedef {AnalyzeRequest | ElaRequest} WorkerRequest
 * @typedef {{ code: string, message: string }} ErrorPayload
 * @typedef {{ type: 'progress', id: number, progress: import('./analyze.js').Progress }
 *   | { type: 'result', id: number, result: import('./analyze.js').AnalysisResult }
 *   | { type: 'ela-result', id: number, ela: import('../analysis/ela.js').ElaResult }
 *   | { type: 'error', id: number, error: ErrorPayload }} WorkerResponse
 */

/**
 * Every distinct ArrayBuffer reachable from `value`, so a result can be transferred to the
 * page without copying its (large) typed arrays.
 * @param {unknown} value
 * @returns {ArrayBuffer[]}
 */
export function collectTransferables(value) {
  /** @type {Set<ArrayBuffer>} */
  const buffers = new Set();
  const seen = new Set();
  /** @param {unknown} v */
  const walk = (v) => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      if (v.buffer instanceof ArrayBuffer) buffers.add(v.buffer);
      return;
    }
    if (v instanceof ArrayBuffer) {
      buffers.add(v);
      return;
    }
    for (const child of Array.isArray(v) ? v : Object.values(v)) walk(child);
  };
  walk(value);
  return [...buffers];
}

/**
 * Turns anything thrown into a message the page can show.
 * @param {unknown} error
 * @returns {ErrorPayload}
 */
export function toErrorPayload(error) {
  if (isParseError(error)) return { code: error.code, message: error.message };
  if (error instanceof Error)
    return { code: 'internal', message: `Unexpected error: ${error.message}` };
  return { code: 'internal', message: `Unexpected error: ${String(error)}` };
}
