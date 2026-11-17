# 0001. Decode baseline JPEG with our own decoder in the worker

Status: accepted

## Context

Three of the analyses (double compression, ELA, the magnifier's block grid) only make sense
if pixel (x, y) in the analysed raster is exactly the sample the file stores at (x, y), and
the double-compression test needs the quantized DCT coefficients themselves, not pixels.

The browser's decoder (`createImageBitmap`, `<img>` + canvas) gives none of that reliably. It
applies EXIF orientation (a rotated file moves the 8x8 grid), may colour-manage, uses
implementation-specific upsampling and IDCT, and never exposes coefficients. Results would
differ between Chrome, Firefox and Safari, and between the browser and the Node tests.

## Decision

`src/jpeg` contains a complete baseline and extended-sequential decoder: marker parser,
Huffman decoding to coefficients (with restart-interval resync and partial results for
damaged scans), dequantization, a separable float IDCT, chroma upsampling and YCbCr to RGB.
The worker runs it first for every JPEG. The coefficient planes go to the double-compression
analysis; the pixels go to the pixel analyses, in stored orientation.

Progressive and arithmetic-coded JPEG, 12-bit and CMYK files fall back to
`createImageBitmap` + `OffscreenCanvas`, as do PNG, WebP, GIF, BMP and AVIF. The UI and the
report state which decoder was used, and the DCT analysis is reported as unavailable for
those files.

## Consequences

- Results are identical in Node (Vitest) and in every browser; the analyses are tested
  against files with known history rather than against one browser's output.
- The decoder is cross-checked against `jpeg-js` (a dev dependency, never shipped) and
  fuzzed with truncation, overwrites and inserted runs; malformed input yields a
  `ParseError` with an offset, never an exception of another kind.
- Progressive JPEG (common on the web) gets pixel analyses but no double-compression test.
  Supporting progressive decoding is on the roadmap; it is a large amount of code for one
  analysis.
- Decoding is slower than the browser's native decoder: about 120 ms for a 4 MP image on
  the benchmark machine (docs/BENCHMARKS.md). It runs off the main thread, so the UI does not
  block.
