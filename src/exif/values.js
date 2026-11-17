/**
 * Conversion of raw TIFF values into numbers, dates and human-readable text.
 * @typedef {import('./tiff.js').TiffValue} TiffValue
 * @typedef {import('./tiff.js').Rational} Rational
 */

const ORIENTATION = [
  '',
  'Normal',
  'Mirror horizontal',
  'Rotate 180',
  'Mirror vertical',
  'Mirror horizontal and rotate 270 CW',
  'Rotate 90 CW',
  'Mirror horizontal and rotate 90 CW',
  'Rotate 270 CW',
];

/** @type {Record<string, Record<number, string>>} */
const ENUMS = {
  ResolutionUnit: { 1: 'None', 2: 'inches', 3: 'centimeters' },
  ColorSpace: { 1: 'sRGB', 2: 'Adobe RGB', 0xffff: 'Uncalibrated' },
  ExposureProgram: {
    0: 'Not defined',
    1: 'Manual',
    2: 'Normal program',
    3: 'Aperture priority',
    4: 'Shutter priority',
    5: 'Creative',
    6: 'Action',
    7: 'Portrait',
    8: 'Landscape',
  },
  MeteringMode: {
    0: 'Unknown',
    1: 'Average',
    2: 'Center-weighted average',
    3: 'Spot',
    4: 'Multi-spot',
    5: 'Pattern',
    6: 'Partial',
    255: 'Other',
  },
  WhiteBalance: { 0: 'Auto', 1: 'Manual' },
  ExposureMode: { 0: 'Auto', 1: 'Manual', 2: 'Auto bracket' },
  SceneCaptureType: { 0: 'Standard', 1: 'Landscape', 2: 'Portrait', 3: 'Night scene' },
  CustomRendered: { 0: 'Normal process', 1: 'Custom process' },
  YCbCrPositioning: { 1: 'Centered', 2: 'Co-sited' },
  Compression: { 1: 'Uncompressed', 6: 'JPEG (old-style)', 7: 'JPEG' },
  SensingMethod: {
    1: 'Not defined',
    2: 'One-chip colour area',
    7: 'Trilinear',
    8: 'Colour sequential linear',
  },
  GPSAltitudeRef: { 0: 'Above sea level', 1: 'Below sea level' },
  CompositeImage: {
    0: 'Unknown',
    1: 'Not composite',
    2: 'Composite',
    3: 'Composite captured while shooting',
  },
};

/**
 * @param {Rational} r
 * @returns {number}
 */
export function rationalValue(r) {
  return r.den === 0 ? NaN : r.num / r.den;
}

/**
 * @param {TiffValue | undefined} v
 * @returns {number | null}
 */
export function numberOf(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'num' in v) {
    const n = rationalValue(v);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(v) && v.length > 0) return numberOf(v[0]);
  if (v instanceof Uint8Array && v.length > 0) return v[0];
  return null;
}

/**
 * @param {TiffValue | undefined} v
 * @returns {Rational[]}
 */
function rationals(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'object');
  if (v && typeof v === 'object' && 'num' in v) return [v];
  return [];
}

/**
 * Degrees/minutes/seconds rationals plus a hemisphere reference to signed decimal degrees.
 * @param {string} ref N, S, E or W
 * @param {TiffValue | undefined} value
 * @returns {number | null}
 */
export function gpsToDecimal(ref, value) {
  const parts = rationals(value).map(rationalValue);
  if (parts.length === 0 || parts.some((p) => !Number.isFinite(p))) return null;
  const decimal = (parts[0] ?? 0) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
  return /^[SW]/i.test(ref.trim()) ? -decimal : decimal;
}

/**
 * Converts `YYYY:MM:DD HH:MM:SS` (plus an optional `+HH:MM` offset) to ISO 8601.
 * Returns null for blank or impossible dates.
 * @param {string} text
 * @param {string} [offset]
 */
export function parseExifDate(text, offset) {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  if (!y || !mo || mo > 12 || !d || d > 31 || (h ?? 99) > 23 || (mi ?? 99) > 59 || (s ?? 99) > 60) {
    return null;
  }
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return offset && /^[+-]\d{2}:\d{2}$/.test(offset.trim()) ? iso + offset.trim() : iso;
}

