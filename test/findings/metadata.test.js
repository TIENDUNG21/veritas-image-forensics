import { describe, expect, it } from 'vitest';
import { metadataFindings } from '../../src/findings/metadata.js';
import { emptyMetadata } from '../../src/container/metadata.js';
import { parseExif } from '../../src/exif/exif.js';
import { summarizeXmp } from '../../src/exif/xmp.js';
import { TYPE, buildTiff } from '../../tools/fixtures/tiff-builder.mjs';

/**
 * @param {import('../../tools/fixtures/tiff-builder.mjs').Entry[]} ifd0
 * @param {import('../../tools/fixtures/tiff-builder.mjs').Entry[]} [exif]
 */
function withExif(ifd0, exif) {
  const meta = emptyMetadata('jpeg');
  meta.exif = parseExif(buildTiff(exif ? { ifd0, exif } : { ifd0 }));
  return meta;
}

const size = { width: 800, height: 600 };
/** @param {ReturnType<typeof metadataFindings>} findings */
const ids = (findings) => findings.map((f) => f.id);

describe('metadataFindings', () => {
  it('flags editing software and names it', () => {
    const meta = withExif([
      { tag: 0x0131, type: TYPE.ASCII, values: 'Adobe Photoshop 25.0 (Windows)' },
    ]);
    const f = metadataFindings(meta, size).find((x) => x.id === 'editing-software');
    expect(f?.severity).toBe('notice');
    expect(f?.detail).toContain('Adobe Photoshop 25.0 (Windows)');
  });

  it('reports other software as information only', () => {
    const meta = withExif([{ tag: 0x0131, type: TYPE.ASCII, values: 'Camera firmware 1.02' }]);
    const findings = metadataFindings(meta, size);
    expect(ids(findings)).toContain('software');
    expect(ids(findings)).not.toContain('editing-software');
  });

  it('detects a modification date later than capture', () => {
    const meta = withExif(
      [{ tag: 0x0132, type: TYPE.ASCII, values: '2026:11:20 08:00:00' }],
      [{ tag: 0x9003, type: TYPE.ASCII, values: '2026:11:17 08:00:00' }],
    );
    const f = metadataFindings(meta, size).find((x) => x.id === 'modified-after-capture');
    expect(f?.detail).toMatch(/3 days/);
  });

  it('ignores dates that agree', () => {
    const meta = withExif(
      [{ tag: 0x0132, type: TYPE.ASCII, values: '2026:11:17 08:00:30' }],
      [{ tag: 0x9003, type: TYPE.ASCII, values: '2026:11:17 08:00:00' }],
    );
    expect(ids(metadataFindings(meta, size))).not.toContain('modified-after-capture');
  });

  it('notes missing EXIF in a JPEG', () => {
    expect(ids(metadataFindings(emptyMetadata('jpeg'), size))).toContain('no-exif');
    expect(ids(metadataFindings(emptyMetadata('png'), size))).not.toContain('no-exif');
  });

  it('compares the thumbnail shape and the EXIF dimensions with the image', () => {
    const meta = withExif(
      [{ tag: 0x010f, type: TYPE.ASCII, values: 'Veritas' }],
      [
        { tag: 0xa002, type: TYPE.LONG, values: [4000] },
        { tag: 0xa003, type: TYPE.LONG, values: [3000] },
      ],
    );
    meta.thumbnail = { bytes: new Uint8Array(0), width: 160, height: 160, quality: 80 };
    const findings = metadataFindings(meta, size);
    expect(findings.find((f) => f.id === 'thumbnail-shape')?.severity).toBe('warning');
    expect(findings.find((f) => f.id === 'exif-dimensions')?.detail).toMatch(/4000 x 3000/);
  });

  it('summarises XMP history, derivation and GPS', () => {
    const meta = emptyMetadata('jpeg');
    meta.xmp = summarizeXmp(
      '<a xmp:CreatorTool="GIMP 2.10"/><xmpMM:DerivedFrom/><xmpMM:History><rdf:Seq>' +
        '<rdf:li stEvt:action="saved" stEvt:softwareAgent="GIMP 2.10" stEvt:when="2026"/>' +
        '</rdf:Seq></xmpMM:History>',
    );
    meta.exif = parseExif(
      buildTiff({
        ifd0: [{ tag: 0x010f, type: TYPE.ASCII, values: 'x' }],
        gps: [
          { tag: 0x0001, type: TYPE.ASCII, values: 'N' },
          {
            tag: 0x0002,
            type: TYPE.RATIONAL,
            values: [
              [10, 1],
              [0, 1],
              [0, 1],
            ],
          },
          { tag: 0x0003, type: TYPE.ASCII, values: 'E' },
          {
            tag: 0x0004,
            type: TYPE.RATIONAL,
            values: [
              [20, 1],
              [0, 1],
              [0, 1],
            ],
          },
        ],
      }),
    );
    const found = ids(metadataFindings(meta, size));
    expect(found).toEqual(
      expect.arrayContaining(['editing-software', 'xmp-history', 'derived', 'gps']),
    );
  });
});
