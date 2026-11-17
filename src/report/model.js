/**
 * Report model: everything an analysis found, as plain JSON (no typed arrays, no file
 * bytes). The JSON export is this object; the HTML export renders it with layer images.
 *
 * @typedef {import('../pipeline/analyze.js').AnalysisResult} AnalysisResult
 * @typedef {import('../core/regions.js').Region} Region
 * @typedef {{ id: string, label: string, dataUrl: string }} ReportImage
 * @typedef {ReturnType<typeof buildReport>} ReportModel
 */

/** Kept in step with package.json by test/report/report.test.js. */
export const VERSION = '1.0.0';
export const SCHEMA = 'veritas-report/1';

/**
 * @param {AnalysisResult} result
 * @param {{ images?: ReportImage[], generatedAt?: string }} [options]
 */
export function buildReport(result, { images = [], generatedAt = new Date().toISOString() } = {}) {
  const { jpeg, metadata: meta, layers } = result;
  const s = jpeg?.structure;
  return {
    schema: SCHEMA,
    generator: { name: 'Veritas Image Forensics', version: VERSION },
    generatedAt,
    file: {
      name: result.file.name,
      size: result.file.size,
      format: result.file.format.label,
      mime: result.file.format.mime,
      width: result.image?.width ?? null,
      height: result.image?.height ?? null,
    },
    analysedSize: result.working
      ? {
          width: result.working.width,
          height: result.working.height,
          scale: round(result.working.scale, 4),
        }
      : null,
    findings: result.findings.map((f) => ({
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      id: f.id,
      layer: f.layer ?? null,
    })),
    notices: [...result.notices],
    jpeg:
      jpeg && s
        ? {
            decoder: jpeg.decoder,
            coding: s.frame?.type ?? null,
            sampling: s.frame?.components.map((c) => `${c.id}:${c.h}x${c.v}`).join(' ') ?? null,
            quality: jpeg.quality.quality,
            qualityExact: jpeg.quality.exact,
            standardTables: jpeg.quality.standard,
            quantTables: s.quantTables.map((t) => ({ id: t.id, values: [...t.values] })),
            trailingBytes: s.trailingBytes,
            warnings: [...s.warnings, ...(jpeg.coefficients?.warnings ?? [])],
            segments: s.segments.map((seg) => ({ ...seg })),
          }
        : null,
    doubleCompression: layers.dct
      ? {
          likely: layers.dct.likely,
          score: round(layers.dct.score, 3),
          primaryQuality: layers.dct.primaryQuality,
          regions: layers.dct.regions.map(region),
        }
      : null,
    ela: layers.ela
      ? {
          quality: layers.ela.quality,
          mean: round(layers.ela.mean, 2),
          max: round(layers.ela.max, 2),
          uniform: layers.ela.uniform,
          hotspots: layers.ela.hotspots.map(region),
        }
      : null,
    noise: layers.noise
      ? {
          sigma: round(layers.noise.globalSigma, 3),
          reliable: layers.noise.reliable,
          regions: layers.noise.regions.map(region),
        }
      : null,
    copyMove: layers.copyMove
      ? {
          blocksAnalysed: layers.copyMove.blocksAnalysed,
          pairs: layers.copyMove.pairs.map((p) => ({
            dx: p.dx,
            dy: p.dy,
            votes: p.votes,
            source: region(p.source),
            target: region(p.target),
          })),
        }
      : null,
    thumbnail: result.thumbnail
      ? {
          comparable: result.thumbnail.comparable,
          differs: result.thumbnail.differs,
          maxCellDiff: round(result.thumbnail.maxCellDiff, 1),
          region: result.thumbnail.region ? region(result.thumbnail.region) : null,
        }
      : null,
    metadata: meta
      ? {
          container: meta.container,
          exif:
            meta.exif?.fields.map((f) => ({
              ifd: f.ifd,
              tag: f.tag,
              name: f.name,
              value: f.display,
            })) ?? [],
          gps: meta.exif?.gps ? { ...meta.exif.gps } : null,
          xmp: meta.xmp
            ? {
                creatorTool: meta.xmp.creatorTool,
                createDate: meta.xmp.createDate,
                modifyDate: meta.xmp.modifyDate,
                documentId: meta.xmp.documentId,
                originalDocumentId: meta.xmp.originalDocumentId,
                history: meta.xmp.history.map((e) => ({ ...e })),
              }
            : null,
          icc: meta.icc ? { ...meta.icc } : null,
          properties: meta.properties.map((p) => ({ ...p })),
          comments: [...meta.comments],
          thumbnail: meta.thumbnail
            ? {
                width: meta.thumbnail.width,
                height: meta.thumbnail.height,
                quality: meta.thumbnail.quality,
              }
            : null,
        }
      : null,
    timings: { ...result.timings },
    images: images.filter((i) => isImageDataUrl(i.dataUrl)),
  };
}

/**
 * Only inline PNG or JPEG data URLs reach the HTML report; anything else (a URL, SVG, a
 * value with quotes) is dropped.
 * @param {string} url
 */
export function isImageDataUrl(url) {
  return /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(url);
}

/** @param {Region} r */
function region(r) {
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

/**
 * @param {number} v
 * @param {number} digits
 */
function round(v, digits) {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
