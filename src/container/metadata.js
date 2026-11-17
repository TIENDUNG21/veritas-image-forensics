import { isParseError } from '../core/errors.js';
import { parseJpeg } from '../jpeg/parser.js';
import { estimateQuality } from '../jpeg/quality.js';

/**
 * Metadata common to every container format, so the UI and report treat JPEG, PNG and
 * WebP the same way.
 * @typedef {{ bytes: Uint8Array, width: number, height: number, quality: number | null }} ThumbnailInfo
 * @typedef {{ label: string, value: string }} Property
 * @typedef {{
 *   container: 'jpeg' | 'png' | 'webp',
 *   exif: import('../exif/exif.js').ExifData | null,
 *   xmp: import('../exif/xmp.js').XmpSummary | null,
 *   icc: import('../exif/icc.js').IccInfo | null,
 *   thumbnail: ThumbnailInfo | null,
 *   comments: string[],
 *   properties: Property[],
 *   warnings: string[]
 * }} ImageMetadata
 */

/**
 * @param {ImageMetadata['container']} container
 * @returns {ImageMetadata}
 */
export function emptyMetadata(container) {
  return {
    container,
    exif: null,
    xmp: null,
    icc: null,
    thumbnail: null,
    comments: [],
    properties: [],
    warnings: [],
  };
}

/**
 * Runs `fn`, turning a ParseError into a warning so one damaged block never hides the rest.
 * @template T
 * @param {ImageMetadata} meta
 * @param {string} what
 * @param {() => T} fn
 * @returns {T | null}
 */
export function attempt(meta, what, fn) {
  try {
    return fn();
  } catch (error) {
    if (!isParseError(error)) throw error;
    meta.warnings.push(`${what}: ${error.message}`);
    return null;
  }
}

/**
 * Size and quality of an embedded JPEG thumbnail.
 * @param {Uint8Array} bytes
 * @returns {ThumbnailInfo | null}
 */
export function describeThumbnail(bytes) {
  const jpeg = parseJpeg(bytes, { tolerant: true });
  if (!jpeg.frame) return null;
  return {
    bytes,
    width: jpeg.frame.width,
    height: jpeg.frame.height,
    quality: estimateQuality(jpeg).quality,
  };
}

/** @param {Uint8Array} bytes */
export function utf8(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}
