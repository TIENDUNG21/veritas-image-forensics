import { describe, expect, it } from 'vitest';
import { analyzeDoubleCompression } from '../../src/jpeg/double.js';
import { decodeCoefficients } from '../../src/jpeg/coefficients.js';
import { decodeJpeg } from '../../src/jpeg/decode.js';
import { parseJpeg } from '../../src/jpeg/parser.js';
import { copyRect, texture } from '../../tools/fixtures/synth.mjs';
import { encodeJpegJs } from '../helpers/jpegjs.js';

const W = 384;
const patch = { x: 144, y: 120, w: 96, h: 96 };

/**
 * @param {'single' | 'double' | 'spliced'} kind
 * @param {number} q1 First save (ignored for single).
 * @param {number} q2 Last save.
 */
function fixture(kind, q1, q2) {
  if (kind === 'single') return encodeJpegJs(texture(W, W, 5), q2);
  const background = decodeJpeg(encodeJpegJs(texture(W, W, 5), q1));
  if (kind === 'spliced') copyRect(texture(W, W, 77), patch, background, patch.x, patch.y);
  return encodeJpegJs(background, q2);
}

/** @param {Uint8Array} bytes */
function analyze(bytes) {
  const plane = decodeCoefficients(parseJpeg(bytes), { componentIds: [1] }).components[0];
  if (!plane) throw new Error('no luma plane');
  return analyzeDoubleCompression(plane);
}

describe('analyzeDoubleCompression', () => {
  it('finds no evidence in a singly compressed file', () => {
    const result = analyze(fixture('single', 0, 90));
    expect(result.likely).toBe(false);
    expect(result.score).toBeLessThan(0.15);
    expect(result.map).toBeNull();
    expect(result.regions).toEqual([]);
  });

  it.each([
    [60, 90],
    [75, 95],
    [50, 80],
  ])('detects a save at %i followed by a save at %i and estimates the first quality', (q1, q2) => {
    const result = analyze(fixture('double', q1, q2));
    expect(result.likely).toBe(true);
    expect(result.score).toBeGreaterThan(0.4);
    expect(Math.abs((result.primaryQuality ?? 0) - q1)).toBeLessThanOrEqual(2);
    expect(result.regions).toEqual([]);
  });

  it('localises a region pasted between the two saves', () => {
    const result = analyze(fixture('spliced', 60, 90));
    expect(result.likely).toBe(true);
    const map = result.map;
    if (!map) throw new Error('expected a map');
    let inside = 0;
    let nIn = 0;
    let outside = 0;
    let nOut = 0;
    for (let by = 0; by < result.blocksH; by++) {
      for (let bx = 0; bx < result.blocksW; bx++) {
        const v = map[by * result.blocksW + bx] ?? 0;
        if (!Number.isFinite(v)) continue;
        const x = bx * 8;
        const y = by * 8;
        if (x >= patch.x && x < patch.x + patch.w && y >= patch.y && y < patch.y + patch.h) {
          inside += v;
          nIn++;
        } else {
          outside += v;
          nOut++;
        }
      }
    }
    expect(inside / nIn).toBeGreaterThan(0.8);
    expect(outside / nOut).toBeLessThan(0.1);
    const region = result.regions[0];
    if (!region) throw new Error('expected a region');
    const ix = Math.max(
      0,
      Math.min(region.x + region.w, patch.x + patch.w) - Math.max(region.x, patch.x),
    );
    const iy = Math.max(
      0,
      Math.min(region.y + region.h, patch.y + patch.h) - Math.max(region.y, patch.y),
    );
    const union = region.w * region.h + patch.w * patch.h - ix * iy;
    expect((ix * iy) / union).toBeGreaterThan(0.6);
  });

  it('does not claim double compression when the second save is the stronger one', () => {
    // Known limit of histogram methods: a lower second quality hides the first one.
    expect(analyze(fixture('double', 90, 70)).likely).toBe(false);
  });

  it('reports an unavailable result when the quantization table is missing', () => {
    const plane = decodeCoefficients(parseJpeg(fixture('single', 0, 90)), { componentIds: [1] })
      .components[0];
    if (!plane) throw new Error('no plane');
    const result = analyzeDoubleCompression({ ...plane, quant: null });
    expect(result.likely).toBe(false);
    expect(result.frequencies).toEqual([]);
  });
});
