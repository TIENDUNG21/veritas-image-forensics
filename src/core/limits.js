/**
 * Resource limits. They keep the app responsive and protect against decompression bombs:
 * every limit is checked from header fields before large buffers are allocated.
 */

/** Largest file accepted, in bytes. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Largest image decoded at all, in pixels (checked from SOF / IHDR / VP8X first). */
export const MAX_DECODE_PIXELS = 50_000_000;

/** Pixel analyses run on a working copy of at most this many pixels; larger images are downscaled. */
export const MAX_WORKING_PIXELS = 16_000_000;

/** Copy-move detection runs on a copy whose longest side is at most this many pixels. */
export const COPY_MOVE_MAX_SIDE = 1024;
