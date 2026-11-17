// Generates the built-in sample images in public/samples/ (deterministic: same output on
// every run). Every sample is procedurally drawn by this script; no photo is used.
//
//   node tools/make-samples.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resizeBox } from '../src/core/raster.js';
import { decodeJpeg } from '../src/jpeg/decode.js';
import { drawTree, landscape } from './fixtures/scene.mjs';
import { addNoise, copyRect, valueNoise } from './fixtures/synth.mjs';
import { encodeJpeg } from './fixtures/jpeg-writer.mjs';
import { encodePng, latin1 } from './fixtures/png-writer.mjs';
import { TYPE, buildTiff, exifSegment } from './fixtures/tiff-builder.mjs';

/** @typedef {import('../src/core/raster.js').Raster} Raster */
/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */

const OUT = join(process.cwd(), 'public', 'samples');
mkdirSync(OUT, { recursive: true });

const GENERATOR = 'Veritas sample generator';

/**
 * @param {{ date: string, original?: string, gps?: boolean, thumbnail?: Uint8Array }} options
 */
function exif({ date, original, gps = false, thumbnail }) {
  /** @type {import('./fixtures/tiff-builder.mjs').TiffSpec} */
  const spec = {
    ifd0: [
      { tag: 0x010e, type: TYPE.ASCII, values: 'Veritas built-in sample (procedurally generated)' },
      { tag: 0x010f, type: TYPE.ASCII, values: 'Veritas' },
      { tag: 0x0110, type: TYPE.ASCII, values: 'Procedural landscape' },
      { tag: 0x0112, type: TYPE.SHORT, values: [1] },
      { tag: 0x0131, type: TYPE.ASCII, values: GENERATOR },
      { tag: 0x0132, type: TYPE.ASCII, values: date },
    ],
    exif: [
      { tag: 0x9003, type: TYPE.ASCII, values: original ?? date },
      { tag: 0xa001, type: TYPE.SHORT, values: [1] },
    ],
  };
  if (gps) {
    // Hoan Kiem Lake, Hanoi: 21 deg 1' 42.6" N, 105 deg 51' 15.1" E (illustrative).
    spec.gps = [
      { tag: 0x0000, type: TYPE.BYTE, values: [2, 3, 0, 0] },
      { tag: 0x0001, type: TYPE.ASCII, values: 'N' },
      {
        tag: 0x0002,
        type: TYPE.RATIONAL,
        values: [
          [21, 1],
          [1, 1],
          [426, 10],
        ],
      },
      { tag: 0x0003, type: TYPE.ASCII, values: 'E' },
      {
        tag: 0x0004,
        type: TYPE.RATIONAL,
        values: [
          [105, 1],
          [51, 1],
          [151, 10],
        ],
      },
    ];
  }
  if (thumbnail) {
    spec.ifd1 = [{ tag: 0x0103, type: TYPE.SHORT, values: [6] }];
    spec.thumbnail = thumbnail;
  }
  return exifSegment(buildTiff(spec, { littleEndian: false }));
}

/**
 * Draws a new tree directly onto `raster` (pixels never JPEG-compressed) with matching grain.
 * @param {Raster} raster
 * @param {{ x: number, y: number, size: number }} tree
 * @param {number} seed
 * @returns {Rect} bounding box of the new tree
 */
function addTree(raster, tree, seed) {
  drawTree(raster, tree, valueNoise(raster.width, raster.height, { seed, cell: 24 }));
  const r = Math.ceil(tree.size * 0.45);
  const rect = {
    x: tree.x - r,
    y: Math.round(tree.y - tree.size * 0.35 - tree.size * 0.35 - r * 1.3),
    w: 2 * r + 1,
    h: 0,
  };
  rect.h = tree.y - rect.y;
  addNoise(raster, 2.5, seed + 1, rect);
  return rect;
}

/** @type {object[]} */
const manifest = [];

/**
 * @param {string} file
 * @param {Uint8Array} bytes
 * @param {object} entry
 */
