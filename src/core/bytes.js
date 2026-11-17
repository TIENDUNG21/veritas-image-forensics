import { ParseError } from './errors.js';

/**
 * Sequential reader over a byte array with bounds checks on every read.
 * Reads past the end throw `ParseError('truncated')` with the offending offset,
 * which is how truncated files surface as clear messages instead of garbage values.
 */
export class ByteReader {
  /**
   * @param {Uint8Array} bytes
   * @param {number} [start] First readable offset (absolute).
   * @param {number} [length] Number of readable bytes from `start`.
   */
  constructor(bytes, start = 0, length = bytes.length - start) {
    this.data = bytes;
    this.start = start;
    this.end = Math.min(bytes.length, start + length);
    this.pos = start;
  }

  /** Bytes left before the end of the window. */
  get remaining() {
    return this.end - this.pos;
  }

  /** @param {number} n */
  require(n) {
    if (n < 0 || this.pos + n > this.end) {
      throw new ParseError(
        'truncated',
        `needed ${n} byte(s) but only ${Math.max(0, this.end - this.pos)} remain`,
        this.pos,
      );
    }
  }

  u8() {
    this.require(1);
    return /** @type {number} */ (this.data[this.pos++]);
  }

  u16be() {
    this.require(2);
    const d = this.data;
    const p = this.pos;
    this.pos += 2;
    return ((d[p] ?? 0) << 8) | (d[p + 1] ?? 0);
  }

  u16le() {
    this.require(2);
    const d = this.data;
    const p = this.pos;
    this.pos += 2;
    return (d[p] ?? 0) | ((d[p + 1] ?? 0) << 8);
  }

  u32be() {
    this.require(4);
    const d = this.data;
    const p = this.pos;
    this.pos += 4;
    return (
      (((d[p] ?? 0) << 24) >>> 0) +
      (((d[p + 1] ?? 0) << 16) | ((d[p + 2] ?? 0) << 8) | (d[p + 3] ?? 0))
    );
  }

  u32le() {
    this.require(4);
    const d = this.data;
    const p = this.pos;
    this.pos += 4;
    return (
      (((d[p + 3] ?? 0) << 24) >>> 0) +
      (((d[p + 2] ?? 0) << 16) | ((d[p + 1] ?? 0) << 8) | (d[p] ?? 0))
    );
  }

  /**
   * Returns a view (no copy) of the next `n` bytes.
   * @param {number} n
   */
  bytes(n) {
    this.require(n);
    const view = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return view;
  }

  /** @param {number} n */
  skip(n) {
    this.require(n);
    this.pos += n;
  }

  /** @param {number} offset Absolute offset inside the window. */
  seek(offset) {
    if (offset < this.start || offset > this.end) {
      throw new ParseError('truncated', `cannot seek outside the data`, offset);
    }
    this.pos = offset;
  }
}

/**
 * Reads an ASCII string, stopping at the first NUL byte.
 * @param {Uint8Array} bytes
 * @param {number} [start]
 * @param {number} [end]
 */
export function asciiString(bytes, start = 0, end = bytes.length) {
  let out = '';
  for (let i = start; i < end; i++) {
    const c = bytes[i] ?? 0;
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

/**
 * Checks whether `bytes` contains the ASCII `text` at `offset`.
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {string} text
 */
export function hasAscii(bytes, offset, text) {
  if (offset < 0 || offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}
