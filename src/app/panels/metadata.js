import { h, factTable } from '../dom.js';
import { toCanvas } from '../viewer.js';
import { resizeBox } from '../../core/raster.js';

/**
 * @typedef {import('../../pipeline/analyze.js').AnalysisResult} AnalysisResult
 * @typedef {import('../../exif/exif.js').ExifField} ExifField
 */

const IFD_TITLES = /** @type {Record<string, string>} */ ({
  ifd0: 'Image (IFD0)',
  exif: 'Exif',
  gps: 'GPS',
  interop: 'Interoperability',
  ifd1: 'Thumbnail (IFD1)',
});

/** Object URLs created for thumbnails; revoked when the panel is rebuilt. */
let urls = /** @type {string[]} */ ([]);

/**
 * EXIF grouped by IFD, GPS, the embedded thumbnail next to the image, XMP, ICC and
 * container properties.
 * @param {AnalysisResult} result
 */
export function metadataPanel(result) {
  for (const url of urls) URL.revokeObjectURL(url);
  urls = [];
  const meta = result.metadata;
  if (!meta) return h('p', { class: 'muted', text: 'No metadata could be read from this file.' });
  const exif = meta.exif;
  return h(
    'div',
    {},
    thumbnailBlock(result),
    exif?.gps &&
      h(
        'div',
        {},
        h('h3', { text: 'Location' }),
        factTable([
          ['Latitude', exif.gps.latitude.toFixed(6)],
          ['Longitude', exif.gps.longitude.toFixed(6)],
          ['Altitude', exif.gps.altitude === null ? '' : `${exif.gps.altitude.toFixed(1)} m`],
          ['GPS time', exif.gps.timestamp ?? ''],
        ]),
        h('p', {
          class: 'muted',
          text: 'Shown as numbers only; Veritas does not load map tiles, so the position is not sent anywhere.',
        }),
      ),
    meta.xmp && [
      h('h3', { text: 'XMP' }),
      factTable([
        ['Creator tool', meta.xmp.creatorTool ?? ''],
        ['Created', meta.xmp.createDate ?? ''],
        ['Modified', meta.xmp.modifyDate ?? ''],
        ['Metadata date', meta.xmp.metadataDate ?? ''],
        ['Document ID', meta.xmp.documentId ?? ''],
        ['Original document', meta.xmp.originalDocumentId ?? ''],
      ]),
      meta.xmp.history.length > 0 &&
        h(
          'table',
          { class: 'data' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { text: 'Action' }),
              h('th', { text: 'Software' }),
              h('th', { text: 'When' }),
            ),
          ),
          h(
            'tbody',
            {},
            meta.xmp.history.map((e) =>
              h(
                'tr',
                {},
                h('td', { text: e.action }),
                h('td', { text: e.softwareAgent }),
                h('td', { text: e.when }),
              ),
            ),
          ),
        ),
    ],
    exif && exifTables(exif.fields, exif.byteOrder),
    !exif && h('p', { class: 'muted', text: 'No EXIF block.' }),
    meta.icc && [
      h('h3', { text: 'ICC profile' }),
      factTable([
        ['Description', meta.icc.description ?? ''],
        ['Version', meta.icc.version],
        ['Class', meta.icc.deviceClass],
        ['Colour space', meta.icc.colorSpace],
        ['Creator', meta.icc.creator],
      ]),
    ],
    (meta.properties.length > 0 || meta.comments.length > 0) && [
      h('h3', { text: 'Container' }),
      factTable([
        ...meta.properties.map((p) => /** @type {[string, string]} */ ([p.label, p.value])),
        ...meta.comments.map((c) => /** @type {[string, string]} */ (['Comment', c])),
      ]),
    ],
  );
}

/**
 * @param {ExifField[]} fields
 * @param {string} byteOrder
 */
function exifTables(fields, byteOrder) {
  const groups = new Map();
  for (const f of fields) {
    if (!groups.has(f.ifd)) groups.set(f.ifd, []);
    groups.get(f.ifd).push(f);
  }
  return [...groups.entries()].map(([ifd, list]) => [
    h('h3', { text: `${IFD_TITLES[ifd] ?? ifd}${ifd === 'ifd0' ? ` (${byteOrder})` : ''}` }),
    h(
      'table',
      { class: 'data' },
      h(
        'tbody',
        {},
        list.map((/** @type {ExifField} */ f) =>
          h('tr', {}, h('th', { text: f.name }), h('td', { text: f.display })),
        ),
      ),
    ),
  ]);
}

/** @param {AnalysisResult} result */
function thumbnailBlock(result) {
  const thumb = result.metadata?.thumbnail;
  if (!thumb) return null;
  const url = URL.createObjectURL(new Blob([new Uint8Array(thumb.bytes)], { type: 'image/jpeg' }));
  urls.push(url);
  const raster = result.raster;
  const current = raster ? resizeBox(raster, thumb.width, thumb.height) : null;
  const cmp = result.thumbnail;
  return h(
    'div',
    {},
    h('h3', { text: 'Embedded thumbnail' }),
    h(
      'div',
      { class: 'thumbs' },
      h(
        'figure',
        {},
        h('img', { attrs: { src: url, alt: 'EXIF thumbnail' } }),
        h('figcaption', {
          text: `Thumbnail ${thumb.width} x ${thumb.height}, quality ${thumb.quality ?? '?'}`,
        }),
      ),
      current &&
        h(
          'figure',
          {},
          toCanvas(current.width, current.height, current.data),
          h('figcaption', { text: 'Image now, same size' }),
        ),
    ),
    cmp &&
      h('p', {
        class: cmp.differs ? '' : 'muted',
        text: !cmp.comparable
          ? 'Different shape from the image, so the content was not compared.'
          : cmp.differs
            ? `Content differs: largest cell difference ${cmp.maxCellDiff.toFixed(0)} levels (limit 25).`
            : `Consistent with the image (largest cell difference ${cmp.maxCellDiff.toFixed(0)} levels).`,
      }),
  );
}
