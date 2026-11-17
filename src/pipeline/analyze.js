import { ParseError, isParseError } from '../core/errors.js';
import { sniffFormat } from '../core/format.js';
import { MAX_DECODE_PIXELS, MAX_FILE_BYTES, MAX_WORKING_PIXELS } from '../core/limits.js';
import { downscaleToFit } from '../core/raster.js';
import { readJpegMetadata } from '../container/jpeg.js';
import { readPng } from '../container/png.js';
import { readWebp } from '../container/webp.js';
import { decodeCoefficients } from '../jpeg/coefficients.js';
import { decodeJpeg } from '../jpeg/decode.js';
import { analyzeDoubleCompression } from '../jpeg/double.js';
import { parseJpeg } from '../jpeg/parser.js';
import { estimateQuality } from '../jpeg/quality.js';
import { errorLevel } from '../analysis/ela.js';
import { noiseMap } from '../analysis/noise.js';
import { luminanceGradient } from '../analysis/gradient.js';
import { detectCopyMove } from '../analysis/copymove.js';
import { compareThumbnail } from '../analysis/thumbnail.js';
import { metadataFindings } from '../findings/metadata.js';
import { analysisFindings } from '../findings/analysis.js';
import { sortFindings } from '../findings/finding.js';

/**
 * @typedef {import('../core/raster.js').Raster} Raster
 * @typedef {import('../core/format.js').FormatInfo} FormatInfo
 * @typedef {import('../container/metadata.js').ImageMetadata} ImageMetadata
 * @typedef {import('../jpeg/parser.js').JpegStructure} JpegStructure
 * @typedef {import('../jpeg/coefficients.js').CoefficientData} CoefficientData
 * @typedef {import('../findings/finding.js').Finding} Finding
 * @typedef {{ stage: string, index: number, total: number }} Progress
 * @typedef {(bytes: Uint8Array, mime: string, maxSide: number) => Promise<Raster>} FallbackDecoder
 *   Decodes formats the project's own decoder does not handle (the browser's decoder in the
 *   app). `maxSide` lets it shrink very large images while decoding.
 * @typedef {{
 *   segments: { name: string, offset: number, length: number }[],
 *   frame: JpegStructure['frame'],
 *   quantTables: { id: number, precision: number, values: number[] }[],
 *   huffmanTables: number, scans: number, restartInterval: number,
 *   app: { name: string, label: string, offset: number, length: number }[],
 *   comments: string[], eoiOffset: number, trailingBytes: number, warnings: string[],
 *   error: JpegStructure['error']
 * }} StructureSummary
 * @typedef {{
 *   structure: StructureSummary,
 *   quality: import('../jpeg/quality.js').QualityEstimate,
 *   coefficients: { mcusDecoded: number, mcusTotal: number, truncated: boolean, warnings: string[] } | null,
 *   decoder: 'veritas' | 'browser' | 'none'
 * }} JpegReport
 * @typedef {{
 *   ela: import('../analysis/ela.js').ElaResult | null,
 *   noise: import('../analysis/noise.js').NoiseResult | null,
 *   gradient: import('../analysis/gradient.js').GradientResult | null,
 *   copyMove: import('../analysis/copymove.js').CopyMoveResult | null,
 *   dct: import('../jpeg/double.js').DoubleCompressionResult | null
 * }} AnalysisLayers
 * @typedef {{
 *   file: { name: string, size: number, format: FormatInfo },
 *   image: { width: number, height: number } | null,
 *   working: { width: number, height: number, scale: number } | null,
 *   raster: Raster | null,
 *   jpeg: JpegReport | null,
 *   metadata: ImageMetadata | null,
 *   layers: AnalysisLayers,
 *   thumbnail: import('../analysis/thumbnail.js').ThumbnailComparison | null,
 *   findings: Finding[],
 *   notices: string[],
 *   timings: Record<string, number>
 * }} AnalysisResult
 *   `raster` is the working copy the pixel layers were computed on.
 * @typedef {{ fileBytes?: number, decodePixels?: number, workingPixels?: number }} Limits
 * @typedef {{
 *   name: string,
 *   decodeFallback?: FallbackDecoder,
 *   onProgress?: (p: Progress) => void,
 *   elaQuality?: number,
 *   limits?: Limits
 * }} AnalyzeOptions
 */

const STAGES = [
  'Reading file structure',
  'Decoding pixels',
  'Error level analysis',
  'Noise map',
  'Luminance gradient',
  'Copy-move detection',
  'DCT histograms',
  'Summarising',
];

/**
 * Runs every analysis on one image file. Pure apart from the injected fallback decoder, so
 * it runs unchanged in Node (tests) and in the Web Worker (app).
 *
 * Input problems that make analysis impossible (empty file, unknown or undecodable format,
 * size limits) throw `ParseError`. Everything else degrades: a damaged part becomes a
 * notice and the remaining analyses still run.
 *
 * @param {Uint8Array} bytes
 * @param {AnalyzeOptions} options
 * @returns {Promise<AnalysisResult>}
 */
