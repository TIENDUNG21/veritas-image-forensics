import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeImage } from '../../src/pipeline/analyze.js';
import { VERSION, buildReport, isImageDataUrl } from '../../src/report/model.js';
import { escapeHtml, renderReportHtml } from '../../src/report/html.js';
import { copyRect, texture } from '../../tools/fixtures/synth.mjs';
import { encodeJpeg } from '../../tools/fixtures/jpeg-writer.mjs';
import { TYPE, buildTiff, exifSegment } from '../../tools/fixtures/tiff-builder.mjs';
import { concat } from '../helpers/bytes.js';

/** @typedef {import('../../src/pipeline/analyze.js').AnalysisResult} AnalysisResult */

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==';
const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(2)>';

/** @type {AnalysisResult} */
let result;

beforeAll(async () => {
  const image = texture(320, 240, 7, { cell: 40 });
  copyRect(image, { x: 30, y: 30, w: 64, h: 64 }, image, 200, 140);
  const jpeg = encodeJpeg(image, { quality: 92 });
  // Insert an EXIF block whose Software tag carries markup, right after SOI.
  const exif = exifSegment(
    buildTiff({ ifd0: [{ tag: 0x0131, type: TYPE.ASCII, values: HOSTILE }] }),
  );
  result = await analyzeImage(concat(jpeg.subarray(0, 2), exif, jpeg.subarray(2)), {
    name: `${HOSTILE}.jpg`,
  });
});

describe('buildReport', () => {
  it('summarises the analysis as plain JSON', () => {
    const model = buildReport(result, { generatedAt: '2026-11-17T00:00:00.000Z' });
    const json = JSON.parse(JSON.stringify(model));
    expect(json).toEqual(model);
    expect(model.file.width).toBe(320);
    expect(model.jpeg?.quality).toBe(92);
    expect(model.copyMove?.pairs.length).toBeGreaterThan(0);
    expect(model.metadata?.exif.some((f) => f.name === 'Software')).toBe(true);
    expect(model.findings.length).toBe(result.findings.length);
  });

  it('keeps only well-formed PNG and JPEG data URLs', () => {
    const model = buildReport(result, {
      images: [
        { id: 'ela', label: 'ELA', dataUrl: PNG_1X1 },
        { id: 'bad', label: 'bad', dataUrl: 'https://example.com/x.png' },
        { id: 'bad2', label: 'bad', dataUrl: 'data:image/png;base64,AA" onload="x' },
      ],
    });
    expect(model.images.map((i) => i.id)).toEqual(['ela']);
    expect(isImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isImageDataUrl('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
  });

  it('carries the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });
});

describe('renderReportHtml', () => {
  it('escapes text taken from the file', () => {
    const html = renderReportHtml(
      buildReport(result, { images: [{ id: 'ela', label: HOSTILE, dataUrl: PNG_1X1 }] }),
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain(escapeHtml(HOSTILE));
  });

  it('is self-contained: no scripts, no links, only inline images, and a CSP that blocks the network', () => {
    const html = renderReportHtml(
      buildReport(result, { images: [{ id: 'ela', label: 'ELA', dataUrl: PNG_1X1 }] }),
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\shref=/i);
    const sources = [...html.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1]);
    expect(sources).toEqual([PNG_1X1]);
    expect(html).toContain(
      `content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"`,
    );
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});
