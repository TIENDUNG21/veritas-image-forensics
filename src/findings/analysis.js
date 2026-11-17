/**
 * Findings derived from the structure and pixel analyses (metadata findings live in
 * metadata.js). Wording states what was measured and what it usually means, never more.
 *
 * @typedef {import('./finding.js').Finding} Finding
 * @typedef {import('../core/regions.js').Region} Region
 * @typedef {import('../pipeline/analyze.js').JpegReport} JpegReport
 * @typedef {import('../pipeline/analyze.js').AnalysisLayers} AnalysisLayers
 * @typedef {import('../analysis/thumbnail.js').ThumbnailComparison} ThumbnailComparison
 */

/** @param {Region} r */
const where = (r) => `at (${r.x}, ${r.y}), ${r.w} x ${r.h} px`;

/**
 * @param {{ jpeg: JpegReport | null, layers: AnalysisLayers, thumbnail: ThumbnailComparison | null }} input
 * @returns {Finding[]}
 */
export function analysisFindings({ jpeg, layers, thumbnail }) {
  /** @type {Finding[]} */
  const out = [];
  if (jpeg) jpegFindings(jpeg, out);

  const dct = layers.dct;
  if (dct?.likely) {
    out.push({
      id: 'double-compression',
      severity: 'notice',
      title: 'Saved as JPEG at least twice',
      detail:
        dct.primaryQuality !== null
          ? `The DCT histograms show the comb pattern of an earlier save at quality about ${dct.primaryQuality}.`
          : 'The DCT histograms show the comb pattern of an earlier, stronger compression.',
      layer: 'dct',
    });
    const first = dct.regions[0];
    if (first) {
      out.push({
        id: 'dct-inconsistent',
        severity: 'warning',
        title: `${dct.regions.length} region(s) with a different compression history`,
        detail: `The largest is ${where(first)}. Its blocks were compressed once while the rest was compressed twice, which is what an area pasted or retouched between the two saves looks like.`,
        layer: 'dct',
      });
    }
  }

  const ela = layers.ela;
  const hot = ela?.hotspots[0];
  if (ela && hot) {
    out.push({
      id: 'ela-hotspot',
      severity: 'notice',
      title: 'Error level hotspot',
      detail: `A region ${where(hot)} changes ${hot.score.toFixed(1)}x more than the rest when re-saved at quality ${ela.quality}. Content added after the last save behaves like this; so can strong edges and fine texture.`,
      layer: 'ela',
    });
  }

  const noisy = layers.noise?.regions[0];
  if (noisy) {
    const direction = noisy.score > 1 ? 'more' : 'less';
    const factor = noisy.score > 1 ? noisy.score : 1 / noisy.score;
    out.push({
      id: 'noise-inconsistent',
      severity: 'notice',
      title: 'Inconsistent noise level',
      detail: `A region ${where(noisy)} has about ${factor.toFixed(1)}x ${direction} noise than the rest of the image. Pasted, blurred or retouched areas often differ in noise; so do out-of-focus areas.`,
      layer: 'noise',
    });
  }

  const clone = layers.copyMove?.pairs[0];
  if (clone) {
    out.push({
      id: 'copy-move',
      severity: 'warning',
      title: 'Duplicated region (copy-move)',
      detail: `The area ${where(clone.source)} is repeated ${where(clone.target)}, shifted by (${clone.dx}, ${clone.dy}) px. Cloning is used to hide or duplicate objects; very regular textures (tiles, bricks) can also match.`,
      layer: 'copymove',
    });
  }

  if (thumbnail?.differs && thumbnail.region) {
    out.push({
      id: 'thumbnail-content',
      severity: 'warning',
      title: 'Embedded thumbnail shows different content',
      detail: `The EXIF thumbnail differs from the image most strongly ${where(thumbnail.region)}. The image was changed after the thumbnail was written, and the thumbnail may show the earlier version (see the Metadata tab).`,
    });
  }
  return out;
}

/**
 * @param {JpegReport} jpeg
 * @param {Finding[]} out
 */
function jpegFindings(jpeg, out) {
  const s = jpeg.structure;
  if (s.trailingBytes > 0) {
    out.push({
      id: 'appended-data',
      severity: 'notice',
      title: 'Data after the end of the image',
      detail: `${s.trailingBytes} byte(s) follow the end-of-image marker. Some programs append a second image or other data; it can also hide a file inside the picture.`,
    });
  }
  const c = jpeg.coefficients;
  if (c?.truncated || s.eoiOffset < 0) {
    out.push({
      id: 'truncated',
      severity: 'notice',
      title: 'File is truncated or damaged',
      detail: c
        ? `Only ${c.mcusDecoded} of ${c.mcusTotal} blocks of image data could be decoded; the rest is shown grey.`
        : 'The end-of-image marker is missing.',
    });
  }
  const q = jpeg.quality;
  if (q.quality !== null) {
    out.push(
      q.standard
        ? {
            id: 'ijg-tables',
            severity: 'info',
            title: `JPEG quality ${q.quality}${q.exact ? '' : ' (approximate)'}`,
            detail: `The quantization tables ${q.exact ? 'match' : 'are close to'} the IJG (libjpeg) standard tables at quality ${q.quality}. Many programs use these tables when they save a JPEG; many cameras use their own.`,
          }
        : {
            id: 'custom-tables',
            severity: 'info',
            title: 'Custom quantization tables',
            detail: `The tables are not the IJG standard (closest: quality ${q.quality}). Cameras and some editors use their own tables.`,
          },
    );
  }
}
