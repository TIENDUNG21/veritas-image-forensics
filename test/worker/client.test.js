import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisClient, AnalysisError } from '../../src/worker/client.js';
import { collectTransferables, toErrorPayload } from '../../src/pipeline/protocol.js';
import { ParseError } from '../../src/core/errors.js';

/** @typedef {import('../../src/worker/client.js').WorkerLike} WorkerLike */
/** @typedef {import('../../src/pipeline/protocol.js').WorkerRequest} WorkerRequest */
/** @typedef {import('../../src/pipeline/protocol.js').WorkerResponse} WorkerResponse */

class FakeWorker {
  constructor() {
    /** @type {WorkerRequest[]} */
    this.posted = [];
    /** @type {ArrayBuffer[][]} */
    this.transfers = [];
    this.terminated = false;
    /** @type {WorkerLike['onmessage']} */
    this.onmessage = null;
    /** @type {WorkerLike['onerror']} */
    this.onerror = null;
  }
  /** @param {WorkerRequest} message @param {ArrayBuffer[]} [transfer] */
  postMessage(message, transfer = []) {
    this.posted.push(message);
    this.transfers.push(transfer);
  }
  terminate() {
    this.terminated = true;
  }
  /** @param {WorkerResponse} data */
  emit(data) {
    this.onmessage?.({ data });
  }
}

/** @type {FakeWorker[]} */
let workers = [];
const factory = () => {
  const w = new FakeWorker();
  workers.push(w);
  return w;
};

afterEach(() => {
  workers = [];
  vi.useRealTimers();
});

describe('AnalysisClient', () => {
  it('transfers the bytes, forwards progress and resolves with the result', async () => {
    const client = new AnalysisClient(factory);
    const bytes = new ArrayBuffer(8);
    /** @type {string[]} */
    const stages = [];
    const promise = client.analyze('a.jpg', bytes, (p) => stages.push(p.stage));
    const worker = workers[0];
    const request = worker?.posted[0];
    expect(request?.type).toBe('analyze');
    expect(worker?.transfers[0]).toEqual([bytes]);
    const id = request?.id ?? 0;
    worker?.emit({
      type: 'progress',
      id,
      progress: { stage: 'Decoding pixels', index: 1, total: 8 },
    });
    worker?.emit({ type: 'result', id, result: /** @type {any} */ ({ ok: true }) });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(stages).toEqual(['Decoding pixels']);
  });

  it('rejects with the worker error code and message', async () => {
    const client = new AnalysisClient(factory);
    const promise = client.analyze('x', new ArrayBuffer(1));
    const id = workers[0]?.posted[0]?.id ?? 0;
    workers[0]?.emit({ type: 'error', id, error: { code: 'too-large', message: 'too big' } });
    await expect(promise).rejects.toMatchObject({ code: 'too-large', message: 'too big' });
  });

  it('cancels the previous analysis when a new one starts', async () => {
    const client = new AnalysisClient(factory);
    const first = client.analyze('1', new ArrayBuffer(1));
    client.analyze('2', new ArrayBuffer(1));
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });

  it('stops a run that exceeds the time limit', async () => {
    vi.useFakeTimers();
    const client = new AnalysisClient(factory, { timeoutMs: 1000 });
    const promise = client.analyze('slow', new ArrayBuffer(1));
    vi.advanceTimersByTime(1001);
    await expect(promise).rejects.toBeInstanceOf(AnalysisError);
    await expect(promise).rejects.toMatchObject({ code: 'timeout' });
    expect(workers[0]?.terminated).toBe(true);
  });

  it('reports a crashed worker', async () => {
    const client = new AnalysisClient(factory);
    const promise = client.analyze('x', new ArrayBuffer(1));
    workers[0]?.onerror?.({ message: 'out of memory' });
    await expect(promise).rejects.toMatchObject({ code: 'worker' });
  });
});

describe('protocol helpers', () => {
  it('collects each ArrayBuffer once, however deeply nested', () => {
    const shared = new Float32Array(4);
    const value = {
      a: shared,
      b: [new Uint8Array(2), { c: new Int16Array(shared.buffer) }],
      d: 'text',
      e: null,
    };
    const buffers = collectTransferables(value);
    expect(buffers).toHaveLength(2);
    expect(buffers).toContain(shared.buffer);
  });

  it('keeps ParseError codes and hides nothing else', () => {
    expect(toErrorPayload(new ParseError('truncated', 'cut', 4))).toEqual({
      code: 'truncated',
      message: 'cut (at offset 4)',
    });
    expect(toErrorPayload(new RangeError('boom')).code).toBe('internal');
    expect(toErrorPayload('weird').message).toMatch(/weird/);
  });
});
