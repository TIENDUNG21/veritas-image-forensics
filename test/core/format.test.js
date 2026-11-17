import { describe, expect, it } from 'vitest';
import { sniffFormat } from '../../src/core/format.js';

/** @param {number[]} head */
const withHead = (head) => Uint8Array.from([...head, ...new Array(16).fill(0)]);
const ascii = (/** @type {string} */ s) => [...s].map((c) => c.charCodeAt(0));

describe('sniffFormat', () => {
  it.each([
    ['jpeg', [0xff, 0xd8, 0xff, 0xe0]],
    ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ['webp', [...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP')]],
    ['gif', ascii('GIF89a')],
    ['bmp', ascii('BM')],
    ['tiff', [0x49, 0x49, 0x2a, 0x00]],
    ['tiff', [0x4d, 0x4d, 0x00, 0x2a]],
    ['heif', [0, 0, 0, 0x18, ...ascii('ftypheic')]],
    ['avif', [0, 0, 0, 0x18, ...ascii('ftypavif')]],
  ])('detects %s', (kind, head) => {
    expect(sniffFormat(withHead(head)).kind).toBe(kind);
  });

  it('reports a MIME type and whether browsers can decode it', () => {
    const jpeg = sniffFormat(withHead([0xff, 0xd8, 0xff, 0xdb]));
    expect(jpeg.mime).toBe('image/jpeg');
    expect(jpeg.browserDecodable).toBe(true);
    expect(sniffFormat(withHead([0x49, 0x49, 0x2a, 0x00])).browserDecodable).toBe(false);
  });

  it('returns unknown for empty, short or unrecognised input', () => {
    expect(sniffFormat(new Uint8Array(0)).kind).toBe('unknown');
    expect(sniffFormat(Uint8Array.from([0xff])).kind).toBe('unknown');
    expect(sniffFormat(withHead(ascii('%PDF-1.7'))).kind).toBe('unknown');
    expect(sniffFormat(withHead([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')])).kind).toBe(
      'unknown',
    );
  });
});
