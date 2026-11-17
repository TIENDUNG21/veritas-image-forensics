// Builds TIFF/EXIF structures for tests and sample images, in either byte order.

/**
 * @typedef {number[] | string | Uint8Array | [number, number][]} EntryValues
 * @typedef {{ tag: number, type: number, values: EntryValues }} Entry
 * @typedef {{
 *   ifd0: Entry[], exif?: Entry[], gps?: Entry[], interop?: Entry[], ifd1?: Entry[],
 *   thumbnail?: Uint8Array
 * }} TiffSpec
 */

export const TYPE = {
  BYTE: 1,
  ASCII: 2,
  SHORT: 3,
  LONG: 4,
  RATIONAL: 5,
  SBYTE: 6,
  UNDEFINED: 7,
  SSHORT: 8,
  SLONG: 9,
  SRATIONAL: 10,
  FLOAT: 11,
  DOUBLE: 12,
};

const SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

/** @param {Entry} e */
function countOf(e) {
  if (typeof e.values === 'string') return e.values.length + 1;
  return e.values.length;
}

/** @param {Entry} e */
function byteSize(e) {
  return countOf(e) * (SIZE[e.type] ?? 1);
}

/** @param {Entry[]} entries */
function ifdSize(entries) {
  let data = 0;
  for (const e of entries) {
    const n = byteSize(e);
    if (n > 4) data += n + (n % 2);
  }
  return 2 + entries.length * 12 + 4 + data;
}

/**
 * Builds a complete TIFF structure (header + IFDs + thumbnail).
 * @param {TiffSpec} spec
 * @param {{ littleEndian?: boolean }} [options]
 * @returns {Uint8Array}
 */
export function buildTiff(spec, { littleEndian = true } = {}) {
  /** @param {number} tag @param {number} value @returns {Entry} */
  const pointer = (tag, value) => ({ tag, type: TYPE.LONG, values: [value] });
  const ifd0 = [...spec.ifd0];
  const exif = spec.exif ? [...spec.exif] : null;
  const ifd1 = spec.ifd1 ? [...spec.ifd1] : null;
  if (exif) ifd0.push(pointer(0x8769, 0));
  if (spec.gps) ifd0.push(pointer(0x8825, 0));
  if (exif && spec.interop) exif.push(pointer(0xa005, 0));
  if (ifd1 && spec.thumbnail) {
    ifd1.push(pointer(0x0201, 0), pointer(0x0202, spec.thumbnail.length));
  }
  for (const list of [ifd0, exif, ifd1]) list?.sort((a, b) => a.tag - b.tag);

  // Layout: header, IFD0, Exif, Interop, GPS, IFD1, thumbnail.
  let offset = 8;
  const at0 = offset;
  offset += ifdSize(ifd0);
  const atExif = offset;
  if (exif) offset += ifdSize(exif);
  const atInterop = offset;
  if (spec.interop) offset += ifdSize(spec.interop);
  const atGps = offset;
  if (spec.gps) offset += ifdSize(spec.gps);
  const at1 = offset;
  if (ifd1) offset += ifdSize(ifd1);
  const atThumb = offset;
  if (spec.thumbnail) offset += spec.thumbnail.length;

  /** @param {Entry[] | null} list @param {number} tag @param {number} value */
  const setPointer = (list, tag, value) => {
    const e = list?.find((x) => x.tag === tag);
    if (e) e.values = [value];
  };
  setPointer(ifd0, 0x8769, atExif);
  setPointer(ifd0, 0x8825, atGps);
  setPointer(exif, 0xa005, atInterop);
  setPointer(ifd1, 0x0201, atThumb);

  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  out.set(littleEndian ? [0x49, 0x49, 0x2a, 0x00] : [0x4d, 0x4d, 0x00, 0x2a]);
  view.setUint32(4, 8, littleEndian);
  writeIfd(view, out, at0, ifd0, ifd1 ? at1 : 0, littleEndian);
  if (exif) writeIfd(view, out, atExif, exif, 0, littleEndian);
  if (spec.interop) writeIfd(view, out, atInterop, spec.interop, 0, littleEndian);
  if (spec.gps) writeIfd(view, out, atGps, spec.gps, 0, littleEndian);
  if (ifd1) writeIfd(view, out, at1, ifd1, 0, littleEndian);
  if (spec.thumbnail) out.set(spec.thumbnail, atThumb);
  return out;
}

