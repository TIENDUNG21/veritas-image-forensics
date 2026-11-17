import { ParseError } from '../core/errors.js';
import { isRst } from './markers.js';

/** Bits resolved by the fast lookup table; longer codes use the canonical slow path. */
const LOOKAHEAD = 9;

/**
 * @typedef {{
 *   lookup: Uint16Array, maxcode: Int32Array, mincode: Int32Array, valptr: Int32Array,
 *   symbols: Uint8Array
 * }} HuffmanTable
 */

/**
 * Builds canonical Huffman decoding tables (T.81 Annex C and F.2.2.3) plus a 9-bit lookahead
 * table: `lookup[bits]` is `(length << 8) | symbol`, or 0 if the code is longer than 9 bits.
 * @param {import('./parser.js').HuffmanSpec} spec
 * @returns {HuffmanTable}
 */
export function buildHuffmanTable(spec) {
  const lookup = new Uint16Array(1 << LOOKAHEAD);
  const maxcode = new Int32Array(18).fill(-1);
  const mincode = new Int32Array(17);
  const valptr = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    const count = spec.counts[len - 1];
    valptr[len] = k;
    mincode[len] = code;
    for (let i = 0; i < count; i++) {
      if (code >= 1 << len) {
        throw new ParseError('bad-dht', 'Huffman code lengths are over-subscribed', spec.offset);
      }
      if (len <= LOOKAHEAD) {
        const shift = LOOKAHEAD - len;
        const entry = (len << 8) | spec.symbols[k];
        const base = code << shift;
        for (let j = 0; j < 1 << shift; j++) lookup[base + j] = entry;
      }
      code++;
      k++;
    }
    maxcode[len] = count > 0 ? code - 1 : -1;
    code <<= 1;
  }
  return { lookup, maxcode, mincode, valptr, symbols: spec.symbols };
}

/**
 * Reads bits from entropy-coded data, removing 0xFF00 byte stuffing. When it reaches a marker
 * or the end of the data it feeds zero bits (as libjpeg does) and counts them, so the decoder
 * can tell a clean end from data that ran out in the middle of a block.
 */
export class BitReader {
  /**
   * @param {Uint8Array} bytes
   * @param {number} start
   * @param {number} end
   */
  constructor(bytes, start, end) {
    this.bytes = bytes;
    this.pos = start;
    this.end = end;
    this.buf = 0;
    this.count = 0;
    /** Zero bits fed after the data stopped (marker or end). */
    this.fake = 0;
    /** Marker byte that stopped reading, 0x100 for end of data, -1 while reading data. */
    this.marker = -1;
  }

  fill() {
    while (this.count <= 16) {
      let byte = 0;
      if (this.marker < 0) {
        if (this.pos >= this.end) {
          this.marker = 0x100;
        } else {
          byte = this.bytes[this.pos];
          if (byte !== 0xff) {
            this.pos++;
          } else {
            const next = this.pos + 1 < this.end ? this.bytes[this.pos + 1] : 0x100;
            if (next === 0x00) {
              this.pos += 2;
            } else {
              this.marker = next;
              byte = 0;
            }
          }
        }
      }
      if (this.marker >= 0) this.fake += 8;
      this.buf = ((this.buf << 8) | byte) & 0xffffff;
      this.count += 8;
    }
  }

  /** Number of fed zero bits that have actually been consumed (data ran out). */
  consumedPastEnd() {
    return Math.max(0, this.fake - this.count);
  }

  /** @param {number} n 1..16 */
  bits(n) {
    this.fill();
    this.count -= n;
    return (this.buf >>> this.count) & ((1 << n) - 1);
  }

  /**
   * Reads `size` extra bits and sign-extends them (T.81 F.2.2.1 EXTEND).
   * @param {number} size 1..15
   */
  receiveExtend(size) {
    const v = this.bits(size);
    return v < 1 << (size - 1) ? v - (1 << size) + 1 : v;
  }

  /** @param {HuffmanTable} table */
  decode(table) {
    this.fill();
    const entry = table.lookup[(this.buf >>> (this.count - LOOKAHEAD)) & ((1 << LOOKAHEAD) - 1)];
    if (entry !== 0) {
      this.count -= entry >> 8;
      return entry & 0xff;
    }
    const code16 = (this.buf >>> (this.count - 16)) & 0xffff;
    for (let len = LOOKAHEAD + 1; len <= 16; len++) {
      const code = code16 >>> (16 - len);
      if (code <= table.maxcode[len]) {
        this.count -= len;
        return table.symbols[table.valptr[len] + code - table.mincode[len]];
      }
    }
    throw new ParseError('bad-huffman', 'invalid Huffman code in entropy-coded data', this.pos);
  }

  /**
   * Handles a restart boundary: drops buffered bits, then consumes the next RSTn marker,
   * searching forward if the data is damaged.
   * @param {number} expected Expected marker number 0..7.
   * @returns {'ok' | 'mismatch' | 'resynced' | 'missing'}
   */
  restart(expected) {
    this.buf = 0;
    this.count = 0;
    this.fake = 0;
    this.marker = -1;
    const b = this.bytes;
    let p = this.pos;
    while (p + 1 < this.end && b[p] === 0xff && b[p + 1] === 0xff) p++;
    if (p + 1 < this.end && b[p] === 0xff && isRst(b[p + 1])) {
      this.pos = p + 2;
      return b[p + 1] - 0xd0 === expected ? 'ok' : 'mismatch';
    }
    for (let i = p; i + 1 < this.end; i++) {
      if (b[i] === 0xff && isRst(b[i + 1])) {
        this.pos = i + 2;
        return 'resynced';
      }
    }
    this.pos = this.end;
    return 'missing';
  }
}
