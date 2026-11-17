/**
 * A single observation shown in the summary. Severity is deliberately modest: forensic
 * signals point at where to look; none of them proves manipulation on its own.
 *
 * - `info`: a neutral fact (camera model, GPS present).
 * - `notice`: worth a look (saved by an editor, dates differ).
 * - `warning`: a strong local or structural inconsistency (cloned region, thumbnail differs).
 *
 * @typedef {'info' | 'notice' | 'warning'} Severity
 * @typedef {{ id: string, severity: Severity, title: string, detail: string, layer?: string }} Finding
 *   `layer` names the viewer layer that shows the evidence, if any.
 */

/** @type {Record<Severity, number>} */
const RANK = { warning: 0, notice: 1, info: 2 };

/**
 * Most severe first, stable otherwise.
 * @param {Finding[]} findings
 */
export function sortFindings(findings) {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity] || a.i - b.i)
    .map((x) => x.f);
}

/**
 * Human-readable duration ("3 days", "45 minutes").
 * @param {number} seconds
 */
export function humanDuration(seconds) {
  const s = Math.abs(seconds);
  /** @type {[number, string][]} */
  const units = [
    [86400 * 365, 'year'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, name] of units) {
    if (s >= size) {
      const n = Math.round(s / size);
      return `${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  return `${Math.round(s)} seconds`;
}
