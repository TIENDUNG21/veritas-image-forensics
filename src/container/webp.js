import { asciiString, hasAscii } from '../core/bytes.js';
import { ParseError } from '../core/errors.js';
import { parseExif } from '../exif/exif.js';
import { parseIcc } from '../exif/icc.js';
import { summarizeXmp } from '../exif/xmp.js';
import { attempt, emptyMetadata, utf8 } from './metadata.js';

/**
 * @typedef {{ width: number, height: number, encoding: string, animated: boolean, alpha: boolean }} WebpInfo
 */

const MAX_CHUNKS = 10_000;

/**
 * Walks the RIFF chunks of a WebP file: dimensions from VP8X/VP8/VP8L, metadata from the
 * EXIF, XMP and ICCP chunks.
 * @param {Uint8Array} bytes
 * @returns {{ info: WebpInfo, meta: import('./metadata.js').ImageMetadata }}
 */
export function readWebp(bytes) {
  if (bytes.length < 12 || !hasAscii(bytes, 0, 'RIFF') || !hasAscii(bytes, 8, 'WEBP')) {
    throw new ParseError('not-webp', 'missing RIFF/WEBP header', 0);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const meta = emptyMetadata('webp');
  /** @type {WebpInfo} */
  const info = { width: 0, height: 0, encoding: 'unknown', animated: false, alpha: false };
  const riffEnd = Math.min(bytes.length, 8 + view.getUint32(4, true));

  let p = 12;
  for (let n = 0; n < MAX_CHUNKS && p + 8 <= riffEnd; n++) {
    const fourcc = asciiString(bytes, p, p + 4);
    const size = view.getUint32(p + 4, true);
    const start = p + 8;
    if (start + size > bytes.length) {
      meta.warnings.push(
        `chunk ${fourcc.trim()} at offset ${p} is truncated; the file is cut short`,
      );
      break;
    }
    const data = bytes.subarray(start, start + size);
    switch (fourcc) {
      case 'VP8X':
        if (size >= 10) {
          info.alpha = (data[0] & 0x10) !== 0;
          info.animated = (data[0] & 0x02) !== 0;
          info.width = 1 + (data[4] | (data[5] << 8) | (data[6] << 16));
          info.height = 1 + (data[7] | (data[8] << 8) | (data[9] << 16));
          info.encoding = 'extended (VP8X)';
        }
        break;
      case 'VP8 ':
        if (size >= 10 && data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
          if (!info.width) {
            info.width = (data[6] | (data[7] << 8)) & 0x3fff;
            info.height = (data[8] | (data[9] << 8)) & 0x3fff;
          }
          info.encoding = 'lossy (VP8)';
        }
        break;
      case 'VP8L':
        if (size >= 5 && data[0] === 0x2f) {
          const bits = data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24);
          if (!info.width) {
            info.width = (bits & 0x3fff) + 1;
            info.height = ((bits >>> 14) & 0x3fff) + 1;
          }
          info.encoding = 'lossless (VP8L)';
        }
        break;
      case 'EXIF':
        meta.exif = attempt(meta, 'EXIF', () => parseExif(data));
        break;
      case 'XMP ':
        meta.xmp = summarizeXmp(utf8(data));
        break;
      case 'ICCP':
        meta.icc = attempt(meta, 'ICC profile', () => parseIcc(data));
        break;
      case 'ANIM':
        info.animated = true;
        break;
      default:
        break;
    }
    p = start + size + (size % 2);
  }
  meta.properties.push({ label: 'WebP encoding', value: info.encoding });
  if (info.animated) meta.properties.push({ label: 'Animated', value: 'yes' });
  if (riffEnd < bytes.length) {
    meta.warnings.push(`${bytes.length - riffEnd} byte(s) after the RIFF data (appended data)`);
  }
  return { info, meta };
}
