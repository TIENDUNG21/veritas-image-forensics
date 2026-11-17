/** JPEG marker codes (second byte after 0xFF) and their human-readable names. */

export const SOI = 0xd8;
export const EOI = 0xd9;
export const SOS = 0xda;
export const DQT = 0xdb;
export const DNL = 0xdc;
export const DRI = 0xdd;
export const DHT = 0xc4;
export const DAC = 0xcc;
export const COM = 0xfe;
export const TEM = 0x01;

/** Start-of-frame markers and the coding process each one announces. */
export const FRAME_TYPES = new Map([
  [0xc0, 'Baseline DCT'],
  [0xc1, 'Extended sequential DCT, Huffman'],
  [0xc2, 'Progressive DCT, Huffman'],
  [0xc3, 'Lossless, Huffman'],
  [0xc5, 'Differential sequential DCT, Huffman'],
  [0xc6, 'Differential progressive DCT, Huffman'],
  [0xc7, 'Differential lossless, Huffman'],
  [0xc9, 'Extended sequential DCT, arithmetic'],
  [0xca, 'Progressive DCT, arithmetic'],
  [0xcb, 'Lossless, arithmetic'],
  [0xcd, 'Differential sequential DCT, arithmetic'],
  [0xce, 'Differential progressive DCT, arithmetic'],
  [0xcf, 'Differential lossless, arithmetic'],
]);

/** @param {number} marker */
export function isRst(marker) {
  return marker >= 0xd0 && marker <= 0xd7;
}

/** @param {number} marker */
export function isApp(marker) {
  return marker >= 0xe0 && marker <= 0xef;
}

/**
 * Markers that stand alone, without a length field.
 * @param {number} marker
 */
export function isStandalone(marker) {
  return marker === SOI || marker === EOI || marker === TEM || isRst(marker);
}

/** @param {number} marker */
export function markerName(marker) {
  if (FRAME_TYPES.has(marker)) return `SOF${marker - 0xc0}`;
  if (isApp(marker)) return `APP${marker - 0xe0}`;
  if (isRst(marker)) return `RST${marker - 0xd0}`;
  switch (marker) {
    case SOI:
      return 'SOI';
    case EOI:
      return 'EOI';
    case SOS:
      return 'SOS';
    case DQT:
      return 'DQT';
    case DNL:
      return 'DNL';
    case DRI:
      return 'DRI';
    case DHT:
      return 'DHT';
    case DAC:
      return 'DAC';
    case COM:
      return 'COM';
    case TEM:
      return 'TEM';
    default:
      return `0xFF${marker.toString(16).toUpperCase().padStart(2, '0')}`;
  }
}
