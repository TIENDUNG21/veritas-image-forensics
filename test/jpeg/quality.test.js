import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { estimateQuality } from '../../src/jpeg/quality.js';
import { parseJpeg } from '../../src/jpeg/parser.js';
import { CHROMA_BASE, LUMA_BASE, scaleTable } from '../../src/jpeg/tables.js';
import { mulberry32, texture } from '../../tools/fixtures/synth.mjs';
import { encodeJpeg } from '../../tools/fixtures/jpeg-writer.mjs';
import { encodeJpegJs } from '../helpers/jpegjs.js';

const image = texture(32, 32, 1);

/**
 * @param {Uint16Array} luma
 * @param {Uint16Array} [chroma]
 */
function tablesOf(luma, chroma) {
  /** @type {import('../../src/jpeg/parser.js').QuantTable[]} */
  const tables = [{ id: 0, precision: 8, values: luma, offset: 0 }];
  if (chroma) tables.push({ id: 1, precision: 8, values: chroma, offset: 0 });
  return tables;
}

describe('estimateQuality', () => {
  it.each([5, 25, 50, 75, 90, 95, 100])('recovers quality %i from a jpeg-js file', (q) => {
    const result = estimateQuality(parseJpeg(encodeJpegJs(image, q)));
    expect(result.quality).toBe(q);
    expect(result.exact).toBe(true);
    expect(result.standard).toBe(true);
    expect(result.perTable.map((t) => t.role)).toEqual(['luminance', 'chrominance']);
  });

  it('finds an exactly matching quality for every IJG-scaled table pair', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (q) => {
        const luma = scaleTable(LUMA_BASE, q);
        const chroma = scaleTable(CHROMA_BASE, q);
        const result = estimateQuality(tablesOf(luma, chroma));
        const back = result.quality ?? -1;
        return (
          result.exact &&
          scaleTable(LUMA_BASE, back).every((v, i) => v === luma[i]) &&
          scaleTable(CHROMA_BASE, back).every((v, i) => v === chroma[i])
        );
      }),
      { numRuns: 100 },
    );
  });

  it('handles grayscale files with a single table', () => {
    const result = estimateQuality(parseJpeg(encodeJpeg(image, { quality: 63, grayscale: true })));
    expect(result.quality).toBe(63);
    expect(result.perTable).toHaveLength(1);
  });

  it('reports a near-standard table as approximate', () => {
    const luma = scaleTable(LUMA_BASE, 80);
    luma[63] = (luma[63] ?? 0) + 1;
    const result = estimateQuality(tablesOf(luma, scaleTable(CHROMA_BASE, 80)));
    expect(result.quality).toBe(80);
    expect(result.exact).toBe(false);
    expect(result.standard).toBe(true);
  });

  it('flags custom tables as non-standard and still gives the nearest quality', () => {
    const rand = mulberry32(3);
    const luma = Uint16Array.from({ length: 64 }, () => 1 + Math.floor(rand() * 60));
    const result = estimateQuality(tablesOf(luma));
    expect(result.standard).toBe(false);
    expect(result.exact).toBe(false);
    expect(result.quality).toBeGreaterThanOrEqual(1);
    expect(result.quality).toBeLessThanOrEqual(100);
  });

  it('returns null quality when there are no tables', () => {
    expect(estimateQuality([]).quality).toBeNull();
  });
});
