# 0003. Copy-move detection by block DCT features and shift-vector voting

Status: accepted

## Context

A copy-move forgery duplicates a region inside the same image, typically to hide an object
or to multiply one. Published detectors fall into two families. Block-based methods compare
features of overlapping blocks (Fridrich, Soukal and Lukas, 2003; many later variants with
PCA, Zernike or polar features). Keypoint methods match SIFT or SURF descriptors (Amerini et
al., 2011) and handle rotation and scaling, but need a feature detector and descriptor
implementation and miss clones of low-texture regions with few keypoints.

The detector has to run in a Web Worker on images up to 16 MP within a few hundred
milliseconds, with no dependencies.

## Decision

Fridrich-style exact-match detection:

1. Downscale to a longest side of at most 1024 px (`COPY_MOVE_MAX_SIDE`).
2. For every overlapping 8x8 luminance block (stride 1), compute the 16 lowest-frequency DCT
   coefficients and quantize them with the JPEG luminance steps times a factor, so that
   recompression noise maps to the same feature. Skip blocks whose standard deviation is
   below a threshold: flat sky matches everywhere.
3. Sort the feature rows lexicographically and compare each with its next few neighbours.
4. Each matching pair votes for its shift vector (dx, dy), normalised so (dx, dy) and
   (-dx, -dy) are one shift. Shifts with enough votes whose pairs form a spatially coherent
   cluster survive; both ends are painted into the mask and reported as rectangles in
   full-image pixels.

## Consequences

- On the synthetic evaluation (docs/EVALUATION.md) it locates 22 of 25 unrotated clones
  saved at quality 95, 17 of 25 at quality 85 and 13 of 25 at quality 75: recompression
  noise pushes more block features apart as quality drops. One of the 75 untouched images
  produced a false pair. The vote and texture thresholds trade those two numbers against
  each other; they were set on the bundled samples, where a lower threshold flagged sky and
  field textures.
- Rotated, scaled or mirrored clones are not detected. Keypoint matching would address that
  and is on the roadmap.
- Clones of flat or nearly flat areas are not detected, by design: rejecting low-variance
  blocks is what keeps false alarms on sky and walls near zero. Regular textures (tiles,
  bricks, fences) can produce genuine matches; the finding text says so.
- Which copy is the original cannot be told from pixels; the pair is reported symmetrically.
