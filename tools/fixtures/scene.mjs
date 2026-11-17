// Procedural landscape scenes for the built-in samples: sky, sun, mountain ridges, a field
// and a few trees, with sensor-like grain. Seeded, so every run produces the same pixels.
import { createRaster } from '../../src/core/raster.js';
import { gaussian, mulberry32, valueNoise } from './synth.mjs';

/** @typedef {import('../../src/core/raster.js').Raster} Raster */
/** @typedef {[number, number, number]} Rgb */

/**
 * @param {Rgb} a
 * @param {Rgb} b
 * @param {number} t
 * @returns {Rgb}
 */
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * 1-D fractal ridge profile in [0, 1].
 * @param {number} width
 * @param {() => number} rand
 * @param {number} roughness
 */
function ridge(width, rand, roughness) {
  const out = new Float32Array(width);
  let amplitude = 1;
  let total = 0;
  for (let step = 256; step >= 4; step = Math.floor(step / 2)) {
    const points = Math.ceil(width / step) + 2;
    const values = Array.from({ length: points }, () => rand());
    for (let x = 0; x < width; x++) {
      const i = Math.floor(x / step);
      const t = (x % step) / step;
      const s = t * t * (3 - 2 * t);
      out[x] += amplitude * ((values[i] ?? 0) * (1 - s) + (values[i + 1] ?? 0) * s);
    }
    total += amplitude;
    amplitude *= roughness;
  }
  for (let x = 0; x < width; x++) out[x] /= total;
  return out;
}

/**
 * @typedef {{ x: number, y: number, size: number }} Tree
 * @typedef {{ raster: Raster, trees: Tree[], horizon: number }} Scene
 */

/**
 * @param {number} width
 * @param {number} height
 * @param {number} seed
 * @param {{ trees?: number, sun?: { x: number, y: number }, grain?: number }} [options]
 * @returns {Scene}
 */
export function landscape(width, height, seed, options = {}) {
  const rand = mulberry32(seed);
  const raster = createRaster(width, height);
  const d = raster.data;
  const horizon = Math.round(height * 0.62);
  const sun = options.sun ?? { x: width * 0.72, y: height * 0.22 };
  const sunR = Math.min(width, height) * 0.06;

  /** @type {Rgb} */ const skyTop = [24, 58, 84];
  /** @type {Rgb} */ const skyLow = [214, 196, 150];
  const clouds = valueNoise(width, height, { seed: seed + 1, cell: 160, octaves: 5 });
  const field = valueNoise(width, height, { seed: seed + 2, cell: 40, octaves: 6 });
  const rock = valueNoise(width, height, { seed: seed + 3, cell: 24, octaves: 5 });

  // Sky with soft clouds and the sun.
  for (let y = 0; y < height; y++) {
    const t = Math.min(1, y / horizon);
    const base = mix(skyTop, skyLow, t ** 1.4);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const cloud = Math.max(0, (clouds[i] ?? 0) - 0.52) * 2.2;
      let c = mix(base, [236, 232, 220], Math.min(0.75, cloud));
      const dist = Math.hypot(x - sun.x, y - sun.y);
      if (dist < sunR) c = [252, 240, 196];
      else c = mix(c, [252, 226, 160], Math.max(0, 1 - (dist - sunR) / (sunR * 4)) * 0.45);
      d.set([c[0], c[1], c[2], 255], i * 4);
    }
  }

  // Three mountain ridges, far to near.
  /** @type {[number, number, Rgb, Rgb][]} */
  const ranges = [
    [0.3, 0.2, [92, 112, 128], [120, 136, 146]],
    [0.4, 0.14, [62, 86, 92], [88, 108, 104]],
    [0.52, 0.09, [46, 70, 60], [70, 92, 70]],
  ];
  ranges.forEach(([top, amp, dark, light], index) => {
    const profile = ridge(width, rand, 0.5 + index * 0.05);
    for (let x = 0; x < width; x++) {
      const ry = Math.round(height * (top + amp * (1 - (profile[x] ?? 0)) * 1.6));
      for (let y = Math.max(0, ry); y < horizon + 4; y++) {
        const i = y * width + x;
        const shade = (rock[i] ?? 0) * 0.9 + (y - ry) / (height * 0.5);
        const c = mix(light, dark, Math.min(1, shade));
        d.set([c[0], c[1], c[2], 255], i * 4);
      }
    }
  });

  // Field.
  /** @type {Rgb} */ const grassFar = [104, 122, 64];
  /** @type {Rgb} */ const grassNear = [70, 96, 40];
  for (let y = horizon; y < height; y++) {
    const t = (y - horizon) / (height - horizon);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const n = field[i] ?? 0;
      let c = mix(mix(grassFar, grassNear, t), [150, 140, 80], Math.max(0, n - 0.55) * 1.6);
      c = mix(c, [40, 56, 26], Math.max(0, 0.45 - n) * 1.2);
      d.set([c[0], c[1], c[2], 255], i * 4);
    }
  }

  // Trees: trunk plus a layered, textured crown; nearer trees are larger.
  /** @type {Tree[]} */
  const trees = [];
  const count = options.trees ?? 5;
  for (let k = 0; k < count; k++) {
    const x = Math.round(
      width * (0.08 + 0.84 * ((k + 0.5) / count)) + (rand() - 0.5) * width * 0.08,
    );
    const y = Math.round(horizon + (height - horizon) * (0.25 + rand() * 0.55));
    const size = Math.round(height * (0.08 + 0.12 * ((y - horizon) / (height - horizon))));
    trees.push({ x, y, size });
  }
  trees.sort((a, b) => a.y - b.y);
  for (const tree of trees) drawTree(raster, tree, rock);

  // Sensor-like grain.
  const grain = options.grain ?? 2.5;
  const noise = mulberry32(seed + 9);
  for (let p = 0; p < d.length; p += 4) {
    for (let c = 0; c < 3; c++) d[p + c] = (d[p + c] ?? 0) + grain * gaussian(noise);
  }
  return { raster, trees, horizon };
}

/**
 * @param {Raster} raster
 * @param {Tree} tree
 * @param {Float32Array} texture
 */
export function drawTree(raster, tree, texture) {
  const { width, height, data } = raster;
  const trunkW = Math.max(2, Math.round(tree.size * 0.09));
  const trunkH = Math.round(tree.size * 0.35);
  for (let y = tree.y - trunkH; y < tree.y; y++) {
    for (let x = tree.x - trunkW; x <= tree.x + trunkW; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const shade = 0.7 + 0.3 * (texture[y * width + x] ?? 0);
      data.set([88 * shade, 62 * shade, 40 * shade, 255], (y * width + x) * 4);
    }
  }
  const crownY = tree.y - trunkH - tree.size * 0.35;
  const r = tree.size * 0.42;
  for (let y = Math.floor(crownY - r * 1.3); y <= crownY + r; y++) {
    for (let x = Math.floor(tree.x - r); x <= tree.x + r; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const dx = (x - tree.x) / r;
      const dy = (y - crownY) / (r * (y < crownY ? 1.3 : 1));
      const edge = 0.85 + 0.25 * ((texture[y * width + x] ?? 0) - 0.5);
      if (dx * dx + dy * dy > edge) continue;
      const light = Math.max(0, -dx * 0.5 - dy * 0.5);
      const t = (texture[y * width + x] ?? 0) * 0.8 + light * 0.6;
      const c = mix([22, 52, 30], [96, 138, 64], Math.min(1, t));
      data.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
    }
  }
}