function save(file, bytes, entry) {
  writeFileSync(join(OUT, file), bytes);
  manifest.push({ file, bytes: bytes.length, ...entry });
  console.log(`${file.padEnd(16)} ${(bytes.length / 1024).toFixed(0).padStart(4)} KB`);
}

// 1. An untouched image, to show what a clean result looks like.
{
  const { raster } = landscape(960, 640, 2026);
  save(
    'original.jpg',
    encodeJpeg(raster, { quality: 90, segments: [exif({ date: '2026:11:10 16:20:05' })] }),
    {
      id: 'original',
      title: 'Untouched',
      description: 'A generated landscape saved once as JPEG. Nothing was edited.',
      layer: 'ela',
      edited: null,
    },
  );
}

// 2. Copy-move: one tree cloned to another spot.
{
  const { raster } = landscape(960, 640, 2026);
  const source = { x: 400, y: 412, w: 100, h: 136 };
  copyRect(raster, source, raster, 540, 480);
  save(
    'clone.jpg',
    encodeJpeg(raster, { quality: 92, segments: [exif({ date: '2026:11:11 09:12:40' })] }),
    {
      id: 'clone',
      title: 'Cloned tree',
      description: 'One tree was copied and pasted elsewhere in the same image (copy-move).',
      layer: 'copymove',
      edited: { kind: 'copy-move', source, target: { ...source, x: 540, y: 480 } },
    },
  );
}

// 3. Splice between two saves: first saved at quality 70, a tree added, saved again at 92.
{
  const first = encodeJpeg(landscape(960, 640, 7, { trees: 3 }).raster, { quality: 70 });
  const raster = decodeJpeg(first);
  const rect = addTree(raster, { x: 520, y: 560, size: 110 }, 404);
  save(
    'splice.jpg',
    encodeJpeg(raster, { quality: 92, segments: [exif({ date: '2026:11:13 18:45:00' })] }),
    {
      id: 'splice',
      title: 'Object added between saves',
      description:
        'Saved at quality 70, then a tree was painted in and the file saved again at quality 92.',
      layer: 'dct',
      edited: { kind: 'splice', region: rect, firstQuality: 70 },
    },
  );
}

// 4. Edited after capture: the EXIF thumbnail still shows a tree that was painted out.
{
  const scene = landscape(960, 640, 99, { trees: 4 });
  const thumbnail = encodeJpeg(resizeBox(scene.raster, 160, 107), { quality: 80, sampling: '444' });
  const edited = landscape(960, 640, 99, { trees: 0 });
  const removed = scene.trees[2] ?? { x: 480, y: 520, size: 100 };
  const r = Math.ceil(removed.size * 0.5);
  const rect = {
    x: removed.x - r,
    y: removed.y - removed.size - r,
    w: 2 * r,
    h: removed.size + r + 4,
  };
  const painted = { ...scene.raster, data: scene.raster.data.slice() };
  copyRect(edited.raster, rect, painted, rect.x, rect.y);
  save(
    'thumbnail.jpg',
    encodeJpeg(painted, {
      quality: 90,
      segments: [
        exif({
          date: '2026:11:15 21:02:44',
          original: '2026:11:12 07:41:03',
          gps: true,
          thumbnail,
        }),
      ],
    }),
    {
      id: 'thumbnail',
      title: 'Edited after capture',
      description:
        'A tree was painted out days after capture; the EXIF thumbnail was left as it was.',
      layer: 'ela',
      edited: { kind: 'thumbnail', region: rect },
    },
  );
}

// 5. Edited JPEG exported as PNG: ELA shows what was added after the last JPEG save.
{
  const raster = decodeJpeg(
    encodeJpeg(landscape(640, 427, 11, { trees: 3 }).raster, { quality: 90 }),
  );
  const rect = addTree(raster, { x: 300, y: 380, size: 80 }, 505);
  const png = encodePng(raster, {
    chunks: [{ type: 'tEXt', data: latin1(`Software\0${GENERATOR}`) }],
  });
  save('export.png', png, {
    id: 'export',
    title: 'Edited, exported to PNG',
    description: 'A JPEG (quality 90) with a tree added afterwards, exported as PNG.',
    layer: 'ela',
    edited: { kind: 'ela', region: rect },
  });
}

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
