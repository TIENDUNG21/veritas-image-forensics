import { ParseError } from '../core/errors.js';
import { MAX_DECODE_PIXELS } from '../core/limits.js';
import { BitReader, buildHuffmanTable } from './huffman.js';
import { ZIGZAG } from './tables.js';

/**
 * Quantized DCT coefficients of one component. Block (bx, by) starts at
 * `(by * stride + bx) * 64`; coefficients are in natural order and NOT multiplied by the
 * quantization step (multiply by `quant[i]` to dequantize).
 * @typedef {{
 *   id: number, h: number, v: number, tq: number,
 *   blocksW: number, blocksH: number, stride: number, rows: number,
 *   coeffs: Int16Array, quant: Uint16Array | null
 * }} CoefficientPlane
 * @typedef {{
 *   width: number, height: number, hmax: number, vmax: number, mcusX: number, mcusY: number,
 *   components: CoefficientPlane[], mcusDecoded: number, mcusTotal: number,
 *   truncated: boolean, warnings: string[]
 * }} CoefficientData
 */

/**
 * Decodes the Huffman-coded data of a sequential (baseline or extended) 8-bit JPEG into
 * quantized DCT coefficients. Damaged data never throws: decoding stops (or skips to the next
 * restart marker) and the result says how many MCUs were recovered.
 *
 * @param {import('./parser.js').JpegStructure} jpeg
 * @param {{ maxPixels?: number, componentIds?: number[] }} [options]
 *   `componentIds` limits which planes are stored (others are decoded and discarded).
 * @returns {CoefficientData}
 */
export function decodeCoefficients(jpeg, { maxPixels = MAX_DECODE_PIXELS, componentIds } = {}) {
  const frame = jpeg.frame;
  if (!frame) throw new ParseError('bad-frame', 'no frame header (SOF) found');
  if (frame.progressive) {
    throw new ParseError(
      'unsupported',
      'progressive JPEG: DCT coefficient analysis supports sequential (baseline) files only',
      frame.offset,
    );
  }
  if (frame.lossless || frame.arithmetic) {
    throw new ParseError('unsupported', `${frame.type} coding is not supported`, frame.offset);
  }
  if (frame.precision !== 8) {
    throw new ParseError('unsupported', `${frame.precision}-bit samples are not supported`);
  }
  const pixels = frame.width * frame.height;
  if (pixels > maxPixels) {
    throw new ParseError(
      'too-large',
      `${frame.width} x ${frame.height} (${(pixels / 1e6).toFixed(1)} MP) exceeds the ${(maxPixels / 1e6).toFixed(0)} MP limit`,
      frame.offset,
    );
  }
  if (jpeg.scans.length === 0) throw new ParseError('no-scan', 'no image data (SOS) found');

  const hmax = Math.max(...frame.components.map((c) => c.h));
  const vmax = Math.max(...frame.components.map((c) => c.v));
  const mcusX = Math.ceil(frame.width / (8 * hmax));
  const mcusY = Math.ceil(frame.height / (8 * vmax));

  /** @type {CoefficientPlane[]} */
  const planes = frame.components.map((c) => {
    const stride = mcusX * c.h;
    const rows = mcusY * c.v;
    const store = !componentIds || componentIds.includes(c.id);
    return {
      id: c.id,
      h: c.h,
      v: c.v,
      tq: c.tq,
      blocksW: Math.ceil(Math.ceil((frame.width * c.h) / hmax) / 8),
      blocksH: Math.ceil(Math.ceil((frame.height * c.v) / vmax) / 8),
      stride,
      rows,
      coeffs: new Int16Array(store ? stride * rows * 64 : 0),
      quant: jpeg.quantTables[c.tq]?.values ?? null,
    };
  });

  /** @type {CoefficientData} */
  const result = {
    width: frame.width,
    height: frame.height,
    hmax,
    vmax,
    mcusX,
    mcusY,
    components: planes,
    mcusDecoded: 0,
    mcusTotal: 0,
    truncated: false,
    warnings: [],
  };
  const covered = new Set();
  for (const scan of jpeg.scans) {
    decodeScan(jpeg.bytes, scan, planes, result);
    for (const c of scan.components) covered.add(c.id);
  }
  for (const p of planes) {
    if (!covered.has(p.id)) result.warnings.push(`component ${p.id} is not present in any scan`);
    if (!p.quant) result.warnings.push(`component ${p.id} uses an undefined quantization table`);
  }
  return result;
}

