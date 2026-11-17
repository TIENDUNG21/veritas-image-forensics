import './styles.css';
import { byId, clear, h } from './dom.js';
import { INITIAL, createStore } from './store.js';
import { bindInput } from './input.js';
import { loadManifest, loadSample, sampleUrl } from './samples.js';
import { Viewer } from './viewer.js';
import { exportHtml, exportJson } from './export.js';
import { summaryPanel } from './panels/summary.js';
import { jpegPanel } from './panels/jpeg.js';
import { metadataPanel } from './panels/metadata.js';
import { AnalysisClient } from '../worker/client.js';
import { LAYERS } from '../render/layers.js';
import { formatBytes } from '../render/format.js';

/**
 * @typedef {import('./store.js').State} State
 * @typedef {import('./store.js').Sample} Sample
 * @typedef {import('../render/layers.js').LayerId} LayerId
 * @typedef {import('../pipeline/analyze.js').AnalysisResult} AnalysisResult
 */

const store = createStore(INITIAL);
// WorkerLike is the narrow slice of Worker the client uses (so tests can pass a fake); the
// DOM typing of onmessage is wider than that slice, hence the cast.
const client = new AnalysisClient(
  () =>
    /** @type {import('../worker/client.js').WorkerLike} */ (
      /** @type {unknown} */ (
        new Worker(new URL('../worker/analysis.worker.js', import.meta.url), { type: 'module' })
      )
    ),
);

const els = {
  empty: byId('empty', HTMLElement),
  busy: byId('busy', HTMLElement),
  busyFile: byId('busy-file', HTMLElement),
  busyProgress: byId('busy-progress', HTMLProgressElement),
  busyStage: byId('busy-stage', HTMLElement),
  failure: byId('failure', HTMLElement),
  failureMessage: byId('failure-message', HTMLElement),
  viewer: byId('viewer', HTMLElement),
  layerButtons: byId('layer-buttons', HTMLElement),
  opacity: byId('opacity', HTMLInputElement),
  elaControl: byId('ela-control', HTMLElement),
  elaQuality: byId('ela-quality', HTMLInputElement),
  elaQualityValue: byId('ela-quality-value', HTMLOutputElement),
  loupeButton: byId('loupe-button', HTMLButtonElement),
  hint: byId('layer-hint', HTMLElement),
  panel: byId('panel-body', HTMLElement),
  status: byId('status-text', HTMLElement),
  samples: byId('samples', HTMLElement),
  exportHtml: byId('export-html', HTMLButtonElement),
  exportJson: byId('export-json', HTMLButtonElement),
};

const viewer = new Viewer({
  wrap: byId('canvas-wrap', HTMLElement),
  canvas: byId('canvas', HTMLCanvasElement),
  loupe: byId('loupe', HTMLElement),
  loupeCanvas: byId('loupe-canvas', HTMLCanvasElement),
  readout: byId('loupe-readout', HTMLElement),
  store,
});

/**
 * @param {string} name
 * @param {ArrayBuffer} bytes
 * @param {Sample | null} sample
 */
