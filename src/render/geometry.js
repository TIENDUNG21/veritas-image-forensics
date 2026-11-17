/**
 * Coordinate helpers for the viewer and the magnifier.
 * @typedef {{ scale: number, offsetX: number, offsetY: number }} View
 *   Image pixel (x, y) is drawn at (offsetX + x * scale, offsetY + y * scale).
 */

/**
 * Largest scale at which the image fits the box, centred.
 * @param {number} imageW
 * @param {number} imageH
 * @param {number} boxW
 * @param {number} boxH
 * @param {{ maxScale?: number }} [options]
 * @returns {View}
 */
export function fitView(imageW, imageH, boxW, boxH, { maxScale = Infinity } = {}) {
  const scale = Math.min(boxW / imageW, boxH / imageH, maxScale);
  return {
    scale,
    offsetX: Math.round((boxW - imageW * scale) / 2),
    offsetY: Math.round((boxH - imageH * scale) / 2),
  };
}

/**
 * @param {number} px Position inside the viewer, in CSS pixels.
 * @param {number} py
 * @param {View} view
 */
export function clientToImage(px, py, view) {
  return {
    x: Math.floor((px - view.offsetX) / view.scale),
    y: Math.floor((py - view.offsetY) / view.scale),
  };
}

/**
 * Image rectangle shown by a square loupe of `size` CSS pixels that magnifies `zoom` times,
 * centred on (x, y) and shifted to stay inside the image.
 * @param {number} x
 * @param {number} y
 * @param {number} zoom
 * @param {number} size
 * @param {number} imageW
 * @param {number} imageH
 */
export function loupeSource(x, y, zoom, size, imageW, imageH) {
  const sw = Math.min(imageW, Math.round(size / zoom));
  const sh = Math.min(imageH, Math.round(size / zoom));
  const sx = Math.min(imageW - sw, Math.max(0, Math.round(x - sw / 2)));
  const sy = Math.min(imageH - sh, Math.max(0, Math.round(y - sh / 2)));
  return { sx, sy, sw, sh };
}
