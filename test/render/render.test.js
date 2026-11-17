import { describe, expect, it } from 'vitest';
import { HEAT, heat } from '../../src/render/colormap.js';
import { renderLayer } from '../../src/render/layers.js';
import { clientToImage, fitView, loupeSource } from '../../src/render/geometry.js';
import { formatBytes, formatDuration } from '../../src/render/format.js';
import { analyzeImage } from '../../src/pipeline/analyze.js';
import { copyRect, texture } from '../../tools/fixtures/synth.mjs';
import { encodeJpeg } from '../../tools/fixtures/jpeg-writer.mjs';
import { decodeJpeg } from '../../src/jpeg/decode.js';

/** @param {number[]} rgb */
function hue([r = 0, g = 0, b = 0]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('heat colormap', () => {
  it('runs from near-black to white with rising luminance', () => {
    expect(heat(0)).toEqual([10, 10, 10]);
    expect(heat(1)).toEqual([255, 255, 255]);
    let previous = -1;
    for (let i = 0; i < 256; i++) {
      const [r = 0, g = 0, b = 0] = [HEAT[i * 3], HEAT[i * 3 + 1], HEAT[i * 3 + 2]];
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(luminance).toBeGreaterThanOrEqual(previous - 0.5);
      previous = luminance;
    }
  });

  it('never passes through purple or pink', () => {
    for (let i = 0; i < 256; i++) {
      const h = hue([HEAT[i * 3] ?? 0, HEAT[i * 3 + 1] ?? 0, HEAT[i * 3 + 2] ?? 0]);
      if (h !== null) expect(h < 250 || h > 345).toBe(true);
    }
  });

  it('clamps out-of-range input', () => {
    expect(heat(-3)).toEqual(heat(0));
    expect(heat(Number.NaN)).toEqual(heat(0));
    expect(heat(7)).toEqual(heat(1));
  });
});

describe('renderLayer', async () => {
  // Saved twice (quality 70, then 90) so the DCT layer exists too.
  const image = decodeJpeg(encodeJpeg(texture(256, 192, 3), { quality: 70 }));
  copyRect(image, { x: 10, y: 10, w: 48, h: 48 }, image, 150, 100);
  const result = await analyzeImage(encodeJpeg(image, { quality: 90 }), { name: 'x.jpg' });

  it.each(['ela', 'noise', 'residual', 'gradient', 'copymove', 'dct'])(
    'renders the %s layer as RGBA with a cell size',
    (id) => {
      const layer = renderLayer(/** @type {any} */ (id), result);
      if (!layer) throw new Error(`no ${id} layer`);
      expect(layer.data.length).toBe(layer.width * layer.height * 4);
      expect(layer.cell).toBeGreaterThan(0);
      expect(layer.width * layer.cell).toBeGreaterThanOrEqual(result.working?.width ?? 0);
    },
  );

  it('paints cloned pixels and leaves the rest transparent', () => {
    const layer = renderLayer('copymove', result);
    if (!layer) throw new Error('no layer');
    const at = (/** @type {number} */ x, /** @type {number} */ y) =>
      layer.data[(y * layer.width + x) * 4 + 3];
    expect(at(170, 120)).toBe(255);
    expect(at(5, 180)).toBe(0);
  });

  it('returns null for the original and for missing layers', () => {
    expect(renderLayer('original', result)).toBeNull();
    expect(renderLayer('dct', { ...result, layers: { ...result.layers, dct: null } })).toBeNull();
  });
});

describe('geometry', () => {
  it('fits an image into a box, centred, without upscaling past 1:1 when asked', () => {
    expect(fitView(400, 200, 200, 200)).toEqual({ scale: 0.5, offsetX: 0, offsetY: 50 });
    expect(fitView(100, 50, 400, 400, { maxScale: 1 })).toEqual({
      scale: 1,
      offsetX: 150,
      offsetY: 175,
    });
  });

  it('maps client coordinates to image pixels', () => {
    const view = { scale: 2, offsetX: 10, offsetY: 20 };
    expect(clientToImage(30, 40, view)).toEqual({ x: 10, y: 10 });
  });

  it('keeps the magnified area inside the image', () => {
    expect(loupeSource(2, 3, 4, 160, 100, 80)).toEqual({ sx: 0, sy: 0, sw: 40, sh: 40 });
    expect(loupeSource(99, 79, 4, 160, 100, 80)).toEqual({ sx: 60, sy: 40, sw: 40, sh: 40 });
    expect(loupeSource(50, 40, 8, 160, 100, 80)).toEqual({ sx: 40, sy: 30, sw: 20, sh: 20 });
  });
});

describe('format', () => {
  it('formats sizes and durations', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3.5 * 1048576)).toBe('3.5 MB');
    expect(formatDuration(45)).toBe('45 ms');
    expect(formatDuration(1530)).toBe('1.53 s');
  });
});
