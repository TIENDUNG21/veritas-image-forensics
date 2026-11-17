import { describe, expect, it } from 'vitest';
import { readPng } from '../../src/container/png.js';
import { readWebp } from '../../src/container/webp.js';
import { crc32 } from '../../src/core/crc32.js';
import { ParseError } from '../../src/core/errors.js';
import { texture } from '../../tools/fixtures/synth.mjs';
import { encodePng, latin1 } from '../../tools/fixtures/png-writer.mjs';
import { TYPE, buildTiff } from '../../tools/fixtures/tiff-builder.mjs';
import { ascii, concat } from '../helpers/bytes.js';

const tiff = buildTiff({ ifd0: [{ tag: 0x010f, type: TYPE.ASCII, values: 'Veritas' }] });
const xmpText = '<x:xmpmeta xmp:CreatorTool="Raster Studio"/>';

describe('crc32', () => {
  it('matches the reference value for "123456789"', () => {
    expect(crc32(Uint8Array.from(ascii('123456789')))).toBe(0xcbf43926);
  });
});

describe('readPng', () => {
  const png = encodePng(texture(20, 10, 2), {
    chunks: [
      { type: 'tEXt', data: latin1('Software\0Raster Studio 2') },
      { type: 'tEXt', data: latin1('Comment\0hello') },
      { type: 'iTXt', data: latin1(`XML:com.adobe.xmp\0\0\0\0\0${xmpText}`) },
      { type: 'eXIf', data: tiff },
      { type: 'tIME', data: Uint8Array.from([0x07, 0xea, 11, 17, 9, 30, 0]) },
      { type: 'iCCP', data: latin1('Display P3\0\0xx') },
    ],
  });

  it('reads the header and metadata chunks', () => {
    const { info, meta } = readPng(png);
    expect(info).toMatchObject({ width: 20, height: 10, bitDepth: 8, colorType: 2 });
    expect(meta.container).toBe('png');
    expect(meta.exif?.fields.find((f) => f.name === 'Make')?.display).toBe('Veritas');
    expect(meta.xmp?.creatorTool).toBe('Raster Studio');
    expect(meta.comments).toEqual(['hello']);
    const prop = (/** @type {string} */ l) => meta.properties.find((p) => p.label === l)?.value;
    expect(prop('Software')).toBe('Raster Studio 2');
    expect(prop('Last modified (tIME)')).toBe('2026-11-17T09:30:00Z');
    expect(prop('ICC profile name')).toBe('Display P3');
    expect(meta.warnings).toEqual([]);
  });

  it('warns about a bad CRC, truncation and data after IEND', () => {
    const bad = png.slice();
    bad[45] ^= 0xff; // inside the data of the first tEXt chunk
    expect(readPng(bad).meta.warnings.join(' ')).toMatch(/CRC/);
    expect(readPng(png.subarray(0, png.length - 30)).meta.warnings.join(' ')).toMatch(/truncated/);
    expect(readPng(concat(png, ascii('extra'))).meta.warnings.join(' ')).toMatch(/5 byte/);
  });

  it('rejects data without the PNG signature or IHDR', () => {
    expect(() => readPng(Uint8Array.from(ascii('not a png at all')))).toThrow(ParseError);
    expect(() => readPng(png.subarray(0, 12))).toThrow(ParseError);
  });
});

/**
 * @param {string} fourcc
 * @param {ArrayLike<number>} data
 */
function riffChunk(fourcc, data) {
  const size = data.length;
  const out = new Uint8Array(8 + size + (size % 2));
  out.set(ascii(fourcc));
  new DataView(out.buffer).setUint32(4, size, true);
  out.set(data, 8);
  return out;
}

/** @param {Uint8Array[]} chunks */
function riff(chunks) {
  const body = concat(ascii('WEBP'), ...chunks);
  const out = concat(ascii('RIFF'), [0, 0, 0, 0], body);
  new DataView(out.buffer).setUint32(4, body.length, true);
  return out;
}

describe('readWebp', () => {
  it('reads an extended file with EXIF and XMP', () => {
    // VP8X: flags EXIF | XMP, canvas 300 x 200 (stored minus one, 24-bit LE).
    const vp8x = riffChunk('VP8X', [0x0c, 0, 0, 0, 43, 1, 0, 199, 0, 0]);
    const vp8 = riffChunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 44, 1, 200, 0]);
    const file = riff([vp8x, vp8, riffChunk('EXIF', tiff), riffChunk('XMP ', ascii(xmpText))]);
    const { info, meta } = readWebp(file);
    expect(info).toMatchObject({ width: 300, height: 200, encoding: 'lossy (VP8)' });
    expect(meta.exif?.fields.find((f) => f.name === 'Make')?.display).toBe('Veritas');
    expect(meta.xmp?.creatorTool).toBe('Raster Studio');
  });

  it('reads lossless dimensions', () => {
    // VP8L: signature 0x2f, then 14-bit width-1 and 14-bit height-1, little-endian bit packed.
    const w = 64 - 1;
    const h = 48 - 1;
    const bits = w | (h << 14);
    const vp8l = riffChunk('VP8L', [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      (bits >> 24) & 0xff,
    ]);
    const { info } = readWebp(riff([vp8l]));
    expect(info).toMatchObject({ width: 64, height: 48, encoding: 'lossless (VP8L)' });
  });

  it('warns on a chunk that runs past the end', () => {
    const file = riff([riffChunk('VP8L', [0x2f, 0, 0, 0, 0])]);
    const cut = file.subarray(0, file.length - 3);
    expect(readWebp(cut).meta.warnings.join(' ')).toMatch(/truncated/);
    expect(() => readWebp(Uint8Array.from(ascii('RIFF0000WAVE')))).toThrow(ParseError);
  });
});
