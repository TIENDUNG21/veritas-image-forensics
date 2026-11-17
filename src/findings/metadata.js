import { exifField, exifText } from '../exif/exif.js';
import { numberOf, parseExifDate } from '../exif/values.js';
import { humanDuration } from './finding.js';

/**
 * @typedef {import('./finding.js').Finding} Finding
 * @typedef {import('../container/metadata.js').ImageMetadata} ImageMetadata
 */

/** Programs whose name in the metadata means the file was re-saved by an image editor. */
const EDITORS =
  /photoshop|lightroom|camera raw|gimp|affinity|pixelmator|paint\.net|snapseed|canva|photopea|krita|corel|paintshop|picsart|luminar|capture one|darktable|rawtherapee|acdsee|fotor|facetune|meitu|vsco|photoscape|imagemagick|graphicsmagick|photos? editor/i;

/** Clock differences up to this many seconds are treated as the same moment. */
const DATE_TOLERANCE_S = 60;

/**
 * Derives findings from metadata alone.
 * @param {ImageMetadata} meta
 * @param {{ width: number, height: number }} image Dimensions of the main image.
 * @returns {Finding[]}
 */
export function metadataFindings(meta, image) {
  /** @type {Finding[]} */
  const out = [];
  software(meta, out);
  dates(meta, out);
  if (meta.container === 'jpeg' && !meta.exif) {
    out.push({
      id: 'no-exif',
      severity: 'info',
      title: 'No camera metadata',
      detail:
        'The file has no EXIF block. Editors, screenshots and many upload services remove it, so its absence says the file is not straight from a camera, not what changed.',
    });
  }
  thumbnailShape(meta, image, out);
  exifDimensions(meta, image, out);
  if (meta.xmp && meta.xmp.history.length > 0) {
    const actions = meta.xmp.history.map((e) => e.action);
    out.push({
      id: 'xmp-history',
      severity: 'info',
      title: `Editing history: ${meta.xmp.history.length} event(s)`,
      detail: `XMP history records: ${actions.join(', ')}.`,
    });
  }
  if (meta.xmp?.derivedFrom) {
    out.push({
      id: 'derived',
      severity: 'notice',
      title: 'Derived from another document',
      detail: 'XMP DerivedFrom is present: an editor created this file from another one.',
    });
  }
  if (meta.exif?.gps) {
    const { latitude, longitude } = meta.exif.gps;
    out.push({
      id: 'gps',
      severity: 'info',
      title: 'GPS location embedded',
      detail: `Latitude ${latitude.toFixed(5)}, longitude ${longitude.toFixed(5)}. Anyone with the file can read this.`,
    });
  }
  return out;
}

/**
 * @param {ImageMetadata} meta
 * @param {Finding[]} out
 */
function software(meta, out) {
  /** @type {string[]} */
  const names = [];
  const add = (/** @type {string | null | undefined} */ s) => {
    if (s && s.trim() && !names.includes(s.trim())) names.push(s.trim());
  };
  if (meta.exif) add(exifText(meta.exif, 'Software'));
  add(meta.xmp?.creatorTool);
  for (const e of meta.xmp?.history ?? []) add(e.softwareAgent);
  add(meta.properties.find((p) => p.label === 'Software')?.value);
  const editors = names.filter((n) => EDITORS.test(n));
  if (editors.length > 0) {
    out.push({
      id: 'editing-software',
      severity: 'notice',
      title: 'Saved by editing software',
      detail: `Metadata names ${editors.join('; ')}. The file was re-saved by an editor; this alone does not show what, if anything, was changed.`,
    });
  } else if (names.length > 0) {
    out.push({
      id: 'software',
      severity: 'info',
      title: 'Software recorded',
      detail: `Metadata names ${names.join('; ')}.`,
    });
  }
}

/**
 * @param {ImageMetadata} meta
 * @param {Finding[]} out
 */
function dates(meta, out) {
  const exif = meta.exif;
  let created = null;
  let modified = null;
  if (exif) {
    created = parseExifDate(exifText(exif, 'DateTimeOriginal') ?? '');
    modified = parseExifDate(exifText(exif, 'DateTime') ?? '');
  }
  if ((!created || !modified) && meta.xmp) {
    created = created ?? meta.xmp.createDate;
    modified = modified ?? meta.xmp.modifyDate;
  }
  if (!created || !modified) return;
  const a = Date.parse(stripZone(created));
  const b = Date.parse(stripZone(modified));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return;
  const diff = (b - a) / 1000;
  if (diff > DATE_TOLERANCE_S) {
    out.push({
      id: 'modified-after-capture',
      severity: 'notice',
      title: 'Modified after capture',
      detail: `Created ${created}, last written ${modified} (${humanDuration(diff)} later).`,
    });
  } else if (diff < -DATE_TOLERANCE_S) {
    out.push({
      id: 'dates-inconsistent',
      severity: 'notice',
      title: 'Modification date is before capture date',
      detail: `Created ${created}, modified ${modified}: the clock or the metadata was changed.`,
    });
  }
}

/**
 * Compares local times only (EXIF dates usually have no zone).
 * @param {string} iso
 */
function stripZone(iso) {
  return iso.slice(0, 19);
}

/**
 * @param {ImageMetadata} meta
 * @param {{ width: number, height: number }} image
 * @param {Finding[]} out
 */
function thumbnailShape(meta, image, out) {
  const t = meta.thumbnail;
  if (!t || !t.width || !t.height || !image.width || !image.height) return;
  const thumb = t.width / t.height;
  const main = image.width / image.height;
  const rotated = image.height / image.width;
  const off = Math.min(Math.abs(thumb - main) / main, Math.abs(thumb - rotated) / rotated);
  if (off > 0.02) {
    out.push({
      id: 'thumbnail-shape',
      severity: 'warning',
      title: 'Thumbnail shape differs from the image',
      detail: `The embedded thumbnail is ${t.width} x ${t.height} but the image is ${image.width} x ${image.height}: the image was probably cropped after the thumbnail was written. (Some cameras pad thumbnails with bars; compare them in the Metadata tab.)`,
    });
  }
}

/**
 * @param {ImageMetadata} meta
 * @param {{ width: number, height: number }} image
 * @param {Finding[]} out
 */
function exifDimensions(meta, image, out) {
  if (!meta.exif) return;
  const w = numberOf(exifField(meta.exif, 'PixelXDimension')?.value);
  const h = numberOf(exifField(meta.exif, 'PixelYDimension')?.value);
  if (!w || !h) return;
  const same =
    (w === image.width && h === image.height) || (w === image.height && h === image.width);
  if (!same) {
    out.push({
      id: 'exif-dimensions',
      severity: 'notice',
      title: 'Dimensions differ from EXIF',
      detail: `EXIF records ${w} x ${h} but the image is ${image.width} x ${image.height}: it was resized or cropped after the metadata was written.`,
    });
  }
}