/** @param {number} n */
function trim(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

/** @param {Uint8Array} bytes */
function printable(bytes) {
  return bytes.every((b) => b === 0 || (b >= 0x20 && b < 0x7f));
}

/** @param {Uint8Array} bytes */
function asciiOf(bytes) {
  return String.fromCharCode(...bytes.subarray(0, 512)).replace(/\0+$/, '');
}

/**
 * Display text for one field. Known tags get units and names; everything else is shown
 * generically (rationals as decimals, binary data as a short hex preview).
 * @param {string} name
 * @param {TiffValue} value
 */
export function formatValue(name, value) {
  const n = numberOf(value);
  switch (name) {
    case 'Orientation':
      return ORIENTATION[n ?? 0] || `Unknown (${n})`;
    case 'ExposureTime':
      if (n === null || n <= 0) break;
      return n < 1 ? `1/${Math.round(1 / n)} s` : `${trim(n)} s`;
    case 'FNumber':
      return n === null ? '' : `f/${trim(n)}`;
    case 'FocalLength':
      return n === null ? '' : `${trim(n)} mm`;
    case 'FocalLengthIn35mmFilm':
      return n === null ? '' : `${n} mm`;
    case 'GPSAltitude':
      return n === null ? '' : `${trim(n)} m`;
    case 'Flash':
      if (n === null) break;
      return `${n & 1 ? 'Fired' : 'Did not fire'}${(n & 0x18) === 0x18 ? ', auto mode' : ''}${n & 0x40 ? ', red-eye reduction' : ''}`;
    case 'ExifVersion':
    case 'FlashpixVersion':
    case 'InteroperabilityVersion':
      if (value instanceof Uint8Array && value.length === 4) {
        const text = asciiOf(value);
        return `${Number(text.slice(0, 2))}.${text.slice(2)}`;
      }
      break;
    case 'UserComment':
      if (value instanceof Uint8Array) return userComment(value);
      break;
    case 'XPTitle':
    case 'XPComment':
    case 'XPAuthor':
    case 'XPKeywords':
    case 'XPSubject':
      if (value instanceof Uint8Array) return utf16le(value);
      break;
    case 'GPSLatitude':
    case 'GPSLongitude':
    case 'GPSDestLatitude':
    case 'GPSDestLongitude': {
      const [d, m, s] = rationals(value).map(rationalValue);
      if (d === undefined) break;
      return `${trim(d)}° ${trim(m ?? 0)}′ ${trim(s ?? 0)}″`;
    }
    case 'GPSTimeStamp': {
      const parts = rationals(value).map(rationalValue);
      if (parts.length !== 3) break;
      return parts.map((p) => String(Math.floor(p)).padStart(2, '0')).join(':');
    }
    case 'GPSVersionID':
      if (value instanceof Uint8Array) return [...value].join('.');
      break;
    case 'MakerNote':
      if (value instanceof Uint8Array) return `${value.length} bytes (vendor-specific)`;
      break;
    default: {
      const table = ENUMS[name];
      if (table && n !== null && table[n]) return table[n];
    }
  }
  return generic(value);
}

/** @param {TiffValue} value */
function generic(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return trim(value);
  if (value instanceof Uint8Array) {
    if (value.length > 0 && printable(value)) return asciiOf(value);
    const hex = [...value.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    return value.length > 16 ? `${hex} ... (${value.length} bytes)` : hex;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 16).map((v) => (typeof v === 'number' ? trim(v) : ratio(v)));
    return items.join(', ') + (value.length > 16 ? `, ... (${value.length} values)` : '');
  }
  return ratio(value);
}

/** @param {Rational} r */
function ratio(r) {
  const v = rationalValue(r);
  if (!Number.isFinite(v)) return `${r.num}/${r.den}`;
  return trim(v);
}

/**
 * UserComment starts with an 8-byte character code (ASCII, UNICODE, JIS or undefined).
 * @param {Uint8Array} bytes
 */
function userComment(bytes) {
  const code = asciiOf(bytes.subarray(0, 8)).trim();
  const body = bytes.subarray(8);
  if (code === 'UNICODE') {
    const le = body[0] !== 0; // heuristic: big-endian text starts with a zero high byte
    return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(body).replace(/\0+$/, '').trim();
  }
  return new TextDecoder('utf-8').decode(body).replace(/\0+$/, '').trim();
}

/** @param {Uint8Array} bytes */
function utf16le(bytes) {
  return new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '');
}
