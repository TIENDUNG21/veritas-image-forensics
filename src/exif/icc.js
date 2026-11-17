import { ParseError } from '../core/errors.js';
import { asciiString, hasAscii } from '../core/bytes.js';

/**
 * @typedef {{
 *   size: number, version: string, deviceClass: string, colorSpace: string,
 *   creator: string, description: string | null
 * }} IccInfo
 */

const CLASSES = /** @type {Record<string, string>} */ ({
  scnr: 'Input',
  mntr: 'Display',
  prtr: 'Output',
  link: 'Device link',
  spac: 'Colour space',
  abst: 'Abstract',
  nmcl: 'Named colour',
});

/**
 * Reads the header and description of an ICC colour profile (v2 `desc` or v4 `mluc`).
 * The profile name often reveals the capture device or editing pipeline (for example
 * a phone's "Display P3" versus an editor's "sRGB IEC61966-2.1").
 * @param {Uint8Array} bytes
 * @returns {IccInfo}
 */
export function parseIcc(bytes) {
  if (bytes.length < 132 || !hasAscii(bytes, 36, 'acsp')) {
    throw new ParseError('bad-icc', 'not an ICC profile (missing acsp signature)');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = bytes[8];
  const minor = bytes[9] >> 4;
  const cls = asciiString(bytes, 12, 16);
  const info = {
    size: view.getUint32(0),
    version: `${major}.${minor}`,
    deviceClass: CLASSES[cls] ?? cls,
    colorSpace: asciiString(bytes, 16, 20).trim(),
    creator: asciiString(bytes, 80, 84).trim(),
    description: /** @type {string | null} */ (null),
  };
  const count = Math.min(view.getUint32(128), 200);
  for (let i = 0; i < count; i++) {
    const p = 132 + i * 12;
    if (p + 12 > bytes.length) break;
    if (!hasAscii(bytes, p, 'desc')) continue;
    const offset = view.getUint32(p + 4);
    const size = view.getUint32(p + 8);
    if (offset + size > bytes.length || size < 12) break;
    info.description = readText(bytes, view, offset, size);
  }
  return info;
}

/**
 * @param {Uint8Array} bytes
 * @param {DataView} view
 * @param {number} offset
 * @param {number} size
 */
function readText(bytes, view, offset, size) {
  if (hasAscii(bytes, offset, 'desc')) {
    const n = view.getUint32(offset + 8);
    const end = Math.min(offset + 12 + n, offset + size);
    return asciiString(bytes, offset + 12, end);
  }
  if (hasAscii(bytes, offset, 'mluc') && size >= 28) {
    const length = view.getUint32(offset + 20);
    const start = offset + view.getUint32(offset + 24);
    if (start + length > offset + size) return null;
    let text = '';
    for (let i = 0; i + 1 < length; i += 2) text += String.fromCharCode(view.getUint16(start + i));
    return text.replace(/\0+$/, '');
  }
  return null;
}

/**
 * Reassembles a profile split across JPEG APP2 segments (`ICC_PROFILE\0`, sequence, count).
 * @param {Uint8Array[]} payloads APP2 payloads in file order.
 * @returns {Uint8Array}
 */
export function joinIccChunks(payloads) {
  const chunks = payloads
    .filter((p) => p.length > 14)
    .map((p) => ({ seq: p[12], body: p.subarray(14) }))
    .sort((a, b) => a.seq - b.seq);
  const total = chunks.reduce((n, c) => n + c.body.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c.body, at);
    at += c.body.length;
  }
  return out;
}
