import { h, factTable } from '../dom.js';
import { ZIGZAG } from '../../jpeg/tables.js';

/** @typedef {import('../../pipeline/analyze.js').AnalysisResult} AnalysisResult */

/**
 * Quality estimate, quantization tables, double-compression evidence and the marker list.
 * @param {AnalysisResult} result
 */
export function jpegPanel(result) {
  const jpeg = result.jpeg;
  if (!jpeg) {
    return h(
      'p',
      { class: 'muted' },
      `This file is ${result.file.format.label}. Quality estimation, quantization tables and double-compression analysis only apply to JPEG.`,
    );
  }
  const q = jpeg.quality;
  const s = jpeg.structure;
  const dct = result.layers.dct;
  return h(
    'div',
    {},
    h('h3', { text: 'Quality' }),
    q.quality === null
      ? h('p', { class: 'muted', text: 'No quantization tables found.' })
      : [
          h('p', { class: 'big', text: String(q.quality) }),
          h('p', {
            class: 'muted',
            text: q.exact
              ? 'Exact match with the IJG (libjpeg) tables at this quality.'
              : q.standard
                ? 'Close to the IJG tables at this quality, not identical.'
                : 'Custom tables; this is the nearest IJG quality, not an exact setting.',
          }),
        ],
    h('h3', { text: 'Quantization tables' }),
    s.quantTables.map((t) =>
      h(
        'div',
        {},
        h('p', {
          class: 'muted',
          text: `Table ${t.id} (${t.precision}-bit)${tableRole(result, t.id)}`,
        }),
        h(
          'div',
          { class: 'qtable', attrs: { role: 'img', 'aria-label': `Quantization table ${t.id}` } },
          t.values.map((v) => h('span', { text: v })),
        ),
      ),
    ),
    h('h3', { text: 'Double compression' }),
    dct
      ? [
          h('p', {
            text: dct.likely
              ? `Saved at least twice. Earlier quality: ${dct.primaryQuality ?? 'not determined'}.`
              : 'No comb pattern in the DCT histograms. Either the file was saved once, or a later save used the same or a lower quality, which hides an earlier one.',
          }),
          h('p', {
            class: 'muted',
            text: `Median evidence score ${dct.score.toFixed(3)} (above 0.25 counts).`,
          }),
          frequencyTable(dct.frequencies),
        ]
      : h('p', {
          class: 'muted',
          text: 'Not available for this file (progressive or not decodable by Veritas).',
        }),
    h('h3', { text: 'Structure' }),
    factTable([
      ['Coding', s.frame?.type ?? 'no frame header'],
      ['Precision', s.frame ? `${s.frame.precision} bit` : ''],
      ['Sampling', s.frame?.components.map((c) => `${c.id}: ${c.h}x${c.v}`).join(', ') ?? ''],
      ['Scans', String(s.scans)],
      ['Restart interval', s.restartInterval ? `${s.restartInterval} MCUs` : 'none'],
      ['Huffman tables', String(s.huffmanTables)],
      [
        'Blocks decoded',
        jpeg.coefficients
          ? `${jpeg.coefficients.mcusDecoded} of ${jpeg.coefficients.mcusTotal} MCUs`
          : '',
      ],
      ['After EOI', s.trailingBytes ? `${s.trailingBytes} bytes` : 'nothing'],
    ]),
    [...s.warnings, ...(jpeg.coefficients?.warnings ?? [])].length > 0 &&
      h(
        'ul',
        { class: 'notes' },
        [...s.warnings, ...(jpeg.coefficients?.warnings ?? [])].map((w) => h('li', { text: w })),
      ),
    h('h3', { text: 'Segments' }),
    h(
      'table',
      { class: 'data' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { text: 'Marker' }),
          h('th', { class: 'num', text: 'Offset' }),
          h('th', { class: 'num', text: 'Bytes' }),
          h('th', { text: 'Content' }),
        ),
      ),
      h(
        'tbody',
        {},
        s.segments.map((seg) =>
          h(
            'tr',
            {},
            h('td', { text: seg.name }),
            h('td', { class: 'num', text: `0x${seg.offset.toString(16)}` }),
            h('td', { class: 'num', text: seg.length }),
            h('td', { text: s.app.find((a) => a.offset === seg.offset)?.label ?? '' }),
          ),
        ),
      ),
    ),
  );
}

/**
 * @param {AnalysisResult} result
 * @param {number} id
 */
function tableRole(result, id) {
  const users =
    result.jpeg?.structure.frame?.components.filter((c) => c.tq === id).map((c) => c.id) ?? [];
  return users.length > 0 ? `, used by component ${users.join(', ')}` : '';
}

/** @param {import('../../jpeg/double.js').FrequencyEvidence[]} rows */
function frequencyTable(rows) {
  return h(
    'table',
    { class: 'data' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { text: 'DCT (u,v)' }),
        h('th', { class: 'num', text: 'Step now' }),
        h('th', { class: 'num', text: 'Earlier step' }),
        h('th', { text: 'Evidence' }),
      ),
    ),
    h(
      'tbody',
      {},
      rows.map((r) => {
        const idx = ZIGZAG[r.k];
        return h(
          'tr',
          {},
          h('td', { text: `${idx % 8},${idx >> 3}` }),
          h('td', { class: 'num', text: r.q2 }),
          h('td', { class: 'num', text: r.q1 && r.score > 0.25 ? r.q1 : '-' }),
          h('td', {}, bar(r.score), ` ${r.samples < 100 ? 'too few samples' : r.score.toFixed(2)}`),
        );
      }),
    ),
  );
}

/**
 * Evidence bar; width set through CSSOM because the CSP forbids style attributes.
 * @param {number} score
 */
function bar(score) {
  const el = h('span', { class: 'bar' });
  el.style.width = `${Math.round(Math.max(0, Math.min(1, score)) * 80)}px`;
  return el;
}