async function analyse(name, bytes, sample = null) {
  store.set({ phase: 'loading', fileName: name, progress: null, error: null, sample });
  try {
    const result = await client.analyze(name, bytes, (progress) => store.set({ progress }));
    const wanted = sample?.layer ?? 'original';
    store.set({
      phase: 'ready',
      result,
      layer: availableLayers(result).includes(wanted) ? wanted : 'original',
      elaQuality: result.layers.ela?.quality ?? null,
    });
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error).code === 'cancelled') return;
    store.set({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}

/** @param {File} file */
async function openFile(file) {
  await analyse(file.name, await file.arrayBuffer());
}

/** @param {Sample} sample */
async function openSample(sample) {
  let bytes;
  try {
    bytes = await loadSample(sample);
  } catch (error) {
    store.set({ phase: 'error', error: `The sample could not be loaded: ${String(error)}` });
    return;
  }
  await analyse(sample.file, bytes, sample);
}

/** @param {AnalysisResult} result */
function availableLayers(result) {
  const l = result.layers;
  /** @type {Record<LayerId, boolean>} */
  const has = {
    original: true,
    ela: Boolean(l.ela),
    dct: Boolean(l.dct?.map),
    copymove: Boolean(l.copyMove),
    noise: Boolean(l.noise),
    residual: Boolean(l.noise),
    gradient: Boolean(l.gradient),
  };
  return LAYERS.filter((layer) => has[layer.id]).map((layer) => layer.id);
}

/** @param {State} state */
function renderPhase(state) {
  els.empty.hidden = state.phase !== 'empty';
  els.busy.hidden = state.phase !== 'loading';
  els.failure.hidden = state.phase !== 'error';
  els.viewer.hidden = state.phase !== 'ready';
  els.exportHtml.disabled = state.phase !== 'ready';
  els.exportJson.disabled = state.phase !== 'ready';
  if (state.phase === 'loading') {
    els.busyFile.textContent = state.fileName;
    els.busyProgress.max = state.progress?.total ?? 8;
    els.busyProgress.value = state.progress ? state.progress.index + 1 : 0;
    els.busyStage.textContent = state.progress ? state.progress.stage : 'Reading file';
  }
  if (state.phase === 'error') els.failureMessage.textContent = state.error ?? '';
}

/** @param {State} state */
function renderToolbar(state) {
  const result = state.result;
  clear(els.layerButtons);
  if (!result) return;
  availableLayers(result).forEach((id, i) => {
    const layer = LAYERS.find((l) => l.id === id);
    if (!layer) return;
    els.layerButtons.append(
      h('button', {
        class: 'button small',
        text: layer.label,
        title: `${layer.hint} (${i + 1})`,
        attrs: { type: 'button', 'aria-pressed': String(state.layer === id) },
        on: { click: () => store.set({ layer: id }) },
      }),
    );
  });
  els.opacity.value = String(state.opacity);
  els.loupeButton.setAttribute('aria-pressed', String(state.loupe));
  els.elaControl.hidden = state.layer !== 'ela' || !result.layers.ela;
  if (state.elaQuality !== null) {
    els.elaQuality.value = String(state.elaQuality);
    els.elaQualityValue.textContent = String(state.elaQuality);
  }
  const hint = LAYERS.find((l) => l.id === state.layer)?.hint ?? '';
  els.hint.textContent = state.sample ? `${hint} Sample: ${state.sample.description}` : hint;
}

/** @param {State} state */
function renderPanel(state) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.getAttribute('data-tab') === state.tab));
  });
  clear(els.panel);
  const result = state.result;
  if (state.phase !== 'ready' || !result) {
    els.panel.append(
      h('p', {
        class: 'muted',
        text: 'Open an image to see its findings, JPEG structure and metadata. Decoding and every analysis run in a Web Worker in this tab; the file is not uploaded.',
      }),
    );
    return;
  }
  if (state.tab === 'summary')
    els.panel.append(summaryPanel(result, (layer) => store.set({ layer })));
  else if (state.tab === 'jpeg') els.panel.append(jpegPanel(result));
  else els.panel.append(metadataPanel(result));
}

/** @param {State} state */
function renderStatus(state) {
  const r = state.result;
  if (state.phase === 'ready' && r) {
    const dims = r.image ? `${r.image.width} x ${r.image.height}, ` : '';
    const total = Object.values(r.timings).reduce((a, b) => a + b, 0);
    els.status.textContent = `${r.file.name}: ${r.file.format.label}, ${dims}${formatBytes(r.file.size)}, analysed in ${Math.round(total)} ms`;
  } else if (state.phase === 'loading') {
    els.status.textContent = `Analysing ${state.fileName}`;
  } else {
    els.status.textContent = 'No image loaded.';
  }
}

