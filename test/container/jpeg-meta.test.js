import { describe, expect, it } from 'vitest';
import { readJpegMetadata } from '../../src/container/jpeg.js';
import { parseIcc } from '../../src/exif/icc.js';
import { parseJpeg } from '../../src/jpeg/parser.js';
import { ParseError } from '../../src/core/errors.js';
import { texture } from '../../tools/fixtures/synth.mjs';
import { encodeJpeg } from '../../tools/fixtures/jpeg-writer.mjs';
import { TYPE, buildTiff, exifSegment, xmpSegment } from '../../tools/fixtures/tiff-builder.mjs';
import { ascii, concat, segment } from '../helpers/bytes.js';
import { buildIcc, iccSegments } from '../helpers/icc.js';

const image = texture(64, 48, 4);
const thumbnail = encodeJpeg(texture(16, 12, 4), { quality: 70, sampling: '444' });

const exif = exifSegment(
  buildTiff({
    ifd0: [
      { tag: 0x010f, type: TYPE.ASCII, values: 'Veritas' },
      { tag: 0x0131, type: TYPE.ASCII, values: 'Pixel Editor 3.1' },
    ],
    ifd1: [{ tag: 0x0103, type: TYPE.SHORT, values: [6] }],
    thumbnail,
  }),
);
const jfif = segment(0xe0, [...ascii('JFIF'), 0, 1, 2, 1, 0, 72, 0, 72, 0, 0]);
const xmp = xmpSegment('xmp', '<x:xmpmeta xmp:CreatorTool="Pixel Editor 3.1"/>');
const adobe = segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1]);
const ducky = segment(0xec, [...ascii('Ducky'), 0, 1, 0, 4, 0, 0, 0, 60, 0, 0]);
const irb = segment(0xed, [
  ...ascii('Photoshop 3.0'),
  0,
  ...ascii('8BIM'),
  0x04,
  0x04,
  0,
  0,
  0,
  0,
  0,
  2,
  0x1c,
  0x02,
]);
const icc = iccSegments(buildIcc({ description: 'Display P3', version: 4 }), 100);

const bytes = encodeJpeg(image, {
  quality: 88,
  segments: [jfif, exif, xmp, ...icc, adobe, ducky, irb],
});

describe('readJpegMetadata', () => {
  const meta = readJpegMetadata(parseJpeg(bytes));
  const prop = (/** @type {string} */ label) =>
    meta.properties.find((p) => p.label === label)?.value;

  it('collects EXIF, XMP and the embedded thumbnail', () => {
    expect(meta.container).toBe('jpeg');
    expect(meta.exif?.fields.find((f) => f.name === 'Make')?.display).toBe('Veritas');
    expect(meta.xmp?.creatorTool).toBe('Pixel Editor 3.1');
    expect(meta.thumbnail?.width).toBe(16);
    expect(meta.thumbnail?.height).toBe(12);
    expect(meta.thumbnail?.quality).toBe(70);
  });

  it('reassembles a multi-segment ICC profile', () => {
    expect(meta.icc?.description).toBe('Display P3');
    expect(meta.icc?.deviceClass).toBe('Display');
    expect(meta.icc?.version).toBe('4.3');
  });

  it('describes JFIF, Adobe, Ducky and Photoshop segments', () => {
    expect(prop('JFIF version')).toBe('1.02');
    expect(prop('JFIF density')).toBe('72 x 72 dpi');
    expect(prop('Adobe colour transform')).toBe('YCbCr');
    expect(prop('Ducky quality')).toBe('60');
    expect(prop('Photoshop resources')).toBe('1 (IPTC-NAA)');
    expect(meta.warnings).toEqual([]);
  });

  it('keeps going when one segment is damaged', () => {
    const broken = concat(ascii('Exif'), [0, 0], ascii('XX'), [0, 0, 0, 0, 0, 0]);
    const damaged = encodeJpeg(image, { segments: [segment(0xe1, broken), xmp] });
    const result = readJpegMetadata(parseJpeg(damaged));
    expect(result.exif).toBeNull();
    expect(result.xmp?.creatorTool).toBe('Pixel Editor 3.1');
    expect(result.warnings.join(' ')).toMatch(/EXIF/);
  });
});

describe('parseIcc', () => {
  it('reads a version 2 description', () => {
    const info = parseIcc(buildIcc({ description: 'sRGB IEC61966-2.1' }));
    expect(info.description).toBe('sRGB IEC61966-2.1');
    expect(info.version).toBe('2.1');
    expect(info.colorSpace).toBe('RGB');
  });

  it('rejects data without the acsp signature', () => {
    const bad = buildIcc({ description: 'x' });
    bad[36] = 0;
    expect(() => parseIcc(bad)).toThrow(ParseError);
    expect(() => parseIcc(new Uint8Array(10))).toThrow(ParseError);
  });
});
