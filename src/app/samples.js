/**
 * Built-in samples are static files served next to the app. This module holds the only
 * fetch() calls in the application, and both target same-origin paths under the app's base
 * URL; test/security/no-network.test.js enforces that, and the production CSP allows
 * nothing else (connect-src 'self').
 * @typedef {import('./store.js').Sample} Sample
 */

const BASE = `${import.meta.env.BASE_URL}samples/`;

/** @returns {Promise<Sample[]>} */
export async function loadManifest() {
  const response = await fetch(`${BASE}manifest.json`);
  if (!response.ok) throw new Error(`samples manifest: HTTP ${response.status}`);
  return response.json();
}

/**
 * @param {Sample} sample
 * @returns {Promise<ArrayBuffer>}
 */
export async function loadSample(sample) {
  const response = await fetch(sampleUrl(sample));
  if (!response.ok) throw new Error(`${sample.file}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

/** @param {Sample} sample */
export function sampleUrl(sample) {
  return `${BASE}${encodeURIComponent(sample.file)}`;
}
