import { ParseError } from '../core/errors.js';

/**
 * @typedef {{ num: number, den: number }} Rational
 * @typedef {number | string | Rational | number[] | Rational[] | Uint8Array} TiffValue
 * @typedef {{ tag: number, type: number, count: number, value: TiffValue }} TiffEntry
 * @typedef {'ifd0' | 'exif' | 'gps' | 'interop' | 'ifd1'} IfdName
 * @typedef {{ littleEndian: boolean, ifds: Map<IfdName, TiffEntry[]>, warnings: string[] }} TiffData
 */

/** Byte size of each TIFF field type (index = type code). */
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
const MAX_ENTRIES = 1000;
const MAX_VALUES = 4096;

const EXIF_POINTER = 0x8769;
const GPS_POINTER = 0x8825;
const INTEROP_POINTER = 0xa005;

const utf8 = new TextDecoder('utf-8', { fatal: false });

/**
 * Reads a TIFF structure (as found in EXIF) and walks IFD0, the Exif, Interop and GPS
 * sub-IFDs and IFD1. All offsets are relative to `start`. Damage inside an IFD produces
 * warnings and skipped entries; only an invalid header throws.
 *
 * @param {Uint8Array} bytes
 * @param {number} [start]
 * @param {number} [length]
 * @returns {TiffData}
 */
export function readTiff(bytes, start = 0, length = bytes.length - start) {
  const size = Math.max(0, Math.min(length, bytes.length - start));
  if (size < 8) throw new ParseError('bad-tiff', 'TIFF header is too short', start);
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, size);
  const order = view.getUint16(0, false);
  if (order !== 0x4949 && order !== 0x4d4d) {
    throw new ParseError('bad-tiff', 'unknown TIFF byte order mark (expected II or MM)', start);
  }
  const le = order === 0x4949;
  if (view.getUint16(2, le) !== 42) {
    throw new ParseError('bad-tiff', 'TIFF magic number is not 42', start + 2);
  }

  /** @type {TiffData} */
  const result = { littleEndian: le, ifds: new Map(), warnings: [] };
  const visited = new Set();

  /**
   * @param {IfdName} name
   * @param {number} offset
   * @returns {number} offset of the next IFD (0 if none)
   */
  const walk = (name, offset) => {
    if (offset === 0) return 0;
    if (visited.has(offset)) {
      result.warnings.push(`${name}: IFD loop detected at offset ${offset}; stopped`);
      return 0;
    }
    visited.add(offset);
    if (offset < 8 || offset + 2 > size) {
      result.warnings.push(`${name}: IFD offset ${offset} lies outside the TIFF data`);
      return 0;
    }
    const count = view.getUint16(offset, le);
    const end = offset + 2 + count * 12;
    if (count > MAX_ENTRIES || end + 4 > size) {
      result.warnings.push(
        `${name}: IFD at offset ${offset} declares ${count} entries, which do not fit the data`,
      );
      result.ifds.set(name, []);
      return 0;
    }
    /** @type {TiffEntry[]} */
    const entries = [];
    for (let i = 0; i < count; i++) {
      const entry = readEntry(view, bytes, start, offset + 2 + i * 12, le, name, result.warnings);
      if (entry) entries.push(entry);
    }
    result.ifds.set(name, entries);
    return view.getUint32(end, le);
  };

  /** @param {TiffEntry[] | undefined} entries @param {number} tag */
  const pointerOf = (entries, tag) => {
    const v = entries?.find((e) => e.tag === tag)?.value;
    return typeof v === 'number' ? v : 0;
  };

  const next = walk('ifd0', view.getUint32(4, le));
  const ifd0 = result.ifds.get('ifd0');
  const exifOffset = pointerOf(ifd0, EXIF_POINTER);
  if (exifOffset) {
    walk('exif', exifOffset);
    const interop = pointerOf(result.ifds.get('exif'), INTEROP_POINTER);
    if (interop) walk('interop', interop);
  }
  const gpsOffset = pointerOf(ifd0, GPS_POINTER);
  if (gpsOffset) walk('gps', gpsOffset);
  if (next) walk('ifd1', next);
  return result;
}

/**
 * @param {DataView} view
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} p Entry offset.
 * @param {boolean} le
 * @param {string} ifd
 * @param {string[]} warnings
 * @returns {TiffEntry | null}
 */
function readEntry(view, bytes, start, p, le, ifd, warnings) {
  const tag = view.getUint16(p, le);
  const type = view.getUint16(p + 2, le);
  const count = view.getUint32(p + 4, le);
  const label = `tag 0x${tag.toString(16).toUpperCase().padStart(4, '0')} in ${ifd}`;
  const unit = TYPE_SIZE[type];
  if (!unit) {
    warnings.push(`${label}: unknown field type ${type}; skipped`);
    return null;
  }
  const total = unit * count;
  const at = total <= 4 ? p + 8 : view.getUint32(p + 8, le);
  if (count === 0 || at + total > view.byteLength) {
    if (count !== 0) warnings.push(`${label}: value lies outside the TIFF data; skipped`);
    return count === 0 ? { tag, type, count, value: [] } : null;
  }
  const n = Math.min(count, MAX_VALUES);
  if (count > MAX_VALUES && type !== 1 && type !== 2 && type !== 7) {
    warnings.push(`${label}: ${count} values, only the first ${MAX_VALUES} are kept`);
  }

  switch (type) {
    case 2: {
      const raw = bytes.subarray(start + at, start + at + count);
      const parts = utf8
        .decode(raw)
        .split('\0')
        .map((s) => s.trim());
      return { tag, type, count, value: parts.filter((s) => s.length > 0).join(' / ') };
    }
    case 7:
      return { tag, type, count, value: bytes.slice(start + at, start + at + count) };
    case 1:
      if (count === 1) return { tag, type, count, value: view.getUint8(at) };
      return { tag, type, count, value: bytes.slice(start + at, start + at + count) };
    case 5:
    case 10: {
      /** @type {Rational[]} */
      const values = [];
      for (let i = 0; i < n; i++) {
        const o = at + i * 8;
        values.push(
          type === 5
            ? { num: view.getUint32(o, le), den: view.getUint32(o + 4, le) }
            : { num: view.getInt32(o, le), den: view.getInt32(o + 4, le) },
        );
      }
      return { tag, type, count, value: count === 1 ? values[0] : values };
    }
    default: {
      /** @type {number[]} */
      const values = [];
      for (let i = 0; i < n; i++) values.push(readNumber(view, type, at + i * unit, le));
      return { tag, type, count, value: count === 1 ? values[0] : values };
    }
  }
}

/**
 * @param {DataView} view
 * @param {number} type
 * @param {number} o
 * @param {boolean} le
 */
function readNumber(view, type, o, le) {
  switch (type) {
    case 3:
      return view.getUint16(o, le);
    case 4:
      return view.getUint32(o, le);
    case 6:
      return view.getInt8(o);
    case 8:
      return view.getInt16(o, le);
    case 9:
      return view.getInt32(o, le);
    case 11:
      return view.getFloat32(o, le);
    case 12:
      return view.getFloat64(o, le);
    default:
      return view.getUint8(o);
  }
}
