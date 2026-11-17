// Measures how often the copy-move and double-compression detectors fire on generated
// forgeries and on untouched images, and writes docs/EVALUATION.md. Deterministic: seeded
// scenes, the project's own encoder and the same pipeline the app runs.
//
//   node tools/evaluate.mjs [--seeds 25]
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { parseArgs } from 'node:util';
import { analyzeImage } from '../src/pipeline/analyze.js';
import { decodeJpeg } from '../src/jpeg/decode.js';
import { createRaster } from '../src/core/raster.js';
import { landscape } from './fixtures/scene.mjs';
import { copyRect, mulberry32 } from './fixtures/synth.mjs';
import { encodeJpeg } from './fixtures/jpeg-writer.mjs';

/**
 * @typedef {import('../src/core/raster.js').Raster} Raster
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 */

const { values } = parseArgs({ options: { seeds: { type: 'string', default: '25' } } });
const SEEDS = Number(values.seeds);
const W = 768;
const H = 512;

/** @param {Uint8Array} bytes */
const analyse = (bytes) => analyzeImage(bytes, { name: 'eval.jpg' });

/** @param {Rect} a @param {Rect} b */
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** @param {number} k @param {number} n */
const pct = (k, n) => `${((100 * k) / n).toFixed(0)}% (${k}/${n})`;

/**
 * A copy-move forgery: a 64-128 px patch from the textured lower half (field and trees)
 * pasted at a random non-overlapping position in the lower half.
 * @param {number} seed
 */
function forge(seed) {
  const { raster, horizon } = landscape(W, H, seed);
  const rand = mulberry32(seed * 7919);
  const size = () => 64 + Math.floor(rand() * 65);
  const w = size();
  const h = size();
  const top = horizon + 8;
  const pick = () => ({
    x: Math.floor(rand() * (W - w)),
    y: top + Math.floor(rand() * (H - h - top)),
  });
  const source = { ...pick(), w, h };
  let target = { ...pick(), w, h };
  for (let i = 0; i < 100 && overlaps(source, target); i++) target = { ...pick(), w, h };
  copyRect(raster, source, raster, target.x, target.y);
  return { raster, source, target };
}

/**
 * Crops `n` pixels from the left and top, which moves the 8x8 grid of any later save.
 * @param {Raster} src
 * @param {number} n
 */
function crop(src, n) {
  const out = createRaster(src.width - n, src.height - n);
  for (let y = 0; y < out.height; y++) {
    const from = ((y + n) * src.width + n) * 4;
    out.data.set(src.data.subarray(from, from + out.width * 4), y * out.width * 4);
  }
  return out;
}

const lines = [];
const started = performance.now();

// Copy-move.
const cmRows = [];
for (const quality of [95, 85, 75]) {
  let found = 0;
  let located = 0;
  let falseAlarms = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const forged = forge(seed);
    const r = await analyse(encodeJpeg(forged.raster, { quality }));
    const pairs = r.layers.copyMove?.pairs ?? [];
    if (pairs.length > 0) found++;
    const hit = pairs.some(
      (p) =>
        (overlaps(p.source, forged.source) && overlaps(p.target, forged.target)) ||
        (overlaps(p.source, forged.target) && overlaps(p.target, forged.source)),
    );
    if (hit) located++;
    const clean = await analyse(encodeJpeg(landscape(W, H, seed).raster, { quality }));
    if ((clean.layers.copyMove?.pairs.length ?? 0) > 0) falseAlarms++;
  }
  cmRows.push(
    `| ${quality} | ${pct(found, SEEDS)} | ${pct(located, SEEDS)} | ${pct(falseAlarms, SEEDS)} |`,
  );
  console.log(`copy-move q${quality}: found ${found}, located ${located}, false ${falseAlarms}`);
}

// Double compression.
const dcRows = [];
/** @type {[number, number, number][]} q1, q2, crop */
const pairs = [
  [60, 90, 0],
  [70, 90, 0],
  [80, 90, 0],
  [70, 95, 0],
  [85, 95, 0],
  [60, 80, 0],
  [90, 70, 0],
  [70, 90, 3],
];
for (const [q1, q2, shift] of pairs) {
  let detected = 0;
  let exact = 0;
  let within5 = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const first = decodeJpeg(encodeJpeg(landscape(W, H, 100 + seed).raster, { quality: q1 }));
    const r = await analyse(encodeJpeg(shift ? crop(first, shift) : first, { quality: q2 }));
    const dct = r.layers.dct;
    if (dct?.likely) {
      detected++;
      if (dct.primaryQuality === q1) exact++;
      if (dct.primaryQuality !== null && Math.abs(dct.primaryQuality - q1) <= 5) within5++;
    }
  }
  const note = shift ? ` after a ${shift} px crop` : q1 > q2 ? ' (second save lower)' : '';
  dcRows.push(
    `| ${q1} then ${q2}${note} | ${pct(detected, SEEDS)} | ${detected ? pct(exact, detected) : '-'} | ${detected ? pct(within5, detected) : '-'} |`,
  );
  console.log(`dct ${q1}->${q2} crop ${shift}: detected ${detected}, exact ${exact}`);
}
const negRows = [];
for (const q of [80, 90, 95]) {
  let fp = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = await analyse(encodeJpeg(landscape(W, H, 100 + seed).raster, { quality: q }));
    if (r.layers.dct?.likely) fp++;
  }
  negRows.push(`| ${q} | ${pct(fp, SEEDS)} |`);
  console.log(`dct single q${q}: false ${fp}`);
}

const seconds = ((performance.now() - started) / 1000).toFixed(0);
lines.push(`# Evaluation

Generated by \`node tools/evaluate.mjs\` (${SEEDS} seeds per condition, ${seconds} s on
${cpus()[0]?.model.replace(/\s+/g, ' ').trim()}). Every image is a procedurally generated
${W} x ${H} landscape (sky, clouds, mountains, a textured field and trees) saved with the
project's own baseline JPEG encoder, then analysed by the same pipeline the app runs.

These are synthetic conditions chosen to measure the detectors, not a forensic benchmark:
real photographs carry camera noise, demosaicing traces and editing-software resampling that
the generator does not reproduce. Treat the numbers as the behaviour of the algorithms under
controlled edits, not as the accuracy to expect on arbitrary images from the internet.

## Copy-move

A patch of 64 to 128 px per side is copied from the field (lower part of the image) to a
random non-overlapping position in the same area, without scaling or rotation, and the result
is saved once at the given quality. "Located" means a reported pair overlaps both the true
source and the true target. "False alarms" counts untouched images of the same seeds that
produced any pair.

| JPEG quality | Found | Located | False alarms |
| ---: | --- | --- | --- |
${cmRows.join('\n')}

## Double compression

The scene is saved at quality q1, decoded, and saved again at q2 on the same 8x8 grid
(unless a crop moves the grid). "Detected" is the share flagged as saved twice; the
quality columns score the estimate of q1 among the detected ones.

| Saves | Detected | q1 exact | q1 within 5 |
| --- | --- | --- | --- |
${dcRows.join('\n')}

Untouched images saved once:

| Quality | Flagged as saved twice |
| ---: | --- |
${negRows.join('\n')}

The method needs the second quantization step to be finer than the first for at least some
frequencies, and the two grids to coincide. A second save at lower quality, or a crop by a
non-multiple of 8 between the saves, removes the evidence it looks for; both rows are kept
in the table on purpose.
`);

mkdirSync('docs', { recursive: true });
writeFileSync('docs/EVALUATION.md', lines.join('\n'));
console.log('wrote docs/EVALUATION.md');
