import { errorLevel } from '../analysis/ela.js';
import { analyzeImage } from '../pipeline/analyze.js';
import { collectTransferables, toErrorPayload } from '../pipeline/protocol.js';

/**
 * Analysis worker: runs the pure pipeline off the main thread. The only browser-specific
 * part is the fallback decoder for formats Veritas does not decode itself.
 * @typedef {import('../pipeline/protocol.js').WorkerRequest} WorkerRequest
 * @typedef {import('../pipeline/protocol.js').WorkerResponse} WorkerResponse
 * @typedef {import('../core/raster.js').Raster} Raster
 */

/**
 * Decodes PNG, WebP, GIF, BMP, AVIF and progressive JPEG with the browser, shrinking very
 * large images while decoding so memory stays bounded.
 * @param {Uint8Array} bytes
 * @param {string} mime
 * @param {number} maxSide
 * @returns {Promise<Raster>}
 */
async function browserDecode(bytes, mime, maxSide) {
  const blob = new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (bytes)], { type: mime });
  let bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  if (bitmap.width > maxSide || bitmap.height > maxSide) {
    const s = maxSide / Math.max(bitmap.width, bitmap.height);
    const resizeWidth = Math.max(1, Math.round(bitmap.width * s));
    const resizeHeight = Math.max(1, Math.round(bitmap.height * s));
    bitmap.close();
    bitmap = await createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality: 'high' });
  }
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available in this browser');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

/** @param {WorkerResponse} message */
function reply(message) {
  postMessage(message, collectTransferables(message));
}

onmessage = async (/** @type {MessageEvent<WorkerRequest>} */ event) => {
  const request = event.data;
  try {
    if (request.type === 'analyze') {
      const result = await analyzeImage(new Uint8Array(request.bytes), {
        name: request.name,
        decodeFallback: browserDecode,
        onProgress: (progress) => reply({ type: 'progress', id: request.id, progress }),
        ...(request.elaQuality === undefined ? {} : { elaQuality: request.elaQuality }),
      });
      reply({ type: 'result', id: request.id, result });
    } else {
      reply({
        type: 'ela-result',
        id: request.id,
        ela: errorLevel(request.raster, { quality: request.quality }),
      });
    }
  } catch (error) {
    reply({ type: 'error', id: request.id, error: toErrorPayload(error) });
  }
};
