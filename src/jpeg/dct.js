/**
 * The 8x8 type-II DCT used by JPEG (ITU-T T.81 A.3.3), computed separably with a
 * precomputed basis: F = B f B^T and f = B^T F B, where B[u][x] = c(u)/2 cos((2x+1)u pi/16).
 * Floating point keeps it exact enough for forensic comparisons; speed comes from the
 * separable form (2 x 8 x 64 multiplies per block instead of 64 x 64).
 */

const BASIS = new Float64Array(64);
for (let u = 0; u < 8; u++) {
  const c = u === 0 ? Math.SQRT1_2 : 1;
  for (let x = 0; x < 8; x++) {
    BASIS[u * 8 + x] = (c / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
}

const tmp = new Float64Array(64);

/**
 * Forward DCT of one block of level-shifted samples (row-major), result in natural order.
 * @param {ArrayLike<number>} input 64 samples, usually pixel value minus 128.
 * @param {Float32Array | Float64Array} out 64 coefficients.
 */
export function fdct8x8(input, out) {
  // Rows: tmp[y][u] = sum_x f[y][x] B[u][x]
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) sum += input[y * 8 + x] * BASIS[u * 8 + x];
      tmp[y * 8 + u] = sum;
    }
  }
  // Columns: out[v][u] = sum_y B[v][y] tmp[y][u]
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) sum += BASIS[v * 8 + y] * tmp[y * 8 + u];
      out[v * 8 + u] = sum;
    }
  }
}

/**
 * Inverse DCT of one block of coefficients in natural order (already dequantized).
 * @param {ArrayLike<number>} coeffs
 * @param {Float32Array | Float64Array} out 64 samples (still level-shifted, not clamped).
 */
export function idct8x8(coeffs, out) {
  // Rows: tmp[v][x] = sum_u F[v][u] B[u][x]
  for (let v = 0; v < 8; v++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) sum += coeffs[v * 8 + u] * BASIS[u * 8 + x];
      tmp[v * 8 + x] = sum;
    }
  }
  // Columns: out[y][x] = sum_v B[v][y] tmp[v][x]
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) sum += BASIS[v * 8 + y] * tmp[v * 8 + x];
      out[y * 8 + x] = sum;
    }
  }
}