/**
 * @param {Uint8Array} bytes
 * @param {import('./parser.js').Scan} scan
 * @param {CoefficientPlane[]} planes
 * @param {CoefficientData} result
 */
function decodeScan(bytes, scan, planes, result) {
  const comps = scan.components.map((sc) => {
    const plane = planes.find((p) => p.id === sc.id);
    const dcSpec = scan.dcTables[sc.td];
    const acSpec = scan.acTables[sc.ta];
    if (!plane || !dcSpec || !acSpec) {
      throw new ParseError('bad-scan', `scan uses an undefined Huffman table`, scan.offset);
    }
    return { plane, dc: buildHuffmanTable(dcSpec), ac: buildHuffmanTable(acSpec), pred: 0 };
  });
  const single = comps.length === 1;
  const first = comps[0].plane;
  const total = single ? first.blocksW * first.blocksH : result.mcusX * result.mcusY;
  result.mcusTotal += total;

  const reader = new BitReader(bytes, scan.dataOffset, scan.dataEnd);
  const ri = scan.restartInterval;
  const scratch = new Int16Array(64);
  let damaged = 0;

  /**
   * @param {(typeof comps)[number]} c
   * @param {number} bx
   * @param {number} by
   */
  const decodeBlock = (c, bx, by) => {
    const stored = c.plane.coeffs.length > 0;
    const out = stored ? c.plane.coeffs : scratch;
    const base = stored ? (by * c.plane.stride + bx) * 64 : 0;
    if (!stored) scratch.fill(0);
    const t = reader.decode(c.dc);
    if (t > 11) throw new ParseError('bad-coefficients', 'DC category above 11', reader.pos);
    c.pred += t === 0 ? 0 : reader.receiveExtend(t);
    out[base] = c.pred;
    let k = 1;
    while (k < 64) {
      const rs = reader.decode(c.ac);
      const run = rs >> 4;
      const size = rs & 15;
      if (size === 0) {
        if (run !== 15) break;
        k += 16;
        continue;
      }
      k += run;
      if (k > 63) throw new ParseError('bad-coefficients', 'AC index past 63', reader.pos);
      out[base + ZIGZAG[k]] = reader.receiveExtend(size);
      k++;
    }
  };

  /** @param {number} mcu */
  const decodeMcu = (mcu) => {
    if (single) {
      const c = comps[0];
      decodeBlock(c, mcu % c.plane.blocksW, Math.floor(mcu / c.plane.blocksW));
      return;
    }
    const mx = mcu % result.mcusX;
    const my = Math.floor(mcu / result.mcusX);
    for (const c of comps) {
      for (let v = 0; v < c.plane.v; v++) {
        for (let h = 0; h < c.plane.h; h++) decodeBlock(c, mx * c.plane.h + h, my * c.plane.v + v);
      }
    }
  };

  let mcu = 0;
  while (mcu < total) {
    if (ri > 0 && mcu > 0 && mcu % ri === 0) {
      const status = reader.restart((mcu / ri - 1) % 8);
      if (status === 'missing') {
        result.truncated = true;
        result.warnings.push(`restart marker missing before MCU ${mcu}; the image is truncated`);
        break;
      }
      if (status !== 'ok') result.warnings.push(`restart marker out of sequence before MCU ${mcu}`);
      for (const c of comps) c.pred = 0;
    }
    let failed = false;
    try {
      decodeMcu(mcu);
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      failed = true;
    }
    const ranOut = reader.consumedPastEnd() > 0;
    const atRestart = reader.marker >= 0xd0 && reader.marker <= 0xd7;
    if (ri > 0 && (failed || (ranOut && atRestart))) {
      damaged++;
      mcu = (Math.floor(mcu / ri) + 1) * ri;
      continue;
    }
    if (failed) {
      result.warnings.push(`entropy-coded data is corrupt at MCU ${mcu}; decoding stopped`);
      result.truncated = true;
      break;
    }
    if (ranOut) {
      result.warnings.push(`image data is truncated: decoded ${mcu} of ${total} MCUs`);
      result.truncated = true;
      break;
    }
    result.mcusDecoded++;
    mcu++;
  }
  if (damaged > 0) {
    result.warnings.push(`${damaged} restart interval(s) were damaged and skipped`);
  }
}
