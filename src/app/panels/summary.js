import { h, factTable } from '../dom.js';
import { formatBytes, formatDuration } from '../../render/format.js';
import { LAYERS } from '../../render/layers.js';

/**
 * @typedef {import('../../pipeline/analyze.js').AnalysisResult} AnalysisResult
 * @typedef {import('../../render/layers.js').LayerId} LayerId
 */

/**
 * Findings first (most severe on top), then analysis notes and file facts.
 * @param {AnalysisResult} result
 * @param {(layer: LayerId) => void} showLayer
 */
export function summaryPanel(result, showLayer) {
  const count = (/** @type {string} */ s) => result.findings.filter((f) => f.severity === s).length;
  const findings = result.findings.map((f) => {
    const layer = LAYERS.find((l) => l.id === f.layer);
    return h(
      'article',
      { class: `finding ${f.severity}` },
      h(
        'div',
        { class: 'finding-head' },
        h('span', { class: 'severity', text: f.severity }),
        h('strong', { text: f.title }),
        layer &&
          h('button', {
            class: 'button small',
            text: `Show ${layer.label}`,
            on: { click: () => showLayer(layer.id) },
          }),
      ),
      h('p', { text: f.detail }),
    );
  });

  const working = result.working;
  const timings = Object.entries(result.timings)
    .map(([k, v]) => `${k} ${formatDuration(v)}`)
    .join(', ');
  return h(
    'div',
    {},
    h('h3', { text: 'Findings' }),
    h(
      'p',
      { class: 'counts' },
      h('span', { text: `${count('warning')} warning(s)` }),
      h('span', { text: `${count('notice')} notice(s)` }),
      h('span', { class: 'muted', text: `${count('info')} fact(s)` }),
    ),
    findings.length > 0 ? findings : h('p', { class: 'muted', text: 'Nothing to report.' }),
    h(
      'p',
      { class: 'muted' },
      'Each finding points at where to look. None of them proves an image is fake or genuine on its own.',
    ),
    result.notices.length > 0 && [
      h('h3', { text: 'Analysis notes' }),
      h(
        'ul',
        { class: 'notes' },
        result.notices.map((n) => h('li', { text: n })),
      ),
    ],
    h('h3', { text: 'File' }),
    factTable([
      ['Name', result.file.name],
      ['Size', formatBytes(result.file.size)],
      ['Format', result.file.format.label],
      ['Dimensions', result.image ? `${result.image.width} x ${result.image.height}` : ''],
      [
        'Analysed at',
        working && working.scale < 0.999 ? `${working.width} x ${working.height} (downscaled)` : '',
      ],
      ['Decoder', result.jpeg ? decoderLabel(result.jpeg.decoder) : 'browser'],
      ['Timings', timings],
    ]),
  );
}

/** @param {'veritas' | 'browser' | 'none'} d */
function decoderLabel(d) {
  if (d === 'veritas') return 'Veritas baseline JPEG decoder';
  if (d === 'browser') return 'browser (createImageBitmap)';
  return 'none';
}
