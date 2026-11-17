import { renderLayer } from '../render/layers.js';
import { clientToImage, fitView, loupeSource } from '../render/geometry.js';

/**
 * Canvas viewer: the decoded image, one overlay layer at adjustable opacity, outlines of the
 * regions the active analysis reported, zoom and pan, and a magnifier with the 8x8 JPEG grid.
 *
 * @typedef {import('./store.js').Store} Store
 * @typedef {import('./store.js').State} State
 * @typedef {import('../render/layers.js').LayerId} LayerId
 * @typedef {import('../render/layers.js').LayerImage} LayerImage
 * @typedef {import('../core/regions.js').Region} Region
 * @typedef {import('../pipeline/analyze.js').AnalysisResult} AnalysisResult
 */

const LOUPE_SIZE = 176;
const LOUPE_ZOOM = 6;

export class Viewer {
  /**
   * @param {{
   *   wrap: HTMLElement, canvas: HTMLCanvasElement, loupe: HTMLElement,
   *   loupeCanvas: HTMLCanvasElement, readout: HTMLElement, store: Store
   * }} parts
   */
  constructor({ wrap, canvas, loupe, loupeCanvas, readout, store }) {
    this.wrap = wrap;
    this.canvas = canvas;
    this.loupe = loupe;
    this.loupeCanvas = loupeCanvas;
    this.readout = readout;
    this.store = store;
    /** @type {HTMLCanvasElement | null} */
    this.base = null;
    /** @type {Map<LayerId, { image: LayerImage, canvas: HTMLCanvasElement } | null>} */
    this.cache = new Map();
    /** @type {'fit' | number} */
    this.zoom = 'fit';
    this.pan = { x: 0, y: 0 };
    this.view = { scale: 1, offsetX: 0, offsetY: 0 };
    /** @type {{ x: number, y: number } | null} */
    this.pointer = null;

    new ResizeObserver(() => this.draw()).observe(wrap);
    store.subscribe((state, previous) => {
      if (state.result !== previous.result) this.load(state.result, previous.result);
      if (
        state.result !== previous.result ||
        state.layer !== previous.layer ||
        state.opacity !== previous.opacity ||
        state.loupe !== previous.loupe
      ) {
        this.draw();
      }
    });
    this.bindPointer();
  }

  /**
   * @param {AnalysisResult | null} result
   * @param {AnalysisResult | null} previous
   */
  load(result, previous) {
    if (result?.layers !== previous?.layers) this.cache.clear();
    if (result?.raster === previous?.raster) return;
    const raster = result?.raster;
    this.base = raster ? toCanvas(raster.width, raster.height, raster.data) : null;
    this.zoom = 'fit';
    this.pan = { x: 0, y: 0 };
  }

  /** @param {'fit' | number} zoom */
  setZoom(zoom) {
    this.zoom = zoom;
    this.pan = { x: 0, y: 0 };
    this.draw();
  }

  /**
   * Overlay image and canvas for a layer, rendered on first use.
   * @param {LayerId} id
   * @returns {{ image: LayerImage, canvas: HTMLCanvasElement } | null}
   */
  layer(id) {
    if (!this.cache.has(id)) {
      const result = this.store.get().result;
      const image = result ? renderLayer(id, result) : null;
      this.cache.set(
        id,
        image ? { image, canvas: toCanvas(image.width, image.height, image.data) } : null,
      );
    }
    return this.cache.get(id) ?? null;
  }

  draw() {
    const { canvas, wrap, base } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);
    if (!base) return;

