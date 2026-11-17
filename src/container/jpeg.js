import { hasAscii } from '../core/bytes.js';
import { parseExif } from '../exif/exif.js';
import { joinIccChunks, parseIcc } from '../exif/icc.js';
import { summarizeXmp } from '../exif/xmp.js';
import { attempt, describeThumbnail, emptyMetadata, utf8 } from './metadata.js';

/**
 * @typedef {import('../jpeg/parser.js').JpegStructure} JpegStructure
 * @typedef {import('../jpeg/parser.js').AppSegment} AppSegment
 * @typedef {import('./metadata.js').ImageMetadata} ImageMetadata
 */

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const ADOBE_TRANSFORMS = ['Unknown (RGB or CMYK)', 'YCbCr', 'YCCK'];
const IRB_NAMES = /** @type {Record<number, string>} */ ({
  0x0404: 'IPTC-NAA',
  0x040c: 'thumbnail',
  0x0409: 'thumbnail (old)',
  0x0425: 'IPTC digest',
  0x0422: 'EXIF',
  0x0424: 'XMP',
  0x040f: 'ICC profile',
  0x03ed: 'resolution',
});

/**
 * Extracts metadata from the APPn and COM segments of a parsed JPEG.
 * @param {JpegStructure} jpeg
 * @returns {ImageMetadata}
 */
export function readJpegMetadata(jpeg) {
  const meta = emptyMetadata('jpeg');
  meta.comments = [...jpeg.comments];
  /** @type {Uint8Array[]} */
  const icc = [];
  let extendedXmp = 0;

  for (const app of jpeg.app) {
    switch (app.label) {
      case 'JFIF':
        jfif(app, meta);
        break;
      case 'Exif':
        if (!meta.exif) meta.exif = attempt(meta, 'EXIF', () => parseExif(app.data));
        break;
      case 'XMP':
        meta.xmp = summarizeXmp(utf8(app.data.subarray(XMP_HEADER.length)));
        break;
      case 'Extended XMP':
        extendedXmp++;
        break;
      case 'ICC profile':
        icc.push(app.data);
        break;
      case 'Adobe':
        if (app.data.length >= 12) {
          const t = app.data[11];
          meta.properties.push({
            label: 'Adobe colour transform',
            value: ADOBE_TRANSFORMS[t] ?? `Unknown (${t})`,
          });
        }
        break;
      case 'Ducky (Photoshop Save for Web)':
        ducky(app, meta);
        break;
      case 'Photoshop IRB':
        photoshop(app, meta);
        break;
      case 'Multi-picture format':
        meta.properties.push({ label: 'Multi-picture format', value: 'present (extra images)' });
        break;
      default:
        break;
    }
  }
  if (extendedXmp > 0) {
    meta.properties.push({ label: 'Extended XMP segments', value: String(extendedXmp) });
  }
  if (icc.length > 0) meta.icc = attempt(meta, 'ICC profile', () => parseIcc(joinIccChunks(icc)));
  const thumb = meta.exif?.thumbnail;
  if (thumb) meta.thumbnail = describeThumbnail(thumb.bytes);
  if (meta.exif) meta.warnings.push(...meta.exif.warnings.map((w) => `EXIF: ${w}`));
  return meta;
}

/**
 * @param {AppSegment} app
 * @param {ImageMetadata} meta
 */
function jfif(app, meta) {
  const d = app.data;
  if (d.length < 12) return;
  meta.properties.push({
    label: 'JFIF version',
    value: `${d[5]}.${String(d[6]).padStart(2, '0')}`,
  });
  const x = (d[8] << 8) | d[9];
  const y = (d[10] << 8) | d[11];
  const unit = d[7] === 1 ? 'dpi' : d[7] === 2 ? 'dots/cm' : '(aspect ratio only)';
  meta.properties.push({ label: 'JFIF density', value: `${x} x ${y} ${unit}` });
}

/**
 * Photoshop "Save for Web" writes a Ducky segment whose tag 1 is the quality slider value.
 * @param {AppSegment} app
 * @param {ImageMetadata} meta
 */
function ducky(app, meta) {
  const d = app.data;
  let p = 5;
  while (p + 4 <= d.length) {
    const tag = (d[p] << 8) | d[p + 1];
    if (tag === 0) break;
    const len = (d[p + 2] << 8) | d[p + 3];
    if (tag === 1 && len === 4 && p + 8 <= d.length) {
      const q = ((d[p + 4] << 24) | (d[p + 5] << 16) | (d[p + 6] << 8) | d[p + 7]) >>> 0;
      meta.properties.push({ label: 'Ducky quality', value: String(q) });
    }
    p += 4 + len;
  }
  meta.properties.push({ label: 'Photoshop Save for Web', value: 'yes (Ducky segment)' });
}

/**
 * Lists the 8BIM resources of a Photoshop image resource block.
 * @param {AppSegment} app
 * @param {ImageMetadata} meta
 */
function photoshop(app, meta) {
  const d = app.data;
  let p = 'Photoshop 3.0\0'.length;
  /** @type {string[]} */
  const names = [];
  while (p + 12 <= d.length && hasAscii(d, p, '8BIM') && names.length < 100) {
    const id = (d[p + 4] << 8) | d[p + 5];
    const nameLen = d[p + 6];
    const nameField = 1 + nameLen + ((1 + nameLen) % 2);
    const sizeAt = p + 6 + nameField;
    if (sizeAt + 4 > d.length) break;
    const size =
      ((d[sizeAt] << 24) | (d[sizeAt + 1] << 16) | (d[sizeAt + 2] << 8) | d[sizeAt + 3]) >>> 0;
    names.push(IRB_NAMES[id] ?? `0x${id.toString(16).padStart(4, '0')}`);
    p = sizeAt + 4 + size + (size % 2);
  }
  meta.properties.push({
    label: 'Photoshop resources',
    value: names.length > 0 ? `${names.length} (${names.join(', ')})` : 'present',
  });
}
