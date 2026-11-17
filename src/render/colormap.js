/**
 * Sequential colormap for heat overlays: near-black, deep teal, the accent teal, warm yellow,
 * white. Luminance rises monotonically, so the map still reads in greyscale, and it avoids
 * the purple and pink ranges of common rainbow maps.
 */

/** @type {[number, [number, number, number]][]} */
const STOPS = [
  [0, [10, 10, 10]],
  [0.3, [12, 52, 58]],
  [0.6, [57, 197, 207]],
  [0.85, [242, 226, 120]],
  [1, [255, 255, 255]],
];

/**
 * @param {number} t 0..1 (clamped; NaN counts as 0)
 * @returns {[number, number, number]}
 */
export function heat(t) {
  const v = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    if (v <= p1) {
      const [p0, c0] = STOPS[i - 1];
      const f = (v - p0) / (p1 - p0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return [255, 255, 255];
}

/** 256-entry RGB lookup table of `heat`, for per-pixel rendering. */
export const HEAT = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) lut.set(heat(i / 255), i * 3);
  return lut;
})();
