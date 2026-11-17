import { resizeBox, toLuma } from '../core/raster.js';

/**
 * @typedef {import('../core/raster.js').Raster} Raster
 * @typedef {import('../core/regions.js').Region} Region
 * @typedef {{
 *   comparable: boolean, meanDiff: number, maxCellDiff: number, differs: boolean,
 *   region: Region | null
 * }} ThumbnailComparison
 *   `region` is the most different 8x8 thumbnail cell, in image pixels.
 */

/** Cell difference (luma levels) above which content counts as changed. */
const CELL_LIMIT = 25;

/**
 * Compares the embedded EXIF thumbnail with the image. Cameras write the thumbnail at
 * capture; many editors keep the old one. If a part of the image was changed afterwards,
 * the thumbnail can still show the original content there.
 *
 * Both are compared as luminance at thumbnail size in 8x8 cells, after removing the global
 * brightness offset (thumbnails are often processed slightly differently).
 * @param {Raster} thumbnail
 * @param {Raster} image
 * @returns {ThumbnailComparison}
 */
export function compareThumbnail(thumbnail, image) {
  const tw = thumbnail.width;
  const th = thumbnail.height;
  const none = { comparable: false, meanDiff: 0, maxCellDiff: 0, differs: false, region: null };
  if (tw < 16 || th < 16) return none;
  const aspect = Math.abs(tw / th - image.width / image.height) / (image.width / image.height);
  if (aspect > 0.02) return none;

  const a = toLuma(thumbnail);
  const b = toLuma(resizeBox(image, tw, th));
  let offset = 0;
  for (let i = 0; i < a.length; i++) offset += a[i] - b[i];
  offset /= a.length;

  let sum = 0;
  let maxCell = 0;
  let worst = { x: 0, y: 0 };
  const cellsW = Math.floor(tw / 8);
  const cellsH = Math.floor(th / 8);
  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      let cell = 0;
      for (let y = cy * 8; y < cy * 8 + 8; y++) {
        for (let x = cx * 8; x < cx * 8 + 8; x++) {
          const d = Math.abs(a[y * tw + x] - b[y * tw + x] - offset);
          cell += d;
          sum += d;
        }
      }
      cell /= 64;
      if (cell > maxCell) {
        maxCell = cell;
        worst = { x: cx, y: cy };
      }
    }
  }
  const sx = image.width / tw;
  const sy = image.height / th;
  const differs = maxCell > CELL_LIMIT;
  return {
    comparable: true,
    meanDiff: sum / (cellsW * cellsH * 64),
    maxCellDiff: maxCell,
    differs,
    region: differs
      ? {
          x: Math.round(worst.x * 8 * sx),
          y: Math.round(worst.y * 8 * sy),
          w: Math.round(8 * sx),
          h: Math.round(8 * sy),
          score: maxCell,
        }
      : null,
  };
}
