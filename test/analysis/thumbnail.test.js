import { describe, expect, it } from 'vitest';
import { compareThumbnail } from '../../src/analysis/thumbnail.js';
import { resizeBox } from '../../src/core/raster.js';
import { solid, texture } from '../../tools/fixtures/synth.mjs';
import { decodeJpegJs, encodeJpegJs } from '../helpers/jpegjs.js';

const image = texture(480, 360, 31, { cell: 60 });
/** @param {import('../../src/core/raster.js').Raster} r */
const asThumbnail = (r) => decodeJpegJs(encodeJpegJs(resizeBox(r, 160, 120), 75));

describe('compareThumbnail', () => {
  it('finds a faithful thumbnail consistent', () => {
    const result = compareThumbnail(asThumbnail(image), image);
    expect(result.comparable).toBe(true);
    expect(result.maxCellDiff).toBeLessThan(12);
    expect(result.differs).toBe(false);
  });

  it('flags a thumbnail that still shows content edited out of the image', () => {
    const edited = { ...image, data: image.data.slice() };
    const patch = solid(96, 96, [40, 200, 60]);
    for (let y = 0; y < 96; y++) {
      edited.data.set(
        patch.data.subarray(y * 96 * 4, (y + 1) * 96 * 4),
        ((120 + y) * 480 + 200) * 4,
      );
    }
    const result = compareThumbnail(asThumbnail(image), edited);
    expect(result.differs).toBe(true);
    expect(result.maxCellDiff).toBeGreaterThan(25);
    expect(result.region?.x).toBeGreaterThanOrEqual(180);
    expect(result.region?.x).toBeLessThan(260);
  });

  it('does not compare thumbnails of a different shape', () => {
    const square = decodeJpegJs(encodeJpegJs(resizeBox(image, 120, 120), 75));
    expect(compareThumbnail(square, image).comparable).toBe(false);
  });
});
