import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseJpeg } from '../../src/jpeg/parser.js';
import { decodeCoefficients } from '../../src/jpeg/coefficients.js';
import { decodeJpeg } from '../../src/jpeg/decode.js';
import { estimateQuality } from '../../src/jpeg/quality.js';
import { ParseError } from '../../src/core/errors.js';
import { texture } from '../../tools/fixtures/synth.mjs';
import { encodeJpeg } from '../../tools/fixtures/jpeg-writer.mjs';
import { encodeJpegJs } from '../helpers/jpegjs.js';

const image = texture(48, 40, 21);
const fixtures = [
  encodeJpegJs(image, 80, { comments: ['fuzz'] }),
  encodeJpeg(image, { quality: 70, sampling: '420', restartInterval: 2 }),
  encodeJpeg(image, { quality: 90, grayscale: true }),
];

/**
 * Runs the whole JPEG stack; anything but success or a ParseError fails the property.
 * @param {Uint8Array} bytes
 */
function runAll(bytes) {
  const started = performance.now();
  try {
    const jpeg = parseJpeg(bytes, { tolerant: true });
    estimateQuality(jpeg);
    if (jpeg.frame && jpeg.scans.length > 0) {
      const coefficients = decodeCoefficients(jpeg, { maxPixels: 4_000_000 });
      decodeJpeg(jpeg, { coefficients });
    }
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
  }
  return performance.now() - started;
}

const fixtureArb = fc.constantFrom(...fixtures);

describe('JPEG stack under hostile input', () => {
  it('survives truncation at any point', () => {
    fc.assert(
      fc.property(fixtureArb, fc.double({ min: 0, max: 1, noNaN: true }), (bytes, at) => {
        const cut = bytes.subarray(0, Math.floor(bytes.length * at));
        expect(runAll(cut)).toBeLessThan(1000);
      }),
      { numRuns: 150 },
    );
  });

  it('survives random byte overwrites', () => {
    fc.assert(
      fc.property(
        fixtureArb,
        fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), {
          minLength: 1,
          maxLength: 12,
        }),
        (bytes, edits) => {
          const copy = bytes.slice();
          for (const [pos, value] of edits) copy[pos % copy.length] = value;
          expect(runAll(copy)).toBeLessThan(1000);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('survives inserted and deleted byte runs', () => {
    fc.assert(
      fc.property(
        fixtureArb,
        fc.nat(),
        fc.uint8Array({ minLength: 0, maxLength: 40 }),
        fc.nat({ max: 40 }),
        (bytes, at, insert, remove) => {
          const p = at % bytes.length;
          const out = new Uint8Array(bytes.length + insert.length);
          out.set(bytes.subarray(0, p));
          out.set(insert, p);
          out.set(bytes.subarray(Math.min(bytes.length, p + remove)), p + insert.length);
          expect(runAll(out)).toBeLessThan(1000);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('refuses a tiny file that declares huge dimensions before allocating', () => {
    const bytes = fixtures[0]?.slice() ?? new Uint8Array(0);
    let sof = 0;
    while (!(bytes[sof] === 0xff && bytes[sof + 1] === 0xc0)) sof++;
    bytes.set([0x1b, 0x58, 0x1b, 0x58], sof + 5); // 7000 x 7000 = 49 MP, under the cap
    const started = performance.now();
    expect(() => decodeCoefficients(parseJpeg(bytes))).toThrow(/far too short/);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('survives pure noise after a valid SOI', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 600 }), (noise) => {
        const bytes = new Uint8Array(noise.length + 2);
        bytes.set([0xff, 0xd8]);
        bytes.set(noise, 2);
        expect(runAll(bytes)).toBeLessThan(1000);
      }),
      { numRuns: 300 },
    );
  });
});
