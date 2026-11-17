import { ByteReader, hasAscii } from '../core/bytes.js';
import { ParseError } from '../core/errors.js';
import { ZIGZAG } from './tables.js';
import {
  COM,
  DAC,
  DHT,
  DNL,
  DQT,
  DRI,
  EOI,
  FRAME_TYPES,
  SOI,
  SOS,
  isApp,
  isRst,
  isStandalone,
  markerName,
} from './markers.js';

/**
 * @typedef {{ marker: number, name: string, offset: number, length: number }} Segment
 *   `offset` is the position of the 0xFF byte; `length` counts every byte of the segment.
 * @typedef {{ id: number, h: number, v: number, tq: number }} FrameComponent
 * @typedef {{
 *   marker: number, type: string, offset: number,
 *   baseline: boolean, progressive: boolean, lossless: boolean, arithmetic: boolean,
 *   precision: number, width: number, height: number, components: FrameComponent[]
 * }} Frame
 * @typedef {{ id: number, precision: 8 | 16, values: Uint16Array, offset: number }} QuantTable
 *   `values` are in natural (row-major) order.
 * @typedef {{ tableClass: 0 | 1, id: number, counts: Uint8Array, symbols: Uint8Array, offset: number }} HuffmanSpec
 * @typedef {{ id: number, td: number, ta: number }} ScanComponent
 * @typedef {{
 *   offset: number, components: ScanComponent[], ss: number, se: number, ah: number, al: number,
 *   dcTables: (HuffmanSpec | undefined)[], acTables: (HuffmanSpec | undefined)[],
 *   restartInterval: number, dataOffset: number, dataEnd: number
 * }} Scan
 *   Huffman tables and the restart interval are snapshots of the state when the scan started.
 * @typedef {{ marker: number, offset: number, length: number, data: Uint8Array, label: string }} AppSegment
 *   `data` is the payload after the length field (a view into the file, not a copy).
 * @typedef {{ code: string, message: string, offset: number }} ErrorInfo
 * @typedef {{
 *   bytes: Uint8Array, segments: Segment[], frame: Frame | null,
 *   quantTables: (QuantTable | undefined)[], huffmanTables: HuffmanSpec[], scans: Scan[],
 *   restartInterval: number, app: AppSegment[], comments: string[],
 *   eoiOffset: number, trailingBytes: number, warnings: string[], error: ErrorInfo | null
 * }} JpegStructure
 */

/**
 * Parses the marker structure of a JPEG file without decoding the image data.
 *
 * Every declared length is checked against the data, so truncated or hostile files produce a
 * `ParseError` with the offending offset. With `tolerant: true` the error is stored in
 * `error` and everything parsed before it is returned (useful to still show metadata).
 *
 * @param {Uint8Array} bytes
 * @param {{ tolerant?: boolean }} [options]
 * @returns {JpegStructure}
 */
export function parseJpeg(bytes, { tolerant = false } = {}) {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new ParseError('not-jpeg', 'the data does not start with a JPEG SOI marker (FF D8)', 0);
  }
  /** @type {JpegStructure} */
  const s = {
    bytes,
    segments: [{ marker: SOI, name: 'SOI', offset: 0, length: 2 }],
    frame: null,
    quantTables: [],
    huffmanTables: [],
    scans: [],
    restartInterval: 0,
    app: [],
    comments: [],
    eoiOffset: -1,
    trailingBytes: 0,
    warnings: [],
    error: null,
  };
  try {
    walk(bytes, s);
  } catch (error) {
    if (!tolerant || !(error instanceof ParseError)) throw error;
    s.error = { code: error.code, message: error.message, offset: error.offset };
  }
  return s;
}

/**
 * @param {Uint8Array} bytes
 * @param {JpegStructure} s
 */
