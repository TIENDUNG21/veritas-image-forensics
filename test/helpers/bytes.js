// Helpers for building small binary inputs by hand in tests.

/**
 * @param {...(ArrayLike<number>)} parts
 * @returns {Uint8Array}
 */
export function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * A JPEG marker segment: FF xx, 16-bit length (payload + 2), payload.
 * @param {number} marker Second marker byte, e.g. 0xdb for DQT.
 * @param {ArrayLike<number>} payload
 */
export function segment(marker, payload) {
  const len = payload.length + 2;
  return concat([0xff, marker, len >> 8, len & 0xff], payload);
}

/** @param {string} text */
export function ascii(text) {
  return [...text].map((c) => c.charCodeAt(0));
}

/**
 * Finds the first occurrence of the two-byte marker FF `marker`.
 * @param {Uint8Array} bytes
 * @param {number} marker
 */
export function findMarker(bytes, marker) {
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === marker) return i;
  }
  return -1;
}
