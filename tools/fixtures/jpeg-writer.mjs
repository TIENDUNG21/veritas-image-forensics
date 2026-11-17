// A small baseline JPEG encoder used to build test fixtures and the sample images.
// It covers what jpeg-js cannot produce: chroma subsampling, restart markers,
// grayscale files, custom quantization tables and extra APPn segments.
import { fdct8x8 } from '../../src/jpeg/dct.js';
import { CHROMA_BASE, LUMA_BASE, ZIGZAG, scaleTable } from '../../src/jpeg/tables.js';

/** @typedef {import('../../src/core/raster.js').Raster} Raster */

/** Annex K.3 typical Huffman tables: [counts for lengths 1..16, symbols]. */
const DC_LUMA = [
  [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
];
const DC_CHROMA = [
  [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
];
const AC_LUMA = [
  [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
];
const AC_CHROMA = [
  [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
];

/**
 * Canonical Huffman codes from counts/symbols (T.81 Annex C).
 * @param {number[][]} spec
 * @returns {{ code: Uint16Array, size: Uint8Array }} indexed by symbol
 */
function codesFor(spec) {
  const [counts = [], symbols = []] = spec;
  const code = new Uint16Array(256);
  const size = new Uint8Array(256);
  let next = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < (counts[len - 1] ?? 0); i++) {
      const s = symbols[k++] ?? 0;
      code[s] = next++;
      size[s] = len;
    }
    next <<= 1;
  }
  return { code, size };
}

class BitWriter {
  constructor() {
    /** @type {number[]} */
    this.out = [];
    this.acc = 0;
    this.n = 0;
  }
  /** @param {number} value @param {number} bits */
  write(value, bits) {
    for (let i = bits - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((value >> i) & 1);
      this.n++;
      if (this.n === 8) this.flushByte();
    }
  }
  flushByte() {
    this.out.push(this.acc);
    if (this.acc === 0xff) this.out.push(0x00);
    this.acc = 0;
    this.n = 0;
  }
  /** Pads the last byte with 1-bits, as T.81 requires before a marker. */
  align() {
    while (this.n !== 0) this.write(1, 1);
  }
}

/**
 * @typedef {{
 *   quality?: number,
 *   tables?: { luma: Uint16Array, chroma: Uint16Array },
 *   sampling?: '444' | '422' | '420',
 *   grayscale?: boolean,
 *   restartInterval?: number,
 *   segments?: Uint8Array[],
 * }} WriterOptions
 */

/**
 * Encodes a raster as a baseline JPEG.
 * @param {Raster} raster
 * @param {WriterOptions} [options]
 * @returns {Uint8Array}
 */
export function encodeJpeg(raster, options = {}) {
  const {
    quality = 90,
    sampling = '420',
    grayscale = false,
    restartInterval = 0,
    segments = [],
  } = options;
  const luma = options.tables?.luma ?? scaleTable(LUMA_BASE, quality);
  const chroma = options.tables?.chroma ?? scaleTable(CHROMA_BASE, quality);
  const { width, height, data } = raster;
  const hs = grayscale ? 1 : sampling === '444' ? 1 : 2;
  const vs = grayscale ? 1 : sampling === '420' ? 2 : 1;

  // Colour conversion (JFIF), full resolution planes.
  const n = width * height;
  const Y = new Float32Array(n);
  const Cb = new Float32Array(n);
  const Cr = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
    Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
  }

  const mcuW = 8 * hs;
  const mcuH = 8 * vs;
  const mcusX = Math.ceil(width / mcuW);
  const mcusY = Math.ceil(height / mcuH);

  /** Sample of a plane at (x, y) with edge replication. */
  const at = (
    /** @type {Float32Array} */ plane,
    /** @type {number} */ x,
    /** @type {number} */ y,
  ) => plane[Math.min(height - 1, y) * width + Math.min(width - 1, x)];

  const bytes = [0xff, 0xd8];
  const push = (/** @type {ArrayLike<number>} */ arr) => {
    for (let i = 0; i < arr.length; i++) bytes.push(arr[i]);
  };
  const seg = (/** @type {number} */ marker, /** @type {number[]} */ payload) => {
    const len = payload.length + 2;
    push([0xff, marker, len >> 8, len & 0xff]);
    push(payload);
  };
  for (const s of segments) push(s);

  // DQT
  const dqt = [0x00];
  for (let k = 0; k < 64; k++) dqt.push(luma[ZIGZAG[k]]);
  if (!grayscale) {
    dqt.push(0x01);
    for (let k = 0; k < 64; k++) dqt.push(chroma[ZIGZAG[k]]);
  }
  seg(0xdb, dqt);

  // SOF0
  const comps = grayscale ? 1 : 3;
  const sof = [8, height >> 8, height & 0xff, width >> 8, width & 0xff, comps];
  sof.push(1, (hs << 4) | vs, 0);
  if (!grayscale) sof.push(2, 0x11, 1, 3, 0x11, 1);
  seg(0xc0, sof);

  // DHT
  /** @param {number} tcth @param {number[][]} spec */
  const dht = (tcth, spec) => [tcth, ...(spec[0] ?? []), ...(spec[1] ?? [])];
  const dhtPayload = [...dht(0x00, DC_LUMA), ...dht(0x10, AC_LUMA)];
  if (!grayscale) dhtPayload.push(...dht(0x01, DC_CHROMA), ...dht(0x11, AC_CHROMA));
  seg(0xc4, dhtPayload);

  if (restartInterval > 0) seg(0xdd, [restartInterval >> 8, restartInterval & 0xff]);

  // SOS
  const sos = [comps, 1, 0x00];
  if (!grayscale) sos.push(2, 0x11, 3, 0x11);
  sos.push(0, 63, 0);
  seg(0xda, sos);

  const huff = {
    dcL: codesFor(DC_LUMA),
    acL: codesFor(AC_LUMA),
    dcC: codesFor(DC_CHROMA),
    acC: codesFor(AC_CHROMA),
  };
  const bw = new BitWriter();
  const block = new Float32Array(64);
  const coef = new Float32Array(64);
  const pred = [0, 0, 0];

  /**
   * @param {(x: number, y: number) => number} sample
   * @param {Uint16Array} qt
   * @param {number} ci
   */
  const encodeBlock = (sample, qt, ci) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y * 8 + x] = sample(x, y) - 128;
    fdct8x8(block, coef);
    const q = new Int32Array(64);
    for (let k = 0; k < 64; k++) q[k] = Math.round(coef[ZIGZAG[k]] / qt[ZIGZAG[k]]);
    const dcT = ci === 0 ? huff.dcL : huff.dcC;
    const acT = ci === 0 ? huff.acL : huff.acC;
    const diff = q[0] - pred[ci];
    pred[ci] = q[0];
    writeValue(bw, dcT, 0, diff);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      if (q[k] === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        bw.write(acT.code[0xf0], acT.size[0xf0]);
        run -= 16;
      }
      writeValue(bw, acT, run, q[k]);
      run = 0;
    }
    if (run > 0) bw.write(acT.code[0], acT.size[0]);
  };

  let mcuIndex = 0;
  let rst = 0;
  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      if (restartInterval > 0 && mcuIndex > 0 && mcuIndex % restartInterval === 0) {
        bw.align();
        bw.out.push(0xff, 0xd0 + (rst++ % 8));
        pred[0] = pred[1] = pred[2] = 0;
      }
      for (let by = 0; by < vs; by++) {
        for (let bx = 0; bx < hs; bx++) {
          const ox = mx * mcuW + bx * 8;
          const oy = my * mcuH + by * 8;
          encodeBlock((x, y) => at(Y, ox + x, oy + y), luma, 0);
        }
      }
      if (!grayscale) {
        for (const [plane, ci] of /** @type {[Float32Array, number][]} */ ([
          [Cb, 1],
          [Cr, 2],
        ])) {
          encodeBlock(
            (x, y) => {
              let sum = 0;
              for (let dy = 0; dy < vs; dy++) {
                for (let dx = 0; dx < hs; dx++) {
                  sum += at(plane, mx * mcuW + x * hs + dx, my * mcuH + y * vs + dy);
                }
              }
              return sum / (hs * vs);
            },
            chroma,
            ci,
          );
        }
      }
      mcuIndex++;
    }
  }
  bw.align();
  push(bw.out);
  bytes.push(0xff, 0xd9);
  return Uint8Array.from(bytes);
}

/**
 * Writes a (run, value) pair: Huffman code of (run << 4 | size), then `size` extra bits.
 * @param {BitWriter} bw
 * @param {{ code: Uint16Array, size: Uint8Array }} table
 * @param {number} run
 * @param {number} value
 */
function writeValue(bw, table, run, value) {
  const magnitude = Math.abs(value);
  let size = 0;
  while (magnitude >= 1 << size) size++;
  const symbol = (run << 4) | size;
  bw.write(table.code[symbol], table.size[symbol]);
  if (size > 0) bw.write(value < 0 ? value + (1 << size) - 1 : value, size);
}
