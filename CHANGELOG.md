# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-17

First release.

### Added

- Baseline and extended-sequential JPEG decoder: marker parser, Huffman decoding to DCT
  coefficients with restart-marker resynchronisation and partial results for truncated
  scans, float IDCT, chroma upsampling. Progressive, arithmetic-coded, 12-bit and CMYK
  files fall back to the browser decoder, and the UI says which decoder ran.
- JPEG quality estimate against the IJG tables, with a flag for non-standard tables.
- Double-compression detection from DCT coefficient histograms, estimate of the earlier
  quality, and a per-block map of regions with a different compression history.
- Error level analysis on luminance by JPEG round-trip simulation, with hotspot regions and
  a quality slider that re-runs it in the worker.
- Noise-level map (Laplacian residual, median estimate per block) with outlier regions;
  noise residual and Sobel gradient layers.
- Copy-move detection by overlapping-block DCT features, lexicographic sort and shift-vector
  voting, on a copy of at most 1024 px.
- Metadata: EXIF (IFD0, Exif, GPS, Interoperability, IFD1 thumbnail) in both byte orders,
  XMP summary with edit history, ICC profile description, PNG text/eXIf/tIME chunks, WebP
  VP8/VP8L/VP8X/EXIF/XMP chunks. Comparison of the EXIF thumbnail with the image.
- Findings with three severities and neutral wording, derived from all of the above.
- Browser app: drop, paste or open a file; layered viewer with opacity, zoom, pan, region
  outlines and a magnifier with the 8x8 grid; summary, JPEG and metadata panels; keyboard
  shortcuts for layers.
- Export as a self-contained HTML report (escaped, own CSP, no scripts) or JSON.
- Five procedurally generated samples with documented edits, loadable by
  `?sample=<id>&layer=<id>`.
- Limits checked from headers before allocation: 64 MB per file, 50 MP decoded, analyses on a
  copy of at most 16 MP; 120 s worker timeout and cancel.
- No-network enforcement: production CSP limited to the app's origin, a static test over
  `src/`, and a build check on the CSP.
- Benchmark (`npm run bench`), synthetic evaluation (`npm run evaluate`) and screenshot
  (`npm run screenshot`) scripts; GitHub Pages deployment.

[1.0.0]: https://github.com/TIENDUNG21/veritas-image-forensics/releases/tag/v1.0.0