/**
 * @param {DataView} view
 * @param {Uint8Array} out
 * @param {number} at
 * @param {Entry[]} entries
 * @param {number} next
 * @param {boolean} le
 */
function writeIfd(view, out, at, entries, next, le) {
  view.setUint16(at, entries.length, le);
  let data = at + 2 + entries.length * 12 + 4;
  entries.forEach((e, i) => {
    const p = at + 2 + i * 12;
    view.setUint16(p, e.tag, le);
    view.setUint16(p + 2, e.type, le);
    view.setUint32(p + 4, countOf(e), le);
    const n = byteSize(e);
    let target = p + 8;
    if (n > 4) {
      view.setUint32(p + 8, data, le);
      target = data;
      data += n + (n % 2);
    }
    writeValues(view, out, target, e, le);
  });
  view.setUint32(at + 2 + entries.length * 12, next, le);
}

/**
 * @param {DataView} view
 * @param {Uint8Array} out
 * @param {number} at
 * @param {Entry} e
 * @param {boolean} le
 */
function writeValues(view, out, at, e, le) {
  if (typeof e.values === 'string') {
    for (let i = 0; i < e.values.length; i++) out[at + i] = e.values.charCodeAt(i) & 0xff;
    out[at + e.values.length] = 0;
    return;
  }
  if (e.values instanceof Uint8Array) {
    out.set(e.values, at);
    return;
  }
  const size = SIZE[e.type] ?? 1;
  e.values.forEach((v, i) => {
    const p = at + i * size;
    if (Array.isArray(v)) {
      if (e.type === TYPE.SRATIONAL) {
        view.setInt32(p, v[0], le);
        view.setInt32(p + 4, v[1], le);
      } else {
        view.setUint32(p, v[0], le);
        view.setUint32(p + 4, v[1], le);
      }
      return;
    }
    switch (e.type) {
      case TYPE.BYTE:
      case TYPE.UNDEFINED:
        view.setUint8(p, v);
        break;
      case TYPE.SBYTE:
        view.setInt8(p, v);
        break;
      case TYPE.SHORT:
        view.setUint16(p, v, le);
        break;
      case TYPE.SSHORT:
        view.setInt16(p, v, le);
        break;
      case TYPE.LONG:
        view.setUint32(p, v, le);
        break;
      case TYPE.SLONG:
        view.setInt32(p, v, le);
        break;
      case TYPE.FLOAT:
        view.setFloat32(p, v, le);
        break;
      case TYPE.DOUBLE:
        view.setFloat64(p, v, le);
        break;
      default:
        throw new Error(`cannot write type ${e.type}`);
    }
  });
}

/**
 * Wraps a TIFF structure into a JPEG APP1 Exif segment (FF E1, length, "Exif\0\0", TIFF).
 * @param {Uint8Array} tiff
 */
export function exifSegment(tiff) {
  const length = tiff.length + 8;
  const out = new Uint8Array(length + 2);
  out.set([0xff, 0xe1, length >> 8, length & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  out.set(tiff, 10);
  return out;
}

/**
 * @param {string} name
 * @param {string} text
 */
export function xmpSegment(name, text) {
  const header = name === 'xmp' ? 'http://ns.adobe.com/xap/1.0/\0' : name;
  const body = new TextEncoder().encode(header + text);
  const length = body.length + 2;
  const out = new Uint8Array(length + 2);
  out.set([0xff, 0xe1, length >> 8, length & 0xff]);
  out.set(body, 4);
  return out;
}
