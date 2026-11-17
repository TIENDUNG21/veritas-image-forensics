import { describe, expect, it } from 'vitest';
import { exifField, parseExif } from '../../src/exif/exif.js';
import { gpsToDecimal, parseExifDate } from '../../src/exif/values.js';
import { ParseError } from '../../src/core/errors.js';
import { TYPE, buildTiff } from '../../tools/fixtures/tiff-builder.mjs';
import { ascii, concat } from '../helpers/bytes.js';

/** @typedef {import('../../tools/fixtures/tiff-builder.mjs').TiffSpec} TiffSpec */

/** @type {TiffSpec} */
const spec = {
  ifd0: [
    { tag: 0x010f, type: TYPE.ASCII, values: 'Veritas' },
    { tag: 0x0110, type: TYPE.ASCII, values: 'Procedural sample' },
    { tag: 0x0112, type: TYPE.SHORT, values: [6] },
    { tag: 0x0131, type: TYPE.ASCII, values: 'Test Suite 1.0' },
    { tag: 0x0132, type: TYPE.ASCII, values: '2026:11:17 11:30:00' },
    { tag: 0x9c9b, type: TYPE.BYTE, values: [...ascii('Hi')].flatMap((c) => [c, 0]).concat(0, 0) },
    { tag: 0xabcd, type: TYPE.SHORT, values: [7] },
  ],
  exif: [
    { tag: 0x829a, type: TYPE.RATIONAL, values: [[1, 250]] },
    { tag: 0x829d, type: TYPE.RATIONAL, values: [[28, 10]] },
    { tag: 0x8827, type: TYPE.SHORT, values: [100] },
    { tag: 0x9000, type: TYPE.UNDEFINED, values: Uint8Array.from(ascii('0232')) },
    { tag: 0x9003, type: TYPE.ASCII, values: '2026:11:17 10:00:00' },
    { tag: 0x9209, type: TYPE.SHORT, values: [0x19] },
    { tag: 0x920a, type: TYPE.RATIONAL, values: [[42, 10]] },
    {
      tag: 0x9286,
      type: TYPE.UNDEFINED,
      values: Uint8Array.from([...ascii('ASCII'), 0, 0, 0, ...ascii('hello')]),
    },
  ],
  gps: [
    { tag: 0x0000, type: TYPE.BYTE, values: [2, 3, 0, 0] },
    { tag: 0x0001, type: TYPE.ASCII, values: 'N' },
    {
      tag: 0x0002,
      type: TYPE.RATIONAL,
      values: [
        [21, 1],
        [1, 1],
        [426, 10],
      ],
    },
    { tag: 0x0003, type: TYPE.ASCII, values: 'E' },
    {
      tag: 0x0004,
      type: TYPE.RATIONAL,
      values: [
        [105, 1],
        [51, 1],
        [1512, 100],
      ],
    },
    { tag: 0x0005, type: TYPE.BYTE, values: [0] },
    { tag: 0x0006, type: TYPE.RATIONAL, values: [[125, 10]] },
    {
      tag: 0x0007,
      type: TYPE.RATIONAL,
      values: [
        [3, 1],
        [4, 1],
        [5, 1],
      ],
    },
    { tag: 0x001d, type: TYPE.ASCII, values: '2026:11:17' },
  ],
};

const app1 = concat(ascii('Exif'), [0, 0], buildTiff(spec, { littleEndian: false }));

describe('parseExif', () => {
  const exif = parseExif(app1);

  it('names and formats common fields', () => {
    expect(exif.byteOrder).toBe('big-endian');
    expect(exifField(exif, 'Make')?.display).toBe('Veritas');
    expect(exifField(exif, 'Orientation')?.display).toBe('Rotate 90 CW');
    expect(exifField(exif, 'ExposureTime')?.display).toBe('1/250 s');
    expect(exifField(exif, 'FNumber')?.display).toBe('f/2.8');
    expect(exifField(exif, 'FocalLength')?.display).toBe('4.2 mm');
    expect(exifField(exif, 'ISOSpeedRatings')?.display).toBe('100');
    expect(exifField(exif, 'ExifVersion')?.display).toBe('2.32');
    expect(exifField(exif, 'Flash')?.display).toMatch(/^Fired/);
    expect(exifField(exif, 'UserComment')?.display).toBe('hello');
    expect(exifField(exif, 'XPTitle')?.display).toBe('Hi');
    expect(exifField(exif, 'DateTimeOriginal')?.display).toBe('2026:11:17 10:00:00');
  });

  it('keeps unknown tags with a hex name', () => {
    const field = exif.fields.find((f) => f.tag === 0xabcd);
    expect(field?.name).toBe('Tag 0xABCD');
    expect(field?.display).toBe('7');
  });

  it('converts GPS coordinates, altitude and timestamp', () => {
    expect(exif.gps?.latitude).toBeCloseTo(21.0285, 4);
    expect(exif.gps?.longitude).toBeCloseTo(105.8542, 4);
    expect(exif.gps?.altitude).toBeCloseTo(12.5, 6);
    expect(exif.gps?.timestamp).toBe('2026-11-17T03:04:05Z');
    expect(exifField(exif, 'GPSLatitude')?.display).toBe('21° 1′ 42.6″');
  });

  it('accepts a bare TIFF payload (PNG eXIf, WebP EXIF chunks)', () => {
    const bare = parseExif(buildTiff(spec));
    expect(bare.byteOrder).toBe('little-endian');
    expect(exifField(bare, 'Model')?.display).toBe('Procedural sample');
  });

  it('throws ParseError for data that is not EXIF', () => {
    expect(() => parseExif(Uint8Array.from(ascii('Exif\0\0nonsense')))).toThrow(ParseError);
    expect(() => parseExif(new Uint8Array(0))).toThrow(ParseError);
  });
});

describe('value helpers', () => {
  it('gives negative coordinates for south and west', () => {
    const dms = [
      { num: 33, den: 1 },
      { num: 30, den: 1 },
      { num: 0, den: 1 },
    ];
    expect(gpsToDecimal('S', dms)).toBeCloseTo(-33.5, 9);
    expect(gpsToDecimal('W', dms)).toBeCloseTo(-33.5, 9);
    expect(gpsToDecimal('N', [{ num: 1, den: 0 }])).toBeNull();
  });

  it('parses EXIF dates and rejects invalid ones', () => {
    expect(parseExifDate('2026:11:17 10:00:00')).toBe('2026-11-17T10:00:00');
    expect(parseExifDate('2026:11:17 10:00:00', '+07:00')).toBe('2026-11-17T10:00:00+07:00');
    expect(parseExifDate('    :  :     :  :  ')).toBeNull();
    expect(parseExifDate('2026:13:40 99:00:00')).toBeNull();
  });
});
