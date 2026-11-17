import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeImage } from '../../src/pipeline/analyze.js';
import { decodeOwnPng } from '../../tools/fixtures/png-writer.mjs';

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {{ id: string, file: string, edited: null | { kind: string, region?: Rect, source?: Rect, target?: Rect, firstQuality?: number } }} Sample
 */

const dir = join(process.cwd(), 'public', 'samples');
/** @type {Sample[]} */
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));

/** @param {Sample} sample */
async function analyse(sample) {
  const bytes = new Uint8Array(readFileSync(join(dir, sample.file)));
  return analyzeImage(bytes, {
    name: sample.file,
    decodeFallback: async () => decodeOwnPng(bytes),
  });
}

/**
 * @param {Rect} a
 * @param {Rect} b
 */
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** @param {string} id */
const sample = (id) => {
  const s = manifest.find((m) => m.id === id);
  if (!s) throw new Error(`sample ${id} missing from manifest`);
  return s;
};

describe('built-in samples', () => {
  it('lists five samples that exist', () => {
    expect(manifest.map((m) => m.id)).toEqual([
      'original',
      'clone',
      'splice',
      'thumbnail',
      'export',
    ]);
  });

  it('reports nothing suspicious for the untouched image', async () => {
    const result = await analyse(sample('original'));
    expect(result.findings.filter((f) => f.severity !== 'info')).toEqual([]);
  });

  it('finds the cloned tree where it was cloned', async () => {
    const s = sample('clone');
    const result = await analyse(s);
    const pair = result.layers.copyMove?.pairs[0];
    if (!pair || !s.edited?.source || !s.edited.target) throw new Error('expected a clone');
    expect(overlaps(pair.source, s.edited.source)).toBe(true);
    expect(overlaps(pair.target, s.edited.target)).toBe(true);
  });

  it('localises the tree added between two saves and the first quality', async () => {
    const s = sample('splice');
    const result = await analyse(s);
    const region = result.layers.dct?.regions[0];
    if (!region || !s.edited?.region) throw new Error('expected a DCT region');
    expect(overlaps(region, s.edited.region)).toBe(true);
    expect(result.layers.dct?.primaryQuality).toBe(s.edited.firstQuality);
  });

  it('notices the stale EXIF thumbnail, the dates and the GPS position', async () => {
    const s = sample('thumbnail');
    const result = await analyse(s);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(['thumbnail-content', 'modified-after-capture', 'gps']),
    );
    const region = result.thumbnail?.region;
    if (!region || !s.edited?.region) throw new Error('expected a thumbnail region');
    expect(overlaps(region, s.edited.region)).toBe(true);
  });

  it('shows the tree added to the exported PNG in ELA', async () => {
    const s = sample('export');
    const result = await analyse(s);
    const hot = result.layers.ela?.hotspots[0];
    if (!hot || !s.edited?.region) throw new Error('expected an ELA hotspot');
    expect(overlaps(hot, s.edited.region)).toBe(true);
    expect(result.jpeg).toBeNull();
  });
});
