/**
 * Connected regions on a grid (blocks or pixels), shared by the analyses that turn a map
 * into "look here" rectangles.
 * @typedef {{ bx: number, by: number, bw: number, bh: number, count: number }} GridComponent
 * @typedef {{ x: number, y: number, w: number, h: number, score: number }} Region
 *   Region in image pixels; `score` is analysis-specific (higher = stronger).
 */

/**
 * 4-connected components of the non-zero cells, in scan order of their first cell.
 * Iterative (explicit stack), so large grids cannot overflow the call stack.
 * @param {Uint8Array} cells
 * @param {number} width
 * @param {number} height
 * @returns {GridComponent[]}
 */
export function blockComponents(cells, width, height) {
  const seen = new Uint8Array(cells.length);
  const stack = new Int32Array(cells.length);
  /** @type {GridComponent[]} */
  const out = [];
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    while (top > 0) {
      const i = stack[--top];
      const x = i % width;
      const y = (i - x) / width;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && cells[i - 1] && !seen[i - 1]) {
        seen[i - 1] = 1;
        stack[top++] = i - 1;
      }
      if (x + 1 < width && cells[i + 1] && !seen[i + 1]) {
        seen[i + 1] = 1;
        stack[top++] = i + 1;
      }
      if (y > 0 && cells[i - width] && !seen[i - width]) {
        seen[i - width] = 1;
        stack[top++] = i - width;
      }
      if (y + 1 < height && cells[i + width] && !seen[i + width]) {
        seen[i + width] = 1;
        stack[top++] = i + width;
      }
    }
    out.push({ bx: minX, by: minY, bw: maxX - minX + 1, bh: maxY - minY + 1, count });
  }
  return out;
}

/**
 * Median of a numeric array (copy-sorted).
 * @param {ArrayLike<number>} values
 */
export function median(values) {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Value at quantile q (0..1) of a numeric array (copy-sorted).
 * @param {ArrayLike<number>} values
 * @param {number} q
 */
export function quantile(values, q) {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

/**
 * k-th smallest of the first `n` values (Hoare quickselect, average O(n)). Reorders them.
 * @param {Float32Array} values
 * @param {number} n
 * @param {number} k 0-based rank, k < n.
 */
export function selectKth(values, n, k) {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = values[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const t = values[i];
        values[i] = values[j];
        values[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return values[k];
  }
  return values[k];
}
