import { hasAscii } from '../core/bytes.js';
import { readTiff } from './tiff.js';
import { tagName } from './tags.js';
import { formatValue, gpsToDecimal, numberOf, parseExifDate } from './values.js';

/**
 * @typedef {import('./tiff.js').IfdName} IfdName
 * @typedef {import('./tiff.js').TiffValue} TiffValue
 * @typedef {{ ifd: IfdName, tag: number, name: string, value: TiffValue, display: string }} ExifField
 * @typedef {{
 *   latitude: number, longitude: number, altitude: number | null, timestamp: string | null
 * }} GpsInfo
 * @typedef {{ offset: number, length: number, bytes: Uint8Array }} ExifThumbnail
 *   `offset` is relative to the start of the EXIF payload.
 * @typedef {{
 *   byteOrder: 'little-endian' | 'big-endian', fields: ExifField[], gps: GpsInfo | null,
 *   thumbnail: ExifThumbnail | null, warnings: string[]
 * }} ExifData
 */

/**
 * Parses EXIF metadata. Accepts a JPEG APP1 payload (starting with `Exif\0\0`) or a bare TIFF
 * structure (PNG `eXIf` and WebP `EXIF` chunks).
 * @param {Uint8Array} payload
 * @returns {ExifData}
 */
export function parseExif(payload) {
  const start = hasAscii(payload, 0, 'Exif\0') ? 6 : 0;
  const tiff = readTiff(payload, start);
  /** @type {ExifField[]} */
  const fields = [];
  for (const [ifd, entries] of tiff.ifds) {
    for (const e of entries) {
      const name = tagName(ifd, e.tag);
      fields.push({ ifd, tag: e.tag, name, value: e.value, display: formatValue(name, e.value) });
    }
  }
  /** @type {ExifData} */
  const exif = {
    byteOrder: tiff.littleEndian ? 'little-endian' : 'big-endian',
    fields,
    gps: null,
    thumbnail: null,
    warnings: tiff.warnings,
  };
  exif.gps = readGps(exif);
  exif.thumbnail = readThumbnail(exif, payload, start);
  return exif;
}

/**
 * First field with this name (main-image IFDs are searched before IFD1).
 * @param {ExifData} exif
 * @param {string} name
 * @param {IfdName} [ifd]
 */
export function exifField(exif, name, ifd) {
  return exif.fields.find((f) => f.name === name && (ifd === undefined || f.ifd === ifd));
}

/**
 * @param {ExifData} exif
 * @param {string} name
 */
export function exifText(exif, name) {
  const v = exifField(exif, name)?.value;
  return typeof v === 'string' ? v : null;
}

/**
 * @param {ExifData} exif
 * @returns {GpsInfo | null}
 */
function readGps(exif) {
  const get = (/** @type {string} */ name) => exifField(exif, name, 'gps')?.value;
  const latRef = get('GPSLatitudeRef');
  const lonRef = get('GPSLongitudeRef');
  const latitude = gpsToDecimal(typeof latRef === 'string' ? latRef : 'N', get('GPSLatitude'));
  const longitude = gpsToDecimal(typeof lonRef === 'string' ? lonRef : 'E', get('GPSLongitude'));
  if (latitude === null || longitude === null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    exif.warnings.push('GPS coordinates are out of range');
    return null;
  }
  const alt = numberOf(get('GPSAltitude'));
  const below = numberOf(get('GPSAltitudeRef')) === 1;
  const date = get('GPSDateStamp');
  const time = exifField(exif, 'GPSTimeStamp', 'gps')?.display;
  const timestamp =
    typeof date === 'string' && time && /^\d\d:\d\d:\d\d$/.test(time)
      ? parseExifDate(`${date} ${time}`)
      : null;
  return {
    latitude,
    longitude,
    altitude: alt === null ? null : below ? -alt : alt,
    timestamp: timestamp ? `${timestamp}Z` : null,
  };
}

/**
 * The JPEG thumbnail referenced by IFD1, bounds-checked.
 * @param {ExifData} exif
 * @param {Uint8Array} payload
 * @param {number} start TIFF start inside the payload.
 * @returns {ExifThumbnail | null}
 */
function readThumbnail(exif, payload, start) {
  const offset = numberOf(exifField(exif, 'JPEGInterchangeFormat', 'ifd1')?.value);
  const length = numberOf(exifField(exif, 'JPEGInterchangeFormatLength', 'ifd1')?.value);
  if (offset === null || length === null || length === 0) return null;
  const from = start + offset;
  if (from + length > payload.length) {
    exif.warnings.push('the embedded thumbnail lies outside the EXIF data');
    return null;
  }
  const bytes = payload.slice(from, from + length);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    exif.warnings.push('the embedded thumbnail is not a JPEG');
    return null;
  }
  return { offset: from, length, bytes };
}