function walk(bytes, s) {
  /** @type {(HuffmanSpec | undefined)[]} */
  const dc = [];
  /** @type {(HuffmanSpec | undefined)[]} */
  const ac = [];
  let pos = 2;
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) {
      const start = pos;
      while (pos < bytes.length && bytes[pos] !== 0xff) pos++;
      s.warnings.push(`${pos - start} unexpected byte(s) between segments at offset ${start}`);
      continue;
    }
    while (pos + 1 < bytes.length && bytes[pos + 1] === 0xff) pos++; // fill bytes
    if (pos + 1 >= bytes.length) break;
    const offset = pos;
    const marker = /** @type {number} */ (bytes[pos + 1]);
    const name = markerName(marker);

    if (marker === 0x00) {
      s.warnings.push(`stray FF 00 outside entropy-coded data at offset ${offset}`);
      pos += 2;
      continue;
    }
    if (isStandalone(marker)) {
      s.segments.push({ marker, name, offset, length: 2 });
      pos += 2;
      if (marker === EOI) {
        s.eoiOffset = offset;
        s.trailingBytes = bytes.length - pos;
        if (s.trailingBytes > 0) {
          s.warnings.push(
            `${s.trailingBytes} byte(s) after the end-of-image marker (appended data or a second image)`,
          );
        }
        return;
      }
      if (marker === SOI) s.warnings.push(`unexpected second SOI marker at offset ${offset}`);
      else if (isRst(marker)) s.warnings.push(`${name} outside entropy-coded data at ${offset}`);
      continue;
    }

    if (pos + 4 > bytes.length) {
      throw new ParseError('truncated', `${name} marker has no length field`, offset);
    }
    const length = ((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0);
    if (length < 2) {
      throw new ParseError(
        'bad-segment',
        `${name} declares an invalid length of ${length}`,
        offset,
      );
    }
    const end = pos + 2 + length;
    if (end > bytes.length) {
      throw new ParseError(
        'truncated',
        `${name} segment declares ${length - 2} payload bytes but only ${bytes.length - pos - 4} remain`,
        offset,
      );
    }
    s.segments.push({ marker, name, offset, length: length + 2 });
    const r = new ByteReader(bytes, pos + 4, length - 2);

    if (FRAME_TYPES.has(marker)) {
      parseFrame(r, marker, offset, s);
    } else if (marker === DQT) {
      parseDqt(r, offset, s);
    } else if (marker === DHT) {
      parseDht(r, offset, s, dc, ac);
    } else if (marker === DRI) {
      need(r, 2, 'bad-segment', 'DRI segment is too short', offset);
      s.restartInterval = r.u16be();
    } else if (marker === SOS) {
      const scan = parseScanHeader(r, offset, s, dc, ac);
      scan.dataOffset = end;
      scan.dataEnd = findScanEnd(bytes, end);
      s.scans.push(scan);
      if (scan.dataEnd >= bytes.length) {
        s.warnings.push('entropy-coded data runs to the end of the file; the image is truncated');
      }
      pos = scan.dataEnd;
      continue;
    } else if (marker === COM) {
      s.comments.push(latin1(r.bytes(r.remaining)));
    } else if (isApp(marker)) {
      const data = r.bytes(r.remaining);
      s.app.push({ marker, offset, length: length + 2, data, label: appLabel(marker, data) });
    } else if (marker === DAC) {
      s.warnings.push(
        'arithmetic coding tables present (DAC); arithmetic decoding is not supported',
      );
    } else if (marker === DNL) {
      s.warnings.push('DNL marker present; the frame height is defined after the first scan');
    }
    pos = end;
  }
  s.warnings.push('the file ends without an end-of-image marker (FF D9); it is probably truncated');
}

/**
 * @param {ByteReader} r
 * @param {number} n
 * @param {string} code
 * @param {string} message
 * @param {number} offset
 */
function need(r, n, code, message, offset) {
  if (r.remaining < n) throw new ParseError(code, message, offset);
}

/**
 * @param {ByteReader} r
 * @param {number} marker
 * @param {number} offset
 * @param {JpegStructure} s
 */
