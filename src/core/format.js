import { hasAscii } from './bytes.js';

/**
 * @typedef {'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'tiff' | 'heif' | 'avif' | 'unknown'} FormatKind
 * @typedef {{ kind: FormatKind, mime: string, label: string, browserDecodable: boolean }} FormatInfo
 */

/** @type {Record<FormatKind, Omit<FormatInfo, 'kind'>>} */
const INFO = {
  jpeg: { mime: 'image/jpeg', label: 'JPEG', browserDecodable: true },
  png: { mime: 'image/png', label: 'PNG', browserDecodable: true },
  webp: { mime: 'image/webp', label: 'WebP', browserDecodable: true },
  gif: { mime: 'image/gif', label: 'GIF', browserDecodable: true },
  bmp: { mime: 'image/bmp', label: 'BMP', browserDecodable: true },
  tiff: { mime: 'image/tiff', label: 'TIFF', browserDecodable: false },
  heif: { mime: 'image/heif', label: 'HEIF/HEIC', browserDecodable: false },
  avif: { mime: 'image/avif', label: 'AVIF', browserDecodable: true },
  unknown: { mime: 'application/octet-stream', label: 'Unknown', browserDecodable: false },
};

/**
 * Identifies an image format from its leading magic bytes (never from the file name).
 * @param {Uint8Array} bytes
 * @returns {FormatInfo}
 */
export function sniffFormat(bytes) {
  const kind = detect(bytes);
  return { kind, ...INFO[kind] };
}

/**
 * @param {Uint8Array} b
 * @returns {FormatKind}
 */
function detect(b) {
  if (b.length < 4) return 'unknown';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && hasAscii(b, 1, 'PNG\r\n\x1a\n')) return 'png';
  if (hasAscii(b, 0, 'RIFF') && hasAscii(b, 8, 'WEBP')) return 'webp';
  if (hasAscii(b, 0, 'GIF87a') || hasAscii(b, 0, 'GIF89a')) return 'gif';
  if (hasAscii(b, 0, 'BM')) return 'bmp';
  if (hasAscii(b, 0, 'II') && b[2] === 0x2a && b[3] === 0) return 'tiff';
  if (hasAscii(b, 0, 'MM') && b[2] === 0 && b[3] === 0x2a) return 'tiff';
  if (hasAscii(b, 4, 'ftyp')) {
    if (hasAscii(b, 8, 'avif') || hasAscii(b, 8, 'avis')) return 'avif';
    for (const brand of ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1']) {
      if (hasAscii(b, 8, brand)) return 'heif';
    }
  }
  return 'unknown';
}