export async function analyzeImage(bytes, options) {
  const limits = {
    fileBytes: options.limits?.fileBytes ?? MAX_FILE_BYTES,
    decodePixels: options.limits?.decodePixels ?? MAX_DECODE_PIXELS,
    workingPixels: options.limits?.workingPixels ?? MAX_WORKING_PIXELS,
  };
  if (bytes.length === 0) throw new ParseError('empty', 'the file is empty');
  if (bytes.length > limits.fileBytes) {
    throw new ParseError(
      'file-too-large',
      `the file is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is ${(limits.fileBytes / 1048576).toFixed(0)} MB`,
    );
  }
  const format = sniffFormat(bytes);
  /** @type {Record<string, number>} */
  const timings = {};
  let stage = 0;
  /**
   * @template T
   * @param {string} key
   * @param {() => T} fn
   * @returns {T}
   */
  const timed = (key, fn) => {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      timings[key] = Math.round(performance.now() - t0);
    }
  };
  const progress = () =>
    options.onProgress?.({ stage: STAGES[stage], index: stage++, total: STAGES.length });

  /** @type {AnalysisResult} */
  const result = {
    file: { name: options.name, size: bytes.length, format },
    image: null,
    working: null,
    raster: null,
    jpeg: null,
    metadata: null,
    layers: { ela: null, noise: null, gradient: null, copyMove: null, dct: null },
    thumbnail: null,
    findings: [],
    notices: [],
    timings,
  };

  // 1. Structure and metadata.
  progress();
  /** @type {JpegStructure | null} */
  let jpeg = null;
  timed('structure', () => {
    if (format.kind === 'jpeg') {
      jpeg = parseJpeg(bytes, { tolerant: true });
      result.metadata = readJpegMetadata(jpeg);
      if (jpeg.frame) result.image = { width: jpeg.frame.width, height: jpeg.frame.height };
      if (jpeg.error) result.notices.push(`JPEG structure: ${jpeg.error.message}`);
    } else if (format.kind === 'png') {
      const { info, meta } = readPng(bytes);
      result.metadata = meta;
      result.image = { width: info.width, height: info.height };
    } else if (format.kind === 'webp') {
      const { info, meta } = readWebp(bytes);
      result.metadata = meta;
      if (info.width > 0) result.image = { width: info.width, height: info.height };
    } else if (format.kind === 'heif' || format.kind === 'tiff') {
      throw new ParseError(
        'unsupported-format',
        `${format.label} files cannot be decoded in the browser; convert the image to JPEG or PNG first`,
      );
    } else if (format.kind === 'unknown') {
      throw new ParseError('unsupported-format', 'this is not an image format Veritas can read');
    } else {
      result.notices.push(
        `Metadata is read from JPEG, PNG and WebP files; this file is ${format.label}.`,
      );
    }
  });
  if (format.kind !== 'jpeg') {
    result.notices.push(
      `JPEG quality, quantization tables and double-compression analysis need a JPEG file; this file is ${format.label}.`,
    );
  }
  if (result.image && result.image.width * result.image.height > limits.decodePixels) {
    throw new ParseError(
      'too-large',
      `${result.image.width} x ${result.image.height} pixels is above the ${(limits.decodePixels / 1e6).toFixed(0)} MP limit`,
    );
  }

  // 2. Pixels (own decoder for sequential JPEG, browser otherwise).
  progress();
  /** @type {CoefficientData | null} */
  let coefficients = null;
  /** @type {Raster | null} */
  let raster = null;
  const parsed = /** @type {JpegStructure | null} */ (jpeg);
  if (parsed) {
    result.jpeg = {
      structure: summarize(parsed),
      quality: estimateQuality(parsed),
      coefficients: null,
      decoder: 'none',
    };
    const report = result.jpeg;
    const own = timed('decode', () => {
      try {
        const data = decodeCoefficients(parsed, { maxPixels: limits.decodePixels });
        report.coefficients = {
          mcusDecoded: data.mcusDecoded,
          mcusTotal: data.mcusTotal,
          truncated: data.truncated,
          warnings: data.warnings,
        };
        return { data, raster: decodeJpeg(parsed, { coefficients: data }) };
      } catch (error) {
        if (!isParseError(error) || error.code === 'too-large') throw error;
        result.notices.push(
          `Veritas' own decoder cannot read this file (${error.message}); the browser decoder is used, and DCT-based analysis is unavailable.`,
        );
        return null;
      }
    });
    if (own) {
      coefficients = own.data;
      raster = own.raster;
      report.decoder = 'veritas';
    }
  }
  if (!raster) {
    if (!options.decodeFallback) {
      result.notices.push('No decoder is available for this file; pixel analyses were skipped.');
    } else {
      const side = Math.ceil(Math.sqrt(limits.workingPixels * 2));
      const fallback = options.decodeFallback;
      raster = await fallback(bytes, format.mime, side).catch((error) => {
        result.notices.push(
          `The image could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      });
      if (raster && result.jpeg) result.jpeg.decoder = 'browser';
    }
  }

  if (raster) {
    result.image = result.image ?? { width: raster.width, height: raster.height };
    const fit = downscaleToFit(raster, limits.workingPixels);
    const working = fit.raster;
    result.raster = working;
    result.working = {
      width: working.width,
      height: working.height,
      scale: working.width / result.image.width,
    };
    if (result.working.scale < 0.999) {
      result.notices.push(
        `Large image: analyses ran on a copy downscaled to ${working.width} x ${working.height}. ELA and noise maps are approximate because the 8x8 JPEG grid no longer lines up.`,
      );
    }
    const elaQuality =
      options.elaQuality ??
      (result.jpeg?.quality.standard && result.jpeg.quality.quality
        ? result.jpeg.quality.quality
        : 90);

    progress();
    result.layers.ela = timed('ela', () => errorLevel(working, { quality: elaQuality }));
    progress();
    result.layers.noise = timed('noise', () => noiseMap(working));
    progress();
    result.layers.gradient = timed('gradient', () => luminanceGradient(working));
    progress();
    result.layers.copyMove = timed('copyMove', () => detectCopyMove(working));
    const thumb = result.metadata?.thumbnail;
    if (thumb) {
      result.thumbnail = timed('thumbnail', () => {
        try {
          return compareThumbnail(decodeJpeg(thumb.bytes), working);
        } catch (error) {
          if (!isParseError(error)) throw error;
          result.notices.push(`The EXIF thumbnail could not be decoded: ${error.message}`);
          return null;
        }
      });
    }
  } else {
    stage += 4;
  }

  progress();
  const luma = coefficients?.components[0];
  if (luma) result.layers.dct = timed('dct', () => analyzeDoubleCompression(luma));
  else if (result.jpeg && format.kind === 'jpeg' && result.jpeg.decoder !== 'veritas') {
    result.notices.push(
      'Double-compression analysis needs a baseline (sequential) JPEG; this one is progressive or uses an unsupported coding.',
    );
  }

  progress();
  if (result.working && result.working.scale < 0.999)
    toImagePixels(result, 1 / result.working.scale);
  const dims = result.image ?? { width: 0, height: 0 };
  result.findings = sortFindings([
    ...(result.metadata ? metadataFindings(result.metadata, dims) : []),
    ...analysisFindings({ jpeg: result.jpeg, layers: result.layers, thumbnail: result.thumbnail }),
  ]);
  if (result.metadata)
    result.notices.push(...result.metadata.warnings.map((w) => `Metadata: ${w}`));
  return result;
}

/**
 * Pixel analyses run on the (possibly downscaled) working copy; every reported rectangle
 * and shift is converted to full-image pixels so findings and the report quote positions
 * in the file's own coordinates. Maps stay at working resolution.
 * @param {AnalysisResult} result
 * @param {number} k Full-image pixels per working pixel.
 */
function toImagePixels(result, k) {
  /** @param {import('../core/regions.js').Region} r */
  const scale = (r) => {
    r.x = Math.round(r.x * k);
    r.y = Math.round(r.y * k);
    r.w = Math.round(r.w * k);
    r.h = Math.round(r.h * k);
  };
  result.layers.ela?.hotspots.forEach(scale);
  result.layers.noise?.regions.forEach(scale);
  for (const pair of result.layers.copyMove?.pairs ?? []) {
    pair.dx = Math.round(pair.dx * k);
    pair.dy = Math.round(pair.dy * k);
    scale(pair.source);
    scale(pair.target);
  }
  if (result.thumbnail?.region) scale(result.thumbnail.region);
}

/**
 * JSON-friendly summary of the marker structure (no views into the file).
 * @param {JpegStructure} jpeg
 * @returns {StructureSummary}
 */
function summarize(jpeg) {
  return {
    segments: jpeg.segments
      .slice(0, 500)
      .map((s) => ({ name: s.name, offset: s.offset, length: s.length })),
    frame: jpeg.frame,
    quantTables: jpeg.quantTables
      .filter((t) => t !== undefined)
      .map((t) => ({ id: t.id, precision: t.precision, values: [...t.values] })),
    huffmanTables: jpeg.huffmanTables.length,
    scans: jpeg.scans.length,
    restartInterval: jpeg.restartInterval,
    app: jpeg.app.map((a) => ({
      name: `APP${a.marker - 0xe0}`,
      label: a.label,
      offset: a.offset,
      length: a.length,
    })),
    comments: jpeg.comments,
    eoiOffset: jpeg.eoiOffset,
    trailingBytes: jpeg.trailingBytes,
    warnings: jpeg.warnings,
    error: jpeg.error,
  };
}
