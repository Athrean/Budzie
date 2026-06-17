// @ts-check

/**
 * Median of a numeric list. Even-length lists average the two middle values.
 * Returns NaN for an empty list — callers decide how to render a missing cell.
 * @param {readonly number[]} values
 * @returns {number}
 */
export function median(values) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Fraction of runs that passed the correctness gate, in [0, 1].
 * Returns NaN for an empty list.
 * @param {readonly boolean[]} values
 * @returns {number}
 */
export function passRate(values) {
  if (values.length === 0) return NaN;
  const passed = values.filter(Boolean).length;
  return passed / values.length;
}
