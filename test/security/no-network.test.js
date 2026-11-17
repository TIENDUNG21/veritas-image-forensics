import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP } from '../../vite.config.js';

/**
 * The privacy claim ("images never leave the device") is enforced twice: by the production
 * CSP, and by this scan, which fails the build when application code gains a way to talk to
 * the network. The only allowed requests are the sample loader's same-origin fetches.
 */

const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** @param {string} dir @returns {string[]} */
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.js') ? [path] : [];
  });
}

/**
 * Code without comments (JSDoc `import('...')` types are not dynamic imports). The line
 * comment pattern skips `//` preceded by a colon so URL strings survive.
 * @param {string} text
 */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const sources = files(SRC).map((path) => ({
  path: relative(SRC, path).split(sep).join('/'),
  code: code(readFileSync(path, 'utf8')),
}));

const BANNED = [
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /\bsendBeacon\b/,
  /\bRTCPeerConnection\b/,
  /\bimportScripts\b/,
  /\bimport\s*\(/,
];

describe('no network access', () => {
  it('scans a non-trivial source tree', () => {
    expect(sources.length).toBeGreaterThan(30);
  });

  it('uses no network API anywhere in src/', () => {
    const hits = sources.flatMap(({ path, code }) =>
      BANNED.filter((re) => re.test(code)).map((re) => `${path}: ${re}`),
    );
    expect(hits).toEqual([]);
  });

  it('calls fetch only in the sample loader, and only for same-origin sample paths', () => {
    const callers = sources.filter((s) => /\bfetch\s*\(/.test(s.code)).map((s) => s.path);
    expect(callers).toEqual(['app/samples.js']);
    const loader = sources.find((s) => s.path === 'app/samples.js')?.code ?? '';
    const args = [...loader.matchAll(/\bfetch\s*\(([^)]*)\)/g)].map((m) => m[1]?.trim());
    expect(args.length).toBe(2);
    for (const arg of args) expect(arg).toMatch(/^(`\$\{BASE\}|sampleUrl\()/);
    expect(loader).toMatch(/const BASE = `\$\{import\.meta\.env\.BASE_URL\}samples\/`/);
  });

  it('contains no URLs other than XMP namespace identifiers', () => {
    const urls = sources.flatMap(({ path, code }) =>
      [...code.matchAll(/\bhttps?:\/\/[^\s'"`]+/g)].map((m) => `${path}: ${m[0]}`),
    );
    expect(urls.filter((u) => !u.includes('http://ns.adobe.com/'))).toEqual([]);
  });

  it('ships a CSP that only allows the app origin', () => {
    expect(CSP).toContain("default-src 'self'");
    expect(CSP).toContain("connect-src 'self'");
    expect(CSP).not.toMatch(/https?:|\*|'unsafe-inline'|'unsafe-eval'/);
  });
});
