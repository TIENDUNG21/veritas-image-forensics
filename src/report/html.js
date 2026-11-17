import { isImageDataUrl } from './model.js';

/**
 * Self-contained HTML report. Every string from the file (name, EXIF, XMP, comments) is
 * escaped; images are inline data URLs; the page carries its own CSP that forbids
 * scripts and any network access, so a hostile file name or tag cannot run code in it.
 *
 * @typedef {import('./model.js').ReportModel} ReportModel
 */

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const e = escapeHtml;

/**
 * @param {[string, unknown][]} rows
 */
function facts(rows) {
  const body = rows
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(v)}</td></tr>`)
    .join('');
  return `<table>${body}</table>`;
}

/** @param {{ x: number, y: number, w: number, h: number }} r */
const rect = (r) => `${r.w} x ${r.h} at (${r.x}, ${r.y})`;

/**
 * @param {ReportModel} m
 * @returns {string}
 */
export function renderReportHtml(m) {
  const findings = m.findings
    .map(
      (f) =>
        `<div class="finding ${e(f.severity)}"><span>${e(f.severity)}</span><strong>${e(f.title)}</strong><p>${e(f.detail)}</p></div>`,
    )
    .join('');
  const images = m.images
    .filter((i) => isImageDataUrl(i.dataUrl))
    .map(
      (i) =>
        `<figure><img src="${i.dataUrl}" alt="${e(i.label)}"><figcaption>${e(i.label)}</figcaption></figure>`,
    )
    .join('');
  const jpeg = m.jpeg;
  const dc = m.doubleCompression;
  const meta = m.metadata;

  const sections = [
    `<h2>Findings</h2>${findings || '<p>Nothing to report.</p>'}`,
    m.notices.length > 0
      ? `<h2>Analysis notes</h2><ul>${m.notices.map((n) => `<li>${e(n)}</li>`).join('')}</ul>`
      : '',
    images ? `<h2>Layers</h2><div class="images">${images}</div>` : '',
    `<h2>File</h2>${facts([
      ['Name', m.file.name],
      ['Size', `${m.file.size} bytes`],
      ['Format', m.file.format],
      ['Dimensions', m.file.width === null ? null : `${m.file.width} x ${m.file.height}`],
      [
        'Analysed at',
        m.analysedSize && m.analysedSize.scale < 1
          ? `${m.analysedSize.width} x ${m.analysedSize.height}`
          : null,
      ],
    ])}`,
    jpeg
      ? `<h2>JPEG</h2>${facts([
          ['Coding', jpeg.coding],
          ['Sampling', jpeg.sampling],
          [
            'Estimated quality',
            jpeg.quality === null
              ? null
              : `${jpeg.quality}${jpeg.qualityExact ? ' (exact IJG tables)' : ''}`,
          ],
          ['Decoder', jpeg.decoder],
          ['Bytes after EOI', jpeg.trailingBytes],
          [
            'Double compression',
            dc
              ? dc.likely
                ? `likely, earlier quality ${dc.primaryQuality ?? 'unknown'}`
                : 'not detected'
              : null,
          ],
          ['DCT evidence score', dc?.score],
        ])}${jpeg.quantTables
          .map(
            (t) =>
              `<p class="muted">Quantization table ${e(t.id)}</p><pre>${e(grid(t.values))}</pre>`,
          )
          .join('')}`
      : '',
    analyses(m),
    meta
      ? `<h2>Metadata</h2>${facts([
          ['Container', meta.container],
          ['Latitude', meta.gps?.latitude],
          ['Longitude', meta.gps?.longitude],
          ['XMP creator tool', meta.xmp?.creatorTool],
          ['XMP modified', meta.xmp?.modifyDate],
          ['ICC profile', meta.icc?.description],
          ...meta.properties.map((p) => /** @type {[string, unknown]} */ ([p.label, p.value])),
          ...meta.comments.map((c) => /** @type {[string, unknown]} */ (['Comment', c])),
        ])}${
          meta.exif.length > 0
            ? `<h3>EXIF</h3><table>${meta.exif.map((f) => `<tr><th>${e(f.ifd)} ${e(f.name)}</th><td>${e(f.value)}</td></tr>`).join('')}</table>`
            : ''
        }`
      : '',
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veritas report: ${e(m.file.name)}</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>${e(m.file.name)}</h1><p class="muted">${e(m.generator.name)} ${e(m.generator.version)}, ${e(m.generatedAt)}. Findings point at where to look; none of them proves an image is fake or genuine on its own.</p></header>
${sections.join('\n')}
</body>
</html>
`;
}

