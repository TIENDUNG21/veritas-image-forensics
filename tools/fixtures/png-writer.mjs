// Minimal PNG encoder (8-bit RGB, filter 0) for fixtures and samples; uses Node's zlib.
import { deflateSync } from 'node:zlib';
import { crc32 } from '../../src/core/crc32.js';

/** @typedef {import('../../src/core/raster.js').Raster} Raster */

/**
 * @param {string} type
 * @param {Uint8Array} data
 */
export function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** @param {string} text */
export function latin1(text) {
  return Uint8Array.from([...text].map((c) => c.charCodeAt(0) & 0xff));
}

/**
 * @param {Raster} raster
 * @param {{ chunks?: { type: string, data: Uint8Array }[] }} [options] Extra chunks placed before IDAT.
 * @returns {Uint8Array}
 */
export function encodePng(raster, { chunks = [] } = {}) {
  const { width, height, data } = raster;
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      rows.set([data[p], data[p + 1], data[p + 2]], row + 1 + x * 3);
    }
  }
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...chunks.map((c) => pngChunk(c.type, c.data)),
    pngChunk('IDAT', new Uint8Array(deflateSync(rows))),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
