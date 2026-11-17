/**
 * Page-side handle on the analysis worker. One worker runs one analysis; starting a new one
 * terminates the old worker, which is also how cancellation works (a running analysis cannot
 * be interrupted any other way without slowing the hot loops down).
 *
 * @typedef {import('../pipeline/protocol.js').WorkerRequest} WorkerRequest
 * @typedef {import('../pipeline/protocol.js').WorkerResponse} WorkerResponse
 * @typedef {import('../pipeline/analyze.js').AnalysisResult} AnalysisResult
 * @typedef {import('../pipeline/analyze.js').Progress} Progress
 * @typedef {import('../analysis/ela.js').ElaResult} ElaResult
 * @typedef {import('../core/raster.js').Raster} Raster
 * @typedef {{
 *   postMessage(message: WorkerRequest, transfer?: ArrayBuffer[]): void,
 *   terminate(): void,
 *   onmessage: ((event: { data: WorkerResponse }) => void) | null,
 *   onerror: ((event: { message?: string }) => void) | null
 * }} WorkerLike
 */

export class AnalysisError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class AnalysisClient {
  /**
   * @param {() => WorkerLike} createWorker
   * @param {{ timeoutMs?: number }} [options]
   */
  constructor(createWorker, options = {}) {
    this.createWorker = createWorker;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    /** @type {WorkerLike | null} */
    this.worker = null;
    /** @type {((error: AnalysisError) => void) | null} */
    this.rejectCurrent = null;
    this.nextId = 1;
  }

  /**
   * Analyses a file in a fresh worker. The bytes are transferred, not copied.
   * @param {string} name
   * @param {ArrayBuffer} bytes
   * @param {(p: Progress) => void} [onProgress]
   * @returns {Promise<AnalysisResult>}
   */
  analyze(name, bytes, onProgress) {
    this.cancel();
    this.worker = this.createWorker();
    return /** @type {Promise<AnalysisResult>} */ (
      this.run({ type: 'analyze', id: this.nextId++, name, bytes }, [bytes], onProgress)
    );
  }

  /**
   * Re-runs ELA at another quality on the current worker (a copy of the raster is sent).
   * @param {Raster} raster
   * @param {number} quality
   * @returns {Promise<ElaResult>}
   */
  rerunEla(raster, quality) {
    if (!this.worker) this.worker = this.createWorker();
    return /** @type {Promise<ElaResult>} */ (
      this.run({ type: 'ela', id: this.nextId++, raster, quality }, [])
    );
  }

  /** Stops the running analysis, if any; its promise rejects with code `cancelled`. */
  cancel() {
    this.rejectCurrent?.(new AnalysisError('cancelled', 'The analysis was cancelled.'));
    this.rejectCurrent = null;
    this.worker?.terminate();
    this.worker = null;
  }

  /**
   * @param {WorkerRequest} request
   * @param {ArrayBuffer[]} transfer
   * @param {(p: Progress) => void} [onProgress]
   * @returns {Promise<AnalysisResult | ElaResult>}
   */
  run(request, transfer, onProgress) {
    const worker = /** @type {WorkerLike} */ (this.worker);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectCurrent = null;
        this.worker?.terminate();
        this.worker = null;
        reject(new AnalysisError('timeout', 'The analysis took too long and was stopped.'));
      }, this.timeoutMs);
      const settle = () => {
        clearTimeout(timer);
        this.rejectCurrent = null;
      };
      this.rejectCurrent = (error) => {
        settle();
        reject(error);
      };
      worker.onmessage = ({ data }) => {
        if (data.id !== request.id) return;
        if (data.type === 'progress') {
          onProgress?.(data.progress);
        } else if (data.type === 'result') {
          settle();
          resolve(data.result);
        } else if (data.type === 'ela-result') {
          settle();
          resolve(data.ela);
        } else {
          settle();
          reject(new AnalysisError(data.error.code, data.error.message));
        }
      };
      worker.onerror = (event) => {
        settle();
        this.worker?.terminate();
        this.worker = null;
        reject(
          new AnalysisError(
            'worker',
            `The analysis worker failed: ${event.message ?? 'unknown error'}`,
          ),
        );
      };
      worker.postMessage(request, transfer);
    });
  }
}
