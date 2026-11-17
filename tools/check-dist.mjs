// Verifies the production build works when served from the GitHub Pages sub-path.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = '/veritas-image-forensics/';
const dist = join(process.cwd(), 'dist');
const indexPath = join(dist, 'index.html');

/** @type {string[]} */
const problems = [];
if (!existsSync(indexPath)) {
  problems.push('dist/index.html is missing; run `npm run build` first');
} else {
  const html = readFileSync(indexPath, 'utf8');
  // Resources the page loads: script src and link href (plain <a> links are navigation).
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="([^"]+)"/g)].map(
    (m) => m[1] ?? '',
  );
  // Vite writes quotes in attribute values as entities; the browser decodes them.
  const csp = html
    .match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1]
    ?.replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
  if (!csp) problems.push('the Content-Security-Policy meta tag is missing');
  else if (!csp.includes("connect-src 'self'") || /https?:|\*/.test(csp)) {
    problems.push(`the CSP allows more than the app's own origin: ${csp}`);
  }
  if (html.indexOf('Content-Security-Policy') > html.indexOf('<script')) {
    problems.push('the CSP meta tag must come before the first script');
  }
  for (const ref of refs) {
    const external = /^[a-z]+:/i.test(ref) && !ref.startsWith('data:');
    if (external) problems.push(`external reference: ${ref}`);
    else if (ref.startsWith('/') && !ref.startsWith(BASE))
      problems.push(`not under ${BASE}: ${ref}`);
    else if (ref.startsWith(BASE) && !existsSync(join(dist, ref.slice(BASE.length)))) {
      problems.push(`missing file for ${ref}`);
    }
  }
  if (refs.length === 0) problems.push('index.html references no assets');
}

if (problems.length > 0) {
  console.error(`check-dist failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('check-dist: CSP present; dist/index.html references only assets under', BASE);
