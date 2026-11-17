import { describe, expect, it } from 'vitest';
import { readTiff } from '../../src/exif/tiff.js';
import { ParseError } from '../../src/core/errors.js';
import { TYPE, buildTiff } from '../../tools/fixtures/tiff-builder.mjs';

/** @type {import('../../tools/fixtures/tiff-builder.mjs').TiffSpec} */
const spec = {
  ifd0: [
    { tag: 0x010f, type: TYPE.ASCII, values: 'Veritas' },
    { tag: 0x0112, type: TYPE.SHORT, values: [6] },
    { tag: 0x011a, type: TYPE.RATIONAL, values: [[72, 1]] },
    { tag: 0xc000, type: TYPE.BYTE, values: [1, 2, 3, 4, 5, 6] },
    { tag: 0xc001, type: TYPE.SBYTE, values: [-5] },
    { tag: 0xc002, type: TYPE.UNDEFINED, values: Uint8Array.from([9, 8, 7, 6, 5]) },
    { tag: 0xc003, type: TYPE.SSHORT, values: [-300, 300] },
    { tag: 0xc004, type: TYPE.LONG, values: [70000, 1] },
    { tag: 0xc005, type: TYPE.SLONG, values: [-70000] },
    { tag: 0xc006, type: TYPE.SRATIONAL, values: [[-1, 3]] },
    { tag: 0xc007, type: TYPE.FLOAT, values: [1.5] },
    { tag: 0xc008, type: TYPE.DOUBLE, values: [Math.PI] },
  ],
  exif: [{ tag: 0x9003, type: TYPE.ASCII, values: '2026:11:17 10:00:00' }],
  gps: [{ tag: 0x0001, type: TYPE.ASCII, values: 'N' }],
  interop: [{ tag: 0x0001, type: TYPE.ASCII, values: 'R98' }],
  ifd1: [{ tag: 0x0103, type: TYPE.SHORT, values: [6] }],
  thumbnail: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
};

/**
 * @param {ReturnType<typeof readTiff>} tiff
 * @param {import('../../src/exif/tiff.js').IfdName} ifd
 * @param {number} tag
 */
const value = (tiff, ifd, tag) => tiff.ifds.get(ifd)?.find((e) => e.tag === tag)?.value;

describe('readTiff', () => {
  it.each([true, false])('decodes every field type (little endian: %s)', (littleEndian) => {
    const tiff = readTiff(buildTiff(spec, { littleEndian }));
    expect(tiff.littleEndian).toBe(littleEndian);
    expect(value(tiff, 'ifd0', 0x010f)).toBe('Veritas');
    expect(value(tiff, 'ifd0', 0x0112)).toBe(6);
    expect(value(tiff, 'ifd0', 0x011a)).toEqual({ num: 72, den: 1 });
    expect(value(tiff, 'ifd0', 0xc000)).toEqual(Uint8Array.from([1, 2, 3, 4, 5, 6]));
    expect(value(tiff, 'ifd0', 0xc001)).toBe(-5);
    expect(value(tiff, 'ifd0', 0xc002)).toEqual(Uint8Array.from([9, 8, 7, 6, 5]));
    expect(value(tiff, 'ifd0', 0xc003)).toEqual([-300, 300]);
    expect(value(tiff, 'ifd0', 0xc004)).toEqual([70000, 1]);
    expect(value(tiff, 'ifd0', 0xc005)).toBe(-70000);
    expect(value(tiff, 'ifd0', 0xc006)).toEqual({ num: -1, den: 3 });
    expect(value(tiff, 'ifd0', 0xc007)).toBe(1.5);
    expect(value(tiff, 'ifd0', 0xc008)).toBe(Math.PI);
    expect(tiff.warnings).toEqual([]);
  });

  it('follows Exif, GPS, Interop and IFD1 pointers', () => {
    const tiff = readTiff(buildTiff(spec));
    expect(value(tiff, 'exif', 0x9003)).toBe('2026:11:17 10:00:00');
    expect(value(tiff, 'gps', 0x0001)).toBe('N');
    expect(value(tiff, 'interop', 0x0001)).toBe('R98');
    expect(value(tiff, 'ifd1', 0x0103)).toBe(6);
    expect(value(tiff, 'ifd1', 0x0202)).toBe(4);
    expect([...tiff.ifds.keys()]).toEqual(['ifd0', 'exif', 'interop', 'gps', 'ifd1']);
  });

  it('works on a TIFF embedded at an offset inside a larger buffer', () => {
    const tiff = buildTiff(spec);
    const outer = new Uint8Array(tiff.length + 10);
    outer.set(tiff, 10);
    expect(value(readTiff(outer, 10, tiff.length), 'ifd0', 0x010f)).toBe('Veritas');
  });

  it('skips entries whose data lies outside the TIFF and says so', () => {
    const bytes = buildTiff({ ifd0: [{ tag: 0x010f, type: TYPE.ASCII, values: 'A long make' }] });
    const view = new DataView(bytes.buffer);
    view.setUint32(8 + 2 + 8, 0xfffff0, true);
    const tiff = readTiff(bytes);
    expect(tiff.ifds.get('ifd0')).toEqual([]);
    expect(tiff.warnings.join(' ')).toMatch(/0x010F.*outside/);
  });

  it('stops at IFD cycles', () => {
    const bytes = buildTiff({ ifd0: [{ tag: 0x0112, type: TYPE.SHORT, values: [1] }] });
    new DataView(bytes.buffer).setUint32(8 + 2 + 12, 8, true); // IFD0 -> next = IFD0
    const tiff = readTiff(bytes);
    expect(tiff.ifds.get('ifd0')).toHaveLength(1);
    expect(tiff.warnings.join(' ')).toMatch(/loop/);
  });

  it('rejects implausible entry counts and overflowing value sizes', () => {
    const bytes = buildTiff({ ifd0: [{ tag: 0x0112, type: TYPE.SHORT, values: [1] }] });
    const view = new DataView(bytes.buffer);
    view.setUint32(8 + 2 + 4, 0x40000000, true); // count * 2 bytes overflows any real file
    const tiff = readTiff(bytes);
    expect(tiff.ifds.get('ifd0')).toEqual([]);
    expect(tiff.warnings.join(' ')).toMatch(/outside/);

    view.setUint16(8, 5000, true); // 5000 entries cannot fit
    const many = readTiff(bytes);
    expect(many.ifds.get('ifd0')).toEqual([]);
    expect(many.warnings.join(' ')).toMatch(/ifd0/);
  });

  it('throws ParseError for a bad header', () => {
    expect(() => readTiff(Uint8Array.from([0x49, 0x49, 0x2b, 0, 8, 0, 0, 0]))).toThrow(ParseError);
    expect(() => readTiff(Uint8Array.from([0x41, 0x42, 0, 0x2a, 0, 0, 0, 8]))).toThrow(
      /byte order/,
    );
    expect(() => readTiff(new Uint8Array(3))).toThrow(ParseError);
  });
});
