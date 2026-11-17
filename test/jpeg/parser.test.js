import { describe, expect, it } from 'vitest';
import { parseJpeg } from '../../src/jpeg/parser.js';
import { ParseError } from '../../src/core/errors.js';
import { scaleTable, LUMA_BASE, CHROMA_BASE } from '../../src/jpeg/tables.js';
import { texture } from '../../tools/fixtures/synth.mjs';
import { encodeJpegJs } from '../helpers/jpegjs.js';
import { ascii, concat, findMarker, segment } from '../helpers/bytes.js';

const image = texture(40, 24, 7);
const q90 = encodeJpegJs(image, 90, { comments: ['made by a test'] });

/** @param {() => unknown} fn */
function parseErrorOf(fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof ParseError) return error;
    throw error;
  }
  throw new Error('expected a ParseError');
}

describe('parseJpeg on a valid baseline file', () => {
  const jpeg = parseJpeg(q90);

  it('reads the frame header', () => {
    const frame = jpeg.frame;
    if (!frame) throw new Error('frame missing');
    expect(frame.width).toBe(40);
    expect(frame.height).toBe(24);
    expect(frame.precision).toBe(8);
    expect(frame.baseline).toBe(true);
    expect(frame.progressive).toBe(false);
    expect(frame.components.map((c) => [c.id, c.h, c.v, c.tq])).toEqual([
      [1, 1, 1, 0],
      [2, 1, 1, 1],
      [3, 1, 1, 1],
    ]);
  });

  it('reads quantization tables in natural order', () => {
    expect([...(jpeg.quantTables[0]?.values ?? [])]).toEqual([...scaleTable(LUMA_BASE, 90)]);
    expect([...(jpeg.quantTables[1]?.values ?? [])]).toEqual([...scaleTable(CHROMA_BASE, 90)]);
    expect(jpeg.quantTables[0]?.precision).toBe(8);
  });

  it('records Huffman tables, the scan and the end of image', () => {
    expect(jpeg.scans).toHaveLength(1);
    const scan = jpeg.scans[0];
    expect(scan?.components.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(scan?.ss).toBe(0);
    expect(scan?.se).toBe(63);
    expect(scan?.dcTables[0]).toBeDefined();
    expect(scan?.acTables[1]).toBeDefined();
    expect(scan?.dataEnd).toBeGreaterThan(scan?.dataOffset ?? 0);
    expect(jpeg.eoiOffset).toBe(q90.length - 2);
    expect(jpeg.trailingBytes).toBe(0);
    expect(jpeg.warnings).toEqual([]);
  });

  it('lists APP segments with labels and COM text', () => {
    expect(jpeg.app[0]?.label).toBe('JFIF');
    expect(jpeg.comments).toEqual(['made by a test']);
    expect(jpeg.segments[0]?.name).toBe('SOI');
    expect(jpeg.segments.at(-1)?.name).toBe('EOI');
    expect(jpeg.segments.map((s) => s.name)).toContain('DQT');
  });
});

describe('parseJpeg on unusual but valid input', () => {
  it('warns about bytes after EOI', () => {
    const jpeg = parseJpeg(concat(q90, ascii('appended')));
    expect(jpeg.trailingBytes).toBe(8);
    expect(jpeg.warnings.join(' ')).toMatch(/8 byte\(s\) after the end-of-image marker/);
  });

  it('skips fill bytes before a marker', () => {
    const dqt = findMarker(q90, 0xdb);
    const padded = concat(q90.subarray(0, dqt), [0xff, 0xff, 0xff], q90.subarray(dqt));
    expect(parseJpeg(padded).quantTables[0]).toBeDefined();
  });

  it('reads 16-bit quantization tables and DRI', () => {
    const table = [];
    for (let i = 0; i < 64; i++) table.push(0x01, i + 1);
    const bytes = concat(
      [0xff, 0xd8],
      segment(0xdb, [0x12, ...table]),
      segment(0xdd, [0x00, 0x04]),
      [0xff, 0xd9],
    );
    const jpeg = parseJpeg(bytes);
    expect(jpeg.quantTables[2]?.precision).toBe(16);
    expect(jpeg.quantTables[2]?.values[0]).toBe(0x0101);
    expect(jpeg.restartInterval).toBe(4);
  });

  it('flags a missing end-of-image marker as truncation', () => {
    const cut = q90.subarray(0, q90.length - 40);
    const jpeg = parseJpeg(cut);
    expect(jpeg.eoiOffset).toBe(-1);
    expect(jpeg.warnings.join(' ')).toMatch(/truncated/);
  });

  it('labels progressive frames', () => {
    const sof = findMarker(q90, 0xc0);
    const copy = q90.slice();
    copy[sof + 1] = 0xc2;
    const jpeg = parseJpeg(copy);
    expect(jpeg.frame?.progressive).toBe(true);
    expect(jpeg.frame?.baseline).toBe(false);
    expect(jpeg.frame?.type).toMatch(/Progressive/);
  });
});

describe('parseJpeg on malformed input', () => {
  it('rejects data without SOI', () => {
    expect(parseErrorOf(() => parseJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).code).toBe(
      'not-jpeg',
    );
    expect(parseErrorOf(() => parseJpeg(new Uint8Array(0))).code).toBe('not-jpeg');
  });

  it('reports a segment that runs past the end with its offset', () => {
    const bytes = concat([0xff, 0xd8], [0xff, 0xdb, 0x00, 0x43, 0x00, 1, 2, 3]);
    const error = parseErrorOf(() => parseJpeg(bytes));
    expect(error.code).toBe('truncated');
    expect(error.offset).toBe(2);
    expect(error.message).toMatch(/DQT/);
  });

  it('rejects a frame with zero width', () => {
    const sof = segment(0xc0, [8, 0, 16, 0, 0, 1, 1, 0x11, 0]);
    expect(parseErrorOf(() => parseJpeg(concat([0xff, 0xd8], sof))).code).toBe('bad-frame');
  });

  it('rejects quantization table ids above 3 and invalid lengths', () => {
    const bad = segment(0xdb, [0x04, ...new Array(64).fill(1)]);
    expect(parseErrorOf(() => parseJpeg(concat([0xff, 0xd8], bad))).code).toBe('bad-dqt');
    const short = segment(0xdb, [0x00, 1, 2]);
    expect(parseErrorOf(() => parseJpeg(concat([0xff, 0xd8], short))).code).toBe('bad-dqt');
  });

  it('rejects over-long Huffman tables', () => {
    const counts = new Array(16).fill(0);
    counts[15] = 255;
    counts[14] = 255;
    const dht = segment(0xc4, [0x00, ...counts, ...new Array(510).fill(0)]);
    expect(parseErrorOf(() => parseJpeg(concat([0xff, 0xd8], dht))).code).toBe('bad-dht');
  });

  it('rejects a scan before the frame header', () => {
    const sos = segment(0xda, [1, 1, 0x00, 0, 63, 0]);
    expect(parseErrorOf(() => parseJpeg(concat([0xff, 0xd8], sos))).code).toBe('bad-scan');
  });

  it('rejects a segment length below two', () => {
    const bytes = concat([0xff, 0xd8], [0xff, 0xe0, 0x00, 0x01]);
    expect(parseErrorOf(() => parseJpeg(bytes)).code).toBe('bad-segment');
  });

  it('returns partial structure with the error in tolerant mode', () => {
    const exif = segment(0xe1, [...ascii('Exif'), 0, 0, 1, 2, 3]);
    const bytes = concat([0xff, 0xd8], exif, [0xff, 0xdb, 0x00, 0x43, 0x00]);
    const jpeg = parseJpeg(bytes, { tolerant: true });
    expect(jpeg.error?.code).toBe('truncated');
    expect(jpeg.app[0]?.label).toBe('Exif');
  });
});