/** @param {ReportModel} m */
function analyses(m) {
  const rows = /** @type {[string, unknown][]} */ ([]);
  if (m.ela) {
    rows.push([
      'ELA',
      `resaved at quality ${m.ela.quality}, mean ${m.ela.mean}, max ${m.ela.max} levels`,
    ]);
    m.ela.hotspots.forEach((r, i) => rows.push([`ELA hotspot ${i + 1}`, rect(r)]));
  }
  if (m.noise) {
    rows.push([
      'Noise',
      `sigma ${m.noise.sigma}${m.noise.reliable ? '' : ' (too little noise to compare regions)'}`,
    ]);
    m.noise.regions.forEach((r, i) => rows.push([`Noise outlier ${i + 1}`, rect(r)]));
  }
  if (m.copyMove) {
    m.copyMove.pairs.forEach((p, i) =>
      rows.push([
        `Clone ${i + 1}`,
        `${rect(p.source)} and ${rect(p.target)}, shift (${p.dx}, ${p.dy})`,
      ]),
    );
    if (m.copyMove.pairs.length === 0)
      rows.push(['Copy-move', `no duplicated areas in ${m.copyMove.blocksAnalysed} blocks`]);
  }
  if (m.doubleCompression) {
    m.doubleCompression.regions.forEach((r, i) => rows.push([`DCT outlier ${i + 1}`, rect(r)]));
  }
  if (m.thumbnail) {
    rows.push([
      'EXIF thumbnail',
      !m.thumbnail.comparable
        ? 'different shape, not compared'
        : `${m.thumbnail.differs ? 'differs from' : 'matches'} the image (largest cell difference ${m.thumbnail.maxCellDiff})`,
    ]);
  }
  return rows.length > 0 ? `<h2>Pixel analyses</h2>${facts(rows)}` : '';
}

/** @param {number[]} values */
function grid(values) {
  const lines = [];
  for (let r = 0; r < 8; r++) {
    lines.push(
      values
        .slice(r * 8, r * 8 + 8)
        .map((v) => String(v).padStart(4))
        .join(''),
    );
  }
  return lines.join('\n');
}

const STYLE = `
body{margin:0 auto;max-width:960px;padding:24px;background:#0a0a0a;color:#ededed;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
h1{font-size:20px;margin:0 0 4px;overflow-wrap:anywhere}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#9aa1a6;margin:28px 0 8px}
h3{font-size:13px;color:#9aa1a6}.muted{color:#9aa1a6}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;vertical-align:top;padding:3px 8px;border-bottom:1px solid #262a2d;overflow-wrap:anywhere}th{color:#9aa1a6;font-weight:500;width:32%}
.finding{background:#181b1d;border:1px solid #262a2d;border-left:3px solid #9aa1a6;border-radius:6px;padding:8px 12px;margin-bottom:8px}
.finding.warning{border-left-color:#f0b24a}.finding.notice{border-left-color:#8fb3ff}.finding span{font-size:11px;text-transform:uppercase;color:#9aa1a6;margin-right:8px}
.finding p{margin:4px 0 0;color:#c9cdd0}.images{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
figure{margin:0}img{width:100%;border:1px solid #262a2d;border-radius:4px}figcaption{font-size:12px;color:#9aa1a6}
pre{font:12px ui-monospace,Consolas,monospace;background:#181b1d;padding:8px;border-radius:4px}
@media print{body{background:#fff;color:#000}.finding{background:#fff}}
`;