function parseFrame(r, marker, offset, s) {
  if (s.frame) throw new ParseError('bad-frame', 'more than one frame header (SOF)', offset);
  need(r, 6, 'bad-frame', 'frame header is too short', offset);
  const precision = r.u8();
  const height = r.u16be();
  const width = r.u16be();
  const count = r.u8();
  if (width === 0) throw new ParseError('bad-frame', 'frame width is 0', offset);
  if (height === 0) {
    throw new ParseError(
      'bad-frame',
      'frame height 0 (defined later by DNL) is not supported',
      offset,
    );
  }
  if (count < 1 || count > 4) {
    throw new ParseError(
      'bad-frame',
      `frame declares ${count} components (1 to 4 allowed)`,
      offset,
    );
  }
  need(r, count * 3, 'bad-frame', 'frame header is too short for its components', offset);
  /** @type {FrameComponent[]} */
  const components = [];
  for (let i = 0; i < count; i++) {
    const id = r.u8();
    const hv = r.u8();
    const tq = r.u8();
    const h = hv >> 4;
    const v = hv & 15;
    if (h < 1 || h > 4 || v < 1 || v > 4) {
      throw new ParseError('bad-frame', `component ${id} has invalid sampling ${h}x${v}`, offset);
    }
    if (tq > 3) throw new ParseError('bad-frame', `component ${id} uses table ${tq}`, offset);
    if (components.some((c) => c.id === id)) {
      throw new ParseError('bad-frame', `component id ${id} appears twice`, offset);
    }
    components.push({ id, h, v, tq });
  }
  const type = FRAME_TYPES.get(marker) ?? 'Unknown';
  s.frame = {
    marker,
    type,
    offset,
    baseline: marker === 0xc0,
    progressive: marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce,
    lossless: marker === 0xc3 || marker === 0xc7 || marker === 0xcb || marker === 0xcf,
    arithmetic: marker >= 0xc9,
    precision,
    width,
    height,
    components,
  };
}

/**
 * @param {ByteReader} r
 * @param {number} offset
 * @param {JpegStructure} s
 */
function parseDqt(r, offset, s) {
  if (r.remaining === 0) throw new ParseError('bad-dqt', 'empty DQT segment', offset);
  while (r.remaining > 0) {
    const pqtq = r.u8();
    const pq = pqtq >> 4;
    const id = pqtq & 15;
    if (pq > 1) throw new ParseError('bad-dqt', `table precision code ${pq} is invalid`, offset);
    if (id > 3) throw new ParseError('bad-dqt', `quantization table id ${id} is above 3`, offset);
    const size = pq === 0 ? 1 : 2;
    need(r, 64 * size, 'bad-dqt', `DQT segment is too short for table ${id}`, offset);
    const values = new Uint16Array(64);
    let zeros = 0;
    for (let k = 0; k < 64; k++) {
      const v = size === 1 ? r.u8() : r.u16be();
      values[ZIGZAG[k] ?? 0] = v;
      if (v === 0) zeros++;
    }
    if (zeros > 0) s.warnings.push(`quantization table ${id} contains ${zeros} zero step(s)`);
    s.quantTables[id] = { id, precision: pq === 0 ? 8 : 16, values, offset };
  }
}

/**
 * @param {ByteReader} r
 * @param {number} offset
 * @param {JpegStructure} s
 * @param {(HuffmanSpec | undefined)[]} dc
 * @param {(HuffmanSpec | undefined)[]} ac
 */
function parseDht(r, offset, s, dc, ac) {
  if (r.remaining === 0) throw new ParseError('bad-dht', 'empty DHT segment', offset);
  while (r.remaining > 0) {
    const tcth = r.u8();
    const tableClass = tcth >> 4;
    const id = tcth & 15;
    if (tableClass > 1 || id > 3) {
      throw new ParseError(
        'bad-dht',
        `invalid Huffman table class ${tableClass} / id ${id}`,
        offset,
      );
    }
    need(r, 16, 'bad-dht', 'DHT segment is too short for its code counts', offset);
    const counts = Uint8Array.from(r.bytes(16));
    const total = counts.reduce((a, b) => a + b, 0);
    if (total > 256) {
      throw new ParseError('bad-dht', `Huffman table declares ${total} symbols (max 256)`, offset);
    }
    need(r, total, 'bad-dht', 'DHT segment is too short for its symbols', offset);
    const symbols = Uint8Array.from(r.bytes(total));
    /** @type {HuffmanSpec} */
    const spec = { tableClass: tableClass === 0 ? 0 : 1, id, counts, symbols, offset };
    (tableClass === 0 ? dc : ac)[id] = spec;
    s.huffmanTables.push(spec);
  }
}

