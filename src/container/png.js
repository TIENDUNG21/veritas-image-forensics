import { asciiString, hasAscii } from '../core/bytes.js';
import { crc32 } from '../core/crc32.js';
import { ParseError } from '../core/errors.js';
import { parseExif } from '../exif/exif.js';
import { summarizeXmp } from '../exif/xmp.js';
import { attempt, emptyMetadata, utf8 } from './metadata.js';

/**
 * @typedef {{
 *   width: number, height: number, bitDepth: number, colorType: number, interlaced: boolean,
 *   animated: boolean
 * }} PngInfo
 */

const MAX_CHUNKS = 10_000;
const COLOR_TYPES = /** @type {Record<number, string>} */ ({
  0: 'Grayscale',
  2: 'RGB',
  3: 'Palette',
  4: 'Grayscale + alpha',
  6: 'RGBA',
});

/**
 * Walks PNG chunks and extracts header fields and metadata (tEXt/iTXt/zTXt keywords, eXIf,
 * XMP, tIME, pHYs, iCCP name). Pixel data is decoded by the browser, not here.
 * @param {Uint8Array} bytes
 * @returns {{ info: PngInfo, meta: import('./metadata.js').ImageMetadata }}
 */
export function readPng(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0x89 || !hasAscii(bytes, 1, 'PNG\r\n\x1a\n')) {
    throw new ParseError('not-png', 'missing PNG signature', 0);
  }
  if (bytes.length < 33 || !hasAscii(bytes, 12, 'IHDR')) {
    throw new ParseError('bad-png', 'the first chunk is not a complete IHDR', 8);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const meta = emptyMetadata('png');
  /** @type {PngInfo} */
  const info = {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
    interlaced: bytes[28] === 1,
    animated: false,
  };
  if (info.width === 0 || info.height === 0) {
    throw new ParseError('bad-png', 'IHDR declares a zero dimension', 16);
  }
  meta.properties.push(
    { label: 'Colour type', value: COLOR_TYPES[info.colorType] ?? `Unknown (${info.colorType})` },
    { label: 'Bit depth', value: String(info.bitDepth) },
    { label: 'Interlaced', value: info.interlaced ? 'Adam7' : 'no' },
  );

  let p = 8;
  let ended = false;
  for (let n = 0; n < MAX_CHUNKS && p + 8 <= bytes.length; n++) {
    const length = view.getUint32(p);
    const type = asciiString(bytes, p + 4, p + 8);
    const dataStart = p + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      meta.warnings.push(`chunk ${type} at offset ${p} is truncated; the file is cut short`);
      break;
    }
    if (crc32(bytes, p + 4, dataEnd) !== view.getUint32(dataEnd)) {
      meta.warnings.push(`chunk ${type} at offset ${p} has a bad CRC (damaged or edited bytes)`);
    }
    chunk(type, bytes.subarray(dataStart, dataEnd), meta, info);
    p = dataEnd + 4;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended && !meta.warnings.some((w) => w.includes('truncated'))) {
    meta.warnings.push('no IEND chunk: the file is truncated');
  }
  if (ended && p < bytes.length) {
    meta.warnings.push(`${bytes.length - p} byte(s) after the IEND chunk (appended data)`);
  }
  return { info, meta };
}

/**
 * @param {string} type
 * @param {Uint8Array} data
 * @param {import('./metadata.js').ImageMetadata} meta
 * @param {PngInfo} info
 */
function chunk(type, data, meta, info) {
  switch (type) {
    case 'tEXt': {
      const nul = data.indexOf(0);
      if (nul < 0) return;
      text(asciiString(data, 0, nul), latin1(data.subarray(nul + 1)), meta);
      break;
    }
    case 'zTXt': {
      const nul = data.indexOf(0);
      if (nul > 0) text(asciiString(data, 0, nul), '(compressed text, not shown)', meta);
      break;
    }
    case 'iTXt': {
      const nul = data.indexOf(0);
      if (nul < 0 || nul + 3 > data.length) return;
      const keyword = asciiString(data, 0, nul);
      const compressed = data[nul + 1] === 1;
      const lang = data.indexOf(0, nul + 3);
      const translated = lang < 0 ? -1 : data.indexOf(0, lang + 1);
      if (translated < 0) return;
      const value = compressed
        ? '(compressed text, not shown)'
        : utf8(data.subarray(translated + 1));
      if (keyword === 'XML:com.adobe.xmp' && !compressed) meta.xmp = summarizeXmp(value);
      else text(keyword, value, meta);
      break;
    }
    case 'eXIf':
      meta.exif = attempt(meta, 'EXIF', () => parseExif(data));
      break;
    case 'tIME':
      if (data.length === 7) {
        const pad = (/** @type {number} */ v) => String(v).padStart(2, '0');
        const year = (data[0] << 8) | data[1];
        meta.properties.push({
          label: 'Last modified (tIME)',
          value: `${year}-${pad(data[2])}-${pad(data[3])}T${pad(data[4])}:${pad(data[5])}:${pad(data[6])}Z`,
        });
      }
      break;
    case 'pHYs':
      if (data.length === 9 && data[8] === 1) {
        const v = new DataView(data.buffer, data.byteOffset, 9);
        const dpi = (/** @type {number} */ ppm) => Math.round(ppm * 0.0254);
        meta.properties.push({
          label: 'Density',
          value: `${dpi(v.getUint32(0))} x ${dpi(v.getUint32(4))} dpi`,
        });
      }
      break;
    case 'iCCP': {
      const nul = data.indexOf(0);
      if (nul > 0)
        meta.properties.push({ label: 'ICC profile name', value: asciiString(data, 0, nul) });
      break;
    }
    case 'sRGB':
      meta.properties.push({ label: 'Colour space', value: 'sRGB' });
      break;
    case 'acTL':
      info.animated = true;
      meta.properties.push({ label: 'Animated', value: 'yes (APNG)' });
      break;
    default:
      break;
  }
}

/**
 * @param {string} keyword
 * @param {string} value
 * @param {import('./metadata.js').ImageMetadata} meta
 */
function text(keyword, value, meta) {
  if (keyword === 'Comment' || keyword === 'Description') meta.comments.push(value);
  else meta.properties.push({ label: keyword, value: value.slice(0, 2000) });
}

/** @param {Uint8Array} data */
function latin1(data) {
  let out = '';
  for (let i = 0; i < Math.min(data.length, 4000); i++) out += String.fromCharCode(data[i]);
  return out;
}
