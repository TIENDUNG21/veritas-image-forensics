import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { median, quantile, selectKth } from '../../src/core/regions.js';

describe('order statistics', () => {
  it('selectKth agrees with sorting for any input and rank', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }), {
          minLength: 1,
          maxLength: 300,
        }),
        fc.nat(),
        (values, rank) => {
          const k = rank % values.length;
          const sorted = Float32Array.from(values).sort();
          return selectKth(Float32Array.from(values), values.length, k) === sorted[k];
        },
      ),
      { numRuns: 300 },
    );
  });

  it('only looks at the first n values', () => {
    expect(selectKth(Float32Array.from([5, 1, 3, -100, -100]), 3, 1)).toBe(3);
  });

  it('computes medians and quantiles', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(quantile([1, 2, 3, 4, 5], 1)).toBe(5);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
});