    const fit = fitView(base.width, base.height, w - 24, h - 24, { maxScale: 2 });
    if (this.zoom === 'fit') {
      this.view = { scale: fit.scale, offsetX: fit.offsetX + 12, offsetY: fit.offsetY + 12 };
    } else {
      const scale = this.zoom;
      this.view = {
        scale,
        offsetX: Math.round((w - base.width * scale) / 2 + this.pan.x),
        offsetY: Math.round((h - base.height * scale) / 2 + this.pan.y),
      };
    }
    wrap.classList.toggle('pannable', this.zoom !== 'fit');
    const state = this.store.get();
    paint(
      ctx,
      this.view,
      base,
      state.layer === 'original' ? null : this.layer(state.layer),
      state.opacity,
    );
    this.outline(ctx, state);
    this.drawLoupe();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {State} state
   */
  outline(ctx, state) {
    const result = state.result;
    if (!result) return;
    const k = (result.working?.scale ?? 1) * this.view.scale;
    /** @param {Region} r @param {string} color */
    const box = (r, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(this.view.offsetX + r.x * k, this.view.offsetY + r.y * k, r.w * k, r.h * k);
    };
    const { layers } = result;
    if (state.layer === 'ela') layers.ela?.hotspots.forEach((r) => box(r, '#f0b24a'));
    if (state.layer === 'noise') layers.noise?.regions.forEach((r) => box(r, '#f0b24a'));
    if (state.layer === 'dct') layers.dct?.regions.forEach((r) => box(r, '#f0b24a'));
    if (state.layer === 'copymove') {
      for (const pair of layers.copyMove?.pairs ?? []) {
        box(pair.source, '#f0b24a');
        box(pair.target, '#f0b24a');
        ctx.beginPath();
        ctx.setLineDash([6, 5]);
        ctx.moveTo(
          this.view.offsetX + (pair.source.x + pair.source.w / 2) * k,
          this.view.offsetY + (pair.source.y + pair.source.h / 2) * k,
        );
        ctx.lineTo(
          this.view.offsetX + (pair.target.x + pair.target.w / 2) * k,
          this.view.offsetY + (pair.target.y + pair.target.h / 2) * k,
        );
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  bindPointer() {
    /** @type {{ x: number, y: number, panX: number, panY: number } | null} */
    let drag = null;
    this.canvas.addEventListener('pointerdown', (event) => {
      if (this.zoom === 'fit') return;
      drag = { x: event.clientX, y: event.clientY, panX: this.pan.x, panY: this.pan.y };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointerup', () => {
      drag = null;
    });
    this.canvas.addEventListener('pointermove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (drag) {
        this.pan = { x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y };
        this.draw();
      } else {
        this.drawLoupe();
      }
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.loupe.hidden = true;
    });
  }

  drawLoupe() {
    const state = this.store.get();
    const base = this.base;
    const raster = state.result?.raster;
    if (!state.loupe || !this.pointer || !base || !raster) {
      this.loupe.hidden = true;
      return;
    }
    const p = clientToImage(this.pointer.x, this.pointer.y, this.view);
    if (p.x < 0 || p.y < 0 || p.x >= base.width || p.y >= base.height) {
      this.loupe.hidden = true;
      return;
    }
    const ctx = this.loupeCanvas.getContext('2d');
    if (!ctx) return;
    const src = loupeSource(p.x, p.y, LOUPE_ZOOM, LOUPE_SIZE, base.width, base.height);
    const k = LOUPE_SIZE / src.sw;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.drawImage(base, src.sx, src.sy, src.sw, src.sh, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
    const layer = state.layer === 'original' ? null : this.layer(state.layer);
    if (layer) {
      const c = layer.image.cell;
      ctx.globalAlpha = state.opacity;
      ctx.drawImage(
        layer.canvas,
        src.sx / c,
        src.sy / c,
        src.sw / c,
        src.sh / c,
        0,
        0,
        LOUPE_SIZE,
        LOUPE_SIZE,
      );
      ctx.globalAlpha = 1;
    }
    // The 8x8 block grid of the file, in working-copy pixels.
    const scale = state.result?.working?.scale ?? 1;
    const step = 8 * scale;
    ctx.strokeStyle = 'rgba(57, 197, 207, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = Math.ceil(src.sx / step) * step; gx < src.sx + src.sw; gx += step) {
      const x = Math.round((gx - src.sx) * k) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, LOUPE_SIZE);
    }
    for (let gy = Math.ceil(src.sy / step) * step; gy < src.sy + src.sh; gy += step) {
      const y = Math.round((gy - src.sy) * k) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(LOUPE_SIZE, y);
    }
    ctx.stroke();

    const o = (p.y * raster.width + p.x) * 4;
    const ix = Math.floor(p.x / scale);
    const iy = Math.floor(p.y / scale);
    this.readout.textContent =
      `x ${ix}  y ${iy}  block ${Math.floor(ix / 8)},${Math.floor(iy / 8)}\n` +
      `RGB ${raster.data[o]} ${raster.data[o + 1]} ${raster.data[o + 2]}` +
      layerValue(state, p.x, p.y);
    this.loupe.hidden = false;
    const left = Math.min(this.pointer.x + 18, this.wrap.clientWidth - LOUPE_SIZE - 14);
    const top = Math.min(this.pointer.y + 18, this.wrap.clientHeight - LOUPE_SIZE - 48);
    this.loupe.style.left = `${Math.max(4, left)}px`;
    this.loupe.style.top = `${Math.max(4, top)}px`;
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ scale: number, offsetX: number, offsetY: number }} view
 * @param {HTMLCanvasElement} base
 * @param {{ image: LayerImage, canvas: HTMLCanvasElement } | null} layer
 * @param {number} opacity
 */
