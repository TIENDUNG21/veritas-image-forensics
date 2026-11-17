import { sampledQuantile } from '../core/regions.js';
import { HEAT } from './colormap.js';

/**
 * Turns analysis results into RGBA overlay images for the viewer and the report.
 *
 * @typedef {'original' | 'ela' | 'noise' | 'residual' | 'gradient' | 'copymove' | 'dct'} LayerId
 * @typedef {{ width: number, height: number, data: Uint8ClampedArray, cell: number }} LayerImage
 *   One layer pixel covers `cell` x `cell` pixels of the working image (block maps have
 *   cell 8 or 16 and should be drawn without smoothing).
 * @typedef {import('../pipeline/analyze.js').AnalysisResult} AnalysisResult
 */

/** @type {{ id: LayerId, label: string, hint: string }[]} */
export const LAYERS = [
  { id: 'original', label: 'Image', hint: 'The decoded image, as stored in the file.' },
  {
    id: 'ela',
    label: 'ELA',
    hint: 'Error level: how much each pixel changes when the image is saved again. Bright areas changed more.',
  },
  {
    id: 'dct',
    label: 'DCT history',
    hint: 'Probability that an 8x8 block was not compressed twice like the rest. Only for JPEG files saved at least twice.',
  },
  {
    id: 'copymove',
    label: 'Clones',
    hint: 'Areas that appear twice in the image (copy-move).',
  },
  {
    id: 'noise',
    label: 'Noise level',
    hint: 'Estimated noise per block, relative to the whole image. Pasted or smoothed areas often differ.',
  },
  {
    id: 'residual',
    label: 'Noise residual',
    hint: 'What remains after removing image structure: mostly sensor and compression noise.',
  },
  {
    id: 'gradient',
    label: 'Gradient',
    hint: 'Direction (red/green) and strength (blue) of luminance edges.',
  },
];

/**
 * @param {LayerId} id
 * @param {Pick<AnalysisResult, 'layers' | 'working'>} result
 * @returns {LayerImage | null}
 */
export function renderLayer(id, result) {
  const { layers } = result;
  switch (id) {
    case 'ela':
      if (!layers.ela) return null;
      return scalar(
        layers.ela.map,
        layers.ela.width,
        layers.ela.height,
        1,
        Math.max(2, sampledQuantile(layers.ela.map, 0.995)),
      );
    case 'residual':
      if (!layers.noise) return null;
      return greyscale(
        layers.noise.residual,
        layers.noise.width,
        layers.noise.height,
        sampledQuantile(layers.noise.residual, 0.99),
      );
    case 'noise': {
      const n = layers.noise;
      if (!n) return null;
      return scalar(n.sigma, n.blocksW, n.blocksH, n.block, Math.max(1e-6, 3 * n.globalSigma));
    }
    case 'gradient':
      return layers.gradient ? gradient(layers.gradient) : null;
    case 'copymove':
      return layers.copyMove
        ? mask(layers.copyMove.mask, layers.copyMove.width, layers.copyMove.height)
        : null;
    case 'dct': {
      const d = layers.dct;
      if (!d?.map) return null;
      // DCT blocks are 8x8 pixels of the full image; the working copy may be smaller.
      return scalar(d.map, d.blocksW, d.blocksH, 8 * (result.working?.scale ?? 1), 1);
    }
    default:
      return null;
  }
}

/**
 * Heat-mapped scalar field; NaN cells are transparent.
 * @param {Float32Array} values
 * @param {number} width
 * @param {number} height
 * @param {number} cell
 * @param {number} full Value that maps to the top of the colormap.
 * @returns {LayerImage}
 */
function scalar(values, width, height, cell, full) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const k = Math.min(255, Math.max(0, Math.round((v / full) * 255))) * 3;
    const o = i * 4;
    data[o] = HEAT[k];
    data[o + 1] = HEAT[k + 1];
    data[o + 2] = HEAT[k + 2];
    data[o + 3] = 255;
  }
  return { width, height, data, cell };
}

/**
 * @param {Float32Array} values
 * @param {number} width
 * @param {number} height
 * @param {number} full
 * @returns {LayerImage}
 */
function greyscale(values, width, height, full) {
  const data = new Uint8ClampedArray(width * height * 4);
  const k = 255 / Math.max(1e-6, full);
  for (let i = 0; i < width * height; i++) {
    const g = values[i] * k;
    const o = i * 4;
    data[o] = g;
    data[o + 1] = g;
    data[o + 2] = g;
    data[o + 3] = 255;
  }
  return { width, height, data, cell: 1 };
}

/**
 * Gradient as colour: x component in red, y in green (128 = none), magnitude in blue.
 * @param {import('../analysis/gradient.js').GradientResult} g
 * @returns {LayerImage}
 */
function gradient(g) {
  const { width, height } = g;
  const data = new Uint8ClampedArray(width * height * 4);
  const s = 1 / Math.max(1e-6, sampledQuantile(g.magnitude, 0.99));
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    data[o] = 128 + 127 * g.gx[i] * s;
    data[o + 1] = 128 + 127 * g.gy[i] * s;
    data[o + 2] = 255 * g.magnitude[i] * s;
    data[o + 3] = 255;
  }
  return { width, height, data, cell: 1 };
}

/**
 * Accent-coloured mask, transparent elsewhere.
 * @param {Uint8Array} m
 * @param {number} width
 * @param {number} height
 * @returns {LayerImage}
 */
function mask(m, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (!m[i]) continue;
    data.set([57, 197, 207, 255], i * 4);
  }
  return { width, height, data, cell: 1 };
}