/**
 * @param {ByteReader} r
 * @param {number} offset
 * @param {JpegStructure} s
 * @param {(HuffmanSpec | undefined)[]} dc
 * @param {(HuffmanSpec | undefined)[]} ac
 * @returns {Scan}
 */
function parseScanHeader(r, offset, s, dc, ac) {
  const frame = s.frame;
  if (!frame) throw new ParseError('bad-scan', 'scan (SOS) found before the frame header', offset);
  need(r, 1, 'bad-scan', 'scan header is too short', offset);
  const count = r.u8();
  if (count < 1 || count > 4) {
    throw new ParseError('bad-scan', `scan declares ${count} components (1 to 4 allowed)`, offset);
  }
  need(r, count * 2 + 3, 'bad-scan', 'scan header is too short for its components', offset);
  /** @type {ScanComponent[]} */
  const components = [];
  for (let i = 0; i < count; i++) {
    const id = r.u8();
    const tables = r.u8();
    if (!frame.components.some((c) => c.id === id)) {
      throw new ParseError('bad-scan', `scan refers to unknown component ${id}`, offset);
    }
    components.push({ id, td: tables >> 4, ta: tables & 15 });
  }
  const ss = r.u8();
  const se = r.u8();
  const ahal = r.u8();
  return {
    offset,
    components,
    ss,
    se,
    ah: ahal >> 4,
    al: ahal & 15,
    dcTables: dc.slice(),
    acTables: ac.slice(),
    restartInterval: s.restartInterval,
    dataOffset: 0,
    dataEnd: 0,
  };
}

/**
 * Finds the end of entropy-coded data: the first 0xFF that is neither a stuffed 0xFF00
 * nor a restart marker. Returns `bytes.length` when the data runs to the end of the file.
 * @param {Uint8Array} bytes
 * @param {number} start
 */
export function findScanEnd(bytes, start) {
  let i = start;
  const n = bytes.length;
  while (i < n) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    if (i + 1 >= n) return n;
    const next = /** @type {number} */ (bytes[i + 1]);
    if (next === 0x00 || isRst(next)) {
      i += 2;
      continue;
    }
    return i;
  }
  return n;
}

/**
 * @param {number} marker
 * @param {Uint8Array} data
 */
function appLabel(marker, data) {
  /** @type {[number, string, string][]} */
  const known = [
    [0xe0, 'JFIF\0', 'JFIF'],
    [0xe0, 'JFXX\0', 'JFIF extension'],
    [0xe1, 'Exif\0', 'Exif'],
    [0xe1, 'http://ns.adobe.com/xap/1.0/\0', 'XMP'],
    [0xe1, 'http://ns.adobe.com/xmp/extension/\0', 'Extended XMP'],
    [0xe2, 'ICC_PROFILE\0', 'ICC profile'],
    [0xe2, 'MPF\0', 'Multi-picture format'],
    [0xec, 'Ducky', 'Ducky (Photoshop Save for Web)'],
    [0xed, 'Photoshop 3.0\0', 'Photoshop IRB'],
    [0xee, 'Adobe', 'Adobe'],
  ];
  for (const [m, signature, label] of known) {
    if (m === marker && hasAscii(data, 0, signature)) return label;
  }
  let id = '';
  for (let i = 0; i < Math.min(data.length, 24); i++) {
    const c = data[i] ?? 0;
    if (c < 0x20 || c > 0x7e) break;
    id += String.fromCharCode(c);
  }
  return id.length >= 3 ? id : markerName(marker);
}

/** @param {Uint8Array} data */
function latin1(data) {
  let out = '';
  for (const c of data) out += String.fromCharCode(c);
  return out.replace(/\0+$/, '');
}
