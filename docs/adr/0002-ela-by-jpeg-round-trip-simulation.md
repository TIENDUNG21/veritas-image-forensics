# 0002. Error level analysis by simulating the JPEG round trip on luminance

Status: accepted

## Context

Error level analysis (ELA) re-saves an image at a known quality and shows how much each pixel
changes. The usual browser implementation draws the image to a canvas, calls
`canvas.toBlob('image/jpeg', q)` and decodes the result. That has three problems:

1. The encoder is the browser's. Its quality-to-table mapping, chroma subsampling and
   rounding differ between engines, so the same file gives different ELA images in Chrome
   and Firefox, and the Node tests could not reproduce either.
2. It needs a DOM canvas or `OffscreenCanvas`, which is not available in the test runner.
3. An RGB round trip adds rounding error from the colour conversion and from chroma
   subsampling to every pixel, including untouched ones. That floor lowers the contrast
   between content saved before and content added since.

## Decision

`src/analysis/jpegsim.js` reproduces only the lossy part of a baseline JPEG save on one plane:
8x8 forward DCT, quantization with the IJG (Annex K) luminance table scaled for quality q,
dequantization, inverse DCT, rounding and clamping. Entropy coding is lossless and is skipped.
ELA runs this on the luminance of the decoded image and takes the absolute difference.
Per-block means are then compared with the image's typical block error to report hotspots,
ignoring flat blocks (luma standard deviation below 3), which carry no signal.

## Consequences

- ELA is deterministic and identical in Node and in every browser, so it is unit-tested:
  an untouched JPEG yields no hotspot, a never-compressed image is called "uniform" rather
  than given an invented hotspot, and a region pasted after the last save is found.
- Colour-only edits (hue changes with unchanged luminance) are invisible to this ELA. The
  noise and gradient layers do not cover that gap either; it is listed under Limitations.
- The simulation matches what a libjpeg-style encoder does to luminance; it is not a claim
  about how a particular camera or editor quantized the file. ELA remains a visual aid: the
  findings text says where to look, not what happened.
