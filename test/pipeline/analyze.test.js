import { describe, expect, it } from 'vitest';
import { analyzeImage } from '../../src/pipeline/analyze.js';
import { ParseError } from '../../src/core/errors.js';
import { copyRect, texture } from '../../tools/fixtures/synth.mjs';
import { encodeJpeg } from '../../tools/fixtures/jpeg-writer.mjs';
import { encodePng } from '../../tools/fixtures/png-writer.mjs';
import { TYPE, buildTiff, exifSegment } from '../../tools/fixtures/tiff-builder.mjs';
import { ascii, concat, findMarker } from '../helpers/bytes.js';

/** @typedef {import('../../src/core/raster.js').Raster} Raster */

const W = 320;
const H = 240;
const original = texture(W, H, 41, { cell: 40 });

function cloned() {
  const image = { ...original, data: original.data.slice() };
  copyRect(image, { x: 30, y: 30, w: 64, h: 64 }, image, 200, 140);
  return image;
}

/** @param {string} message */
async function errorOf(/** @type {Promise<unknown>} */ promise, message = 'expected rejection') {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ParseError) return error;
    throw error;
  }
  throw new Error(message);
}

/** @param {Raster} raster */
const fallbackReturning = (raster) => async () => raster;

describe('analyzeImage', () => {
  it('runs every analysis on a baseline JPEG and reports a cloned region', async () => {
    const exif = exifSegment(
      buildTiff({ ifd0: [{ tag: 0x0131, type: TYPE.ASCII, values: 'GIMP 2.10' }] }),
    );
    const bytes = encodeJpeg(cloned(), { quality: 92, segments: [exif] });
    /** @type {string[]} */
    const stages = [];
    const result = await analyzeImage(bytes, {
      name: 'clone.jpg',
      onProgress: (p) => stages.push(p.stage),
    });
    expect(result.file.format.kind).toBe('jpeg');
    expect(result.image).toEqual({ width: W, height: H });
    expect(result.jpeg?.quality.quality).toBe(92);
    expect(result.jpeg?.decoder).toBe('veritas');
    expect(result.layers.ela?.quality).toBe(92);
    expect(result.layers.noise).not.toBeNull();
    expect(result.layers.gradient).not.toBeNull();
    expect(result.layers.copyMove?.pairs[0]).toMatchObject({ dx: 170, dy: 110 });
    expect(result.layers.dct).not.toBeNull();
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain('copy-move');
    expect(ids).toContain('editing-software');
    expect(result.findings[0]?.severity).toBe('warning');
    expect(stages[0]).toBe('Reading file structure');
    expect(stages.at(-1)).toBe('Summarising');
    expect(Object.keys(result.timings)).toContain('copyMove');
  });

  it('runs pixel analyses on a PNG and says the JPEG analyses do not apply', async () => {
    const png = encodePng(original);
    const result = await analyzeImage(png, {
      name: 'image.png',
      decodeFallback: fallbackReturning(original),
    });
    expect(result.jpeg).toBeNull();
    expect(result.layers.dct).toBeNull();
    expect(result.layers.ela).not.toBeNull();
    expect(result.metadata?.container).toBe('png');
    expect(result.notices.join(' ')).toMatch(/need a JPEG file; this file is PNG/);
  });

  it('reports a truncated JPEG instead of failing', async () => {
    const bytes = encodeJpeg(original, { quality: 85 });
    const cut = bytes.subarray(0, Math.floor(bytes.length * 0.6));
    const result = await analyzeImage(cut, { name: 'cut.jpg' });
    expect(result.jpeg?.coefficients?.truncated).toBe(true);
    expect(result.findings.map((f) => f.id)).toContain('truncated');
    expect(result.layers.ela).not.toBeNull();
  });

  it('flags data appended after the end of the image', async () => {
    const bytes = concat(encodeJpeg(original, { quality: 85 }), ascii('PK hidden archive'));
    const result = await analyzeImage(bytes, { name: 'appended.jpg' });
    expect(result.findings.map((f) => f.id)).toContain('appended-data');
  });

  it('falls back to the browser decoder for progressive JPEG and explains why', async () => {
    const bytes = encodeJpeg(original, { quality: 85 }).slice();
    bytes[findMarker(bytes, 0xc0) + 1] = 0xc2;
    const result = await analyzeImage(bytes, {
      name: 'progressive.jpg',
      decodeFallback: fallbackReturning(original),
    });
    expect(result.jpeg?.decoder).toBe('browser');
    expect(result.layers.dct).toBeNull();
    expect(result.notices.join(' ')).toMatch(/progressive/i);
  });

  it('downscales large images to the working limit and says so', async () => {
    const bytes = encodeJpeg(original, { quality: 85 });
    const result = await analyzeImage(bytes, {
      name: 'big.jpg',
      limits: { workingPixels: 20_000 },
    });
    expect(result.working?.scale).toBeLessThan(1);
    expect((result.working?.width ?? 0) * (result.working?.height ?? 0)).toBeLessThanOrEqual(
      20_000,
    );
    expect(result.notices.join(' ')).toMatch(/downscaled/);
  });

  it('rejects empty, unknown, undecodable and oversized input with clear errors', async () => {
    expect((await errorOf(analyzeImage(new Uint8Array(0), { name: 'x' }))).code).toBe('empty');
    expect(
      (await errorOf(analyzeImage(Uint8Array.from(ascii('%PDF-1.7 ......')), { name: 'a.pdf' })))
        .code,
    ).toBe('unsupported-format');
    const heic = Uint8Array.from([0, 0, 0, 24, ...ascii('ftypheic'), 0, 0, 0, 0]);
    const heif = await errorOf(analyzeImage(heic, { name: 'photo.heic' }));
    expect(heif.message).toMatch(/HEIF/);
    const huge = encodeJpeg(original, { quality: 85 }).slice();
    huge.set([0x27, 0x10, 0x27, 0x10], findMarker(huge, 0xc0) + 5); // 10000 x 10000
    expect((await errorOf(analyzeImage(huge, { name: 'huge.jpg' }))).code).toBe('too-large');
    const tooBig = await errorOf(
      analyzeImage(new Uint8Array(100), { name: 'x', limits: { fileBytes: 10 } }),
    );
    expect(tooBig.code).toBe('file-too-large');
  });

  it('notices an EXIF thumbnail that shows different content', async () => {
    const edited = cloned();
    const thumbSource = texture(160, 120, 99, { cell: 20 });
    const thumbnail = encodeJpeg(thumbSource, { quality: 80, sampling: '444' });
    const exif = exifSegment(
      buildTiff({
        ifd0: [{ tag: 0x010f, type: TYPE.ASCII, values: 'Veritas' }],
        ifd1: [{ tag: 0x0103, type: TYPE.SHORT, values: [6] }],
        thumbnail,
      }),
    );
    const result = await analyzeImage(encodeJpeg(edited, { quality: 90, segments: [exif] }), {
      name: 't.jpg',
    });
    expect(result.thumbnail?.differs).toBe(true);
    expect(result.findings.map((f) => f.id)).toContain('thumbnail-content');
  });
});
