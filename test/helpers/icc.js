// Builds minimal ICC profiles (header, tag table, description) for tests.

/**
 * @param {{ description: string, version?: 2 | 4, deviceClass?: string }} options
 * @returns {Uint8Array}
 */
export function buildIcc({ description, version = 2, deviceClass = 'mntr' }) {
  const tag = version === 4 ? mluc(description) : desc(description);
  const tagOffset = 128 + 4 + 12;
  const size = tagOffset + tag.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, size);
  out.set(ascii('lcms'), 4);
  view.setUint32(8, version === 4 ? 0x04300000 : 0x02100000);
  out.set(ascii(deviceClass), 12);
  out.set(ascii('RGB '), 16);
  out.set(ascii('XYZ '), 20);
  out.set(ascii('acsp'), 36);
  view.setUint32(128, 1);
  out.set(ascii('desc'), 132);
  view.setUint32(136, tagOffset);
  view.setUint32(140, tag.length);
  out.set(tag, tagOffset);
  return out;
}

/** @param {string} s */
function ascii(s) {
  return Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
}

/** @param {string} text */
function desc(text) {
  const out = new Uint8Array(12 + text.length + 1);
  out.set(ascii('desc'));
  new DataView(out.buffer).setUint32(8, text.length + 1);
  out.set(ascii(text), 12);
  return out;
}

/** @param {string} text */
function mluc(text) {
  const out = new Uint8Array(28 + text.length * 2);
  const view = new DataView(out.buffer);
  out.set(ascii('mluc'));
  view.setUint32(8, 1);
  view.setUint32(12, 12);
  out.set(ascii('enUS'), 16);
  view.setUint32(20, text.length * 2);
  view.setUint32(24, 28);
  for (let i = 0; i < text.length; i++) view.setUint16(28 + i * 2, text.charCodeAt(i));
  return out;
}

/**
 * Splits a profile into JPEG APP2 ICC_PROFILE segments of at most `chunk` bytes each.
 * @param {Uint8Array} profile
 * @param {number} chunk
 */
export function iccSegments(profile, chunk) {
  const parts = [];
  const total = Math.ceil(profile.length / chunk);
  for (let i = 0; i < total; i++) {
    const body = profile.subarray(i * chunk, (i + 1) * chunk);
    const length = 2 + 12 + 2 + body.length;
    const seg = new Uint8Array(length + 2);
    seg.set([0xff, 0xe2, length >> 8, length & 0xff]);
    seg.set(ascii('ICC_PROFILE\0'), 4);
    seg.set([i + 1, total], 16);
    seg.set(body, 18);
    parts.push(seg);
  }
  return parts;
}
