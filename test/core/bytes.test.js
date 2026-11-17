import { describe, expect, it } from 'vitest';
import { ByteReader } from '../../src/core/bytes.js';
import { ParseError } from '../../src/core/errors.js';

describe('ByteReader', () => {
  const bytes = Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]);

  it('reads big- and little-endian integers', () => {
    const r = new ByteReader(bytes);
    expect(r.u16be()).toBe(0x1234);
    expect(r.u16le()).toBe(0x7856);
    expect(r.pos).toBe(4);
    r.seek(0);
    expect(r.u32be()).toBe(0x12345678);
    r.seek(0);
    expect(r.u32le()).toBe(0x78563412);
    expect(r.u8()).toBe(0x9a);
    expect(r.remaining).toBe(1);
  });

  it('returns sub-arrays that share memory and advances', () => {
    const r = new ByteReader(bytes);
    r.skip(1);
    const view = r.bytes(3);
    expect([...view]).toEqual([0x34, 0x56, 0x78]);
    expect(r.pos).toBe(4);
  });

  it('throws ParseError with the offset when reading past the end', () => {
    const r = new ByteReader(bytes);
    r.seek(5);
    expect(() => r.u16be()).toThrow(ParseError);
    try {
      r.u32le();
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect(/** @type {ParseError} */ (error).code).toBe('truncated');
      expect(/** @type {ParseError} */ (error).offset).toBe(5);
    }
    expect(() => r.bytes(2)).toThrow(/offset 5/);
    expect(() => r.skip(2)).toThrow(ParseError);
    expect(() => r.seek(7)).toThrow(ParseError);
    expect(() => r.seek(-1)).toThrow(ParseError);
  });

  it('respects a window inside a larger buffer', () => {
    const r = new ByteReader(bytes, 2, 2);
    expect(r.pos).toBe(2);
    expect(r.u16be()).toBe(0x5678);
    expect(() => r.u8()).toThrow(ParseError);
  });
});
