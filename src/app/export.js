import { buildReport } from '../report/model.js';
import { renderReportHtml } from '../report/html.js';
import { LAYERS } from '../render/layers.js';
import { paint } from './viewer.js';

/**
 * @typedef {import('../pipeline/analyze.js').AnalysisResult} AnalysisResult
 * @typedef {import('./viewer.js').Viewer} Viewer
 * @typedef {import('../render/layers.js').LayerId} LayerId
 */

/** Report images are capped so a 50 MP photo does not produce a 100 MB HTML file. */
const MAX_REPORT_SIDE = 960;

/** @param {AnalysisResult} result */
export function exportJson(result) {
  const json = JSON.stringify(buildReport(result), null, 2);
  download(`${stem(result.file.name)}.veritas.json`, json, 'application/json');
}

/**
 * @param {AnalysisResult} result
 * @param {Viewer} viewer
 * @param {LayerId[]} layers Layers available for this result.
 */
export function exportHtml(result, viewer, layers) {
  const images = [];
  for (const id of layers) {
    const dataUrl = snapshot(viewer, id);
    const label = LAYERS.find((l) => l.id === id)?.label ?? id;
    if (dataUrl) images.push({ id, label, dataUrl });
  }
  const html = renderReportHtml(buildReport(result, { images }));
  download(`${stem(result.file.name)}.veritas.html`, html, 'text/html');
}

/**
 * The image with one layer composited over it, as a JPEG data URL.
 * @param {Viewer} viewer
 * @param {LayerId} id
 */
function snapshot(viewer, id) {
  const base = viewer.base;
  if (!base) return null;
  const scale = Math.min(1, MAX_REPORT_SIDE / Math.max(base.width, base.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(base.width * scale);
  canvas.height = Math.round(base.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const layer = id === 'original' ? null : viewer.layer(id);
  if (id !== 'original' && !layer) return null;
  paint(ctx, { scale, offsetX: 0, offsetY: 0 }, base, layer, 0.8);
  // JPEG: composited photographs are 5-10x smaller than as PNG, and the report is for reading.
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** @param {string} name */
function stem(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
  return base.slice(0, 80) || 'image';
}

/**
 * @param {string} name
 * @param {string} text
 * @param {string} type
 */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