store.subscribe((state, previous) => {
  if (
    state.phase !== previous.phase ||
    state.progress !== previous.progress ||
    state.error !== previous.error
  ) {
    renderPhase(state);
  }
  if (
    state.result !== previous.result ||
    state.layer !== previous.layer ||
    state.opacity !== previous.opacity ||
    state.loupe !== previous.loupe ||
    state.elaQuality !== previous.elaQuality ||
    state.sample !== previous.sample
  ) {
    renderToolbar(state);
  }
  if (
    state.result !== previous.result ||
    state.tab !== previous.tab ||
    state.phase !== previous.phase
  ) {
    renderPanel(state);
  }
  renderStatus(state);
});

bindInput({
  dropzone: byId('dropzone', HTMLElement),
  openButton: byId('open-button', HTMLElement),
  fileInput: byId('file-input', HTMLInputElement),
  onFile: (file) => void openFile(file),
});

byId('cancel-button', HTMLElement).addEventListener('click', () => {
  client.cancel();
  store.set({ phase: store.get().result ? 'ready' : 'empty' });
});
byId('failure-back', HTMLElement).addEventListener('click', () =>
  store.set({ phase: 'empty', result: null }),
);
els.opacity.addEventListener('input', () => store.set({ opacity: Number(els.opacity.value) }));
els.loupeButton.addEventListener('click', () => store.set({ loupe: !store.get().loupe }));
els.elaQuality.addEventListener('input', () => {
  els.elaQualityValue.textContent = els.elaQuality.value;
});
els.elaQuality.addEventListener('change', async () => {
  const { result } = store.get();
  const quality = Number(els.elaQuality.value);
  if (!result?.raster) return;
  try {
    const ela = await client.rerunEla(result.raster, quality);
    if (store.get().result !== result) return;
    store.set({ result: { ...result, layers: { ...result.layers, ela } }, elaQuality: quality });
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error).code === 'cancelled') return;
    store.set({ phase: 'error', error: String(error) });
  }
});
els.exportHtml.addEventListener('click', () => {
  const { result } = store.get();
  if (result) exportHtml(result, viewer, availableLayers(result));
});
els.exportJson.addEventListener('click', () => {
  const { result } = store.get();
  if (result) exportJson(result);
});
document.querySelectorAll('[data-zoom]').forEach((button) => {
  button.addEventListener('click', () => {
    const z = button.getAttribute('data-zoom');
    viewer.setZoom(z === 'fit' ? 'fit' : Number(z));
  });
});
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.getAttribute('data-tab');
    if (name === 'summary' || name === 'jpeg' || name === 'metadata') store.set({ tab: name });
  });
});
document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey)
    return;
  const state = store.get();
  if (event.key === 'm' || event.key === 'M') store.set({ loupe: !state.loupe });
  const n = Number(event.key);
  if (state.result && Number.isInteger(n) && n >= 1) {
    const layer = availableLayers(state.result)[n - 1];
    if (layer) store.set({ layer });
  }
});

/** Sample cards, then an optional deep link such as ?sample=clone&layer=copymove. */
async function start() {
  /** @type {Sample[]} */
  let samples;
  try {
    samples = await loadManifest();
  } catch {
    els.samples.append(h('li', { class: 'muted', text: 'Samples are not available.' }));
    return;
  }
  for (const sample of samples) {
    els.samples.append(
      h(
        'li',
        {},
        h(
          'button',
          {
            class: 'sample',
            attrs: { type: 'button' },
            on: { click: () => void openSample(sample) },
          },
          h('img', { attrs: { src: sampleUrl(sample), alt: '', loading: 'lazy' } }),
          h('strong', { text: sample.title }),
          h('span', { text: sample.description }),
        ),
      ),
    );
  }
  const params = new URLSearchParams(location.search);
  const wanted = samples.find((s) => s.id === params.get('sample'));
  if (wanted) {
    const layer = LAYERS.find((l) => l.id === params.get('layer'));
    await openSample(layer ? { ...wanted, layer: layer.id } : wanted);
  }
}

renderPhase(store.get());
renderPanel(store.get());
void start();