export function paint(ctx, view, base, layer, opacity) {
  ctx.imageSmoothingEnabled = view.scale < 1;
  ctx.drawImage(
    base,
    view.offsetX,
    view.offsetY,
    base.width * view.scale,
    base.height * view.scale,
  );
  if (!layer) return;
  const { image, canvas } = layer;
  ctx.globalAlpha = opacity;
  ctx.imageSmoothingEnabled = image.cell === 1 && view.scale < 1;
  ctx.drawImage(
    canvas,
    view.offsetX,
    view.offsetY,
    image.width * image.cell * view.scale,
    image.height * image.cell * view.scale,
  );
  ctx.globalAlpha = 1;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray} data
 */
export function toCanvas(width, height, data) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

/**
 * The active layer's value under the cursor, in its own unit.
 * @param {State} state
 * @param {number} x Working-copy pixel.
 * @param {number} y
 */
function layerValue(state, x, y) {
  const layers = state.result?.layers;
  if (!layers) return '';
  switch (state.layer) {
    case 'ela': {
      const e = layers.ela;
      return e ? `\nELA ${e.map[y * e.width + x].toFixed(2)} levels` : '';
    }
    case 'noise':
    case 'residual': {
      const n = layers.noise;
      if (!n) return '';
      const s = n.sigma[Math.floor(y / n.block) * n.blocksW + Math.floor(x / n.block)];
      return Number.isFinite(s)
        ? `\nnoise ${s.toFixed(2)} (image ${n.globalSigma.toFixed(2)})`
        : '';
    }
    case 'dct': {
      const d = layers.dct;
      const scale = state.result?.working?.scale ?? 1;
      if (!d?.map) return '';
      const v = d.map[Math.floor(y / scale / 8) * d.blocksW + Math.floor(x / scale / 8)];
      return Number.isFinite(v)
        ? `\nsingle-compressed p = ${v.toFixed(2)}`
        : '\nno DCT evidence here';
    }
    case 'copymove': {
      const c = layers.copyMove;
      if (!c) return '';
      const cx = Math.floor((x * c.width) / (state.result?.raster?.width ?? c.width));
      const cy = Math.floor((y * c.height) / (state.result?.raster?.height ?? c.height));
      return c.mask[cy * c.width + cx] ? '\nduplicated area' : '';
    }
    default:
      return '';
  }
}
