// Screenshots of the production build in headless Edge, driven over the DevTools protocol so
// the capture waits for the worker to finish (a fixed --virtual-time-budget does not: virtual
// time runs ahead while the main thread idles).
//
//   node tools/screenshot.mjs                                   -> docs/images/hero.png
//   node tools/screenshot.mjs --query "sample=splice&layer=dct" --out shot.png [--tab jpeg]
//   node tools/screenshot.mjs --click export-html --downloads <dir>   (saves the export)
//
// Serves dist/ with `vite preview` on port 5191 and Edge's DevTools endpoint on 5192, and
// prints any exception or console error the page raised.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    query: { type: 'string', default: 'sample=clone&layer=copymove' },
    out: { type: 'string', default: 'docs/images/hero.png' },
    tab: { type: 'string' },
    click: { type: 'string' },
    downloads: { type: 'string' },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '900' },
    build: { type: 'boolean', default: true },
    'no-build': { type: 'boolean', default: false },
  },
});
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGE = `http://localhost:5191/veritas-image-forensics/?${opt.query}`;
const width = Number(opt.width);
const height = Number(opt.height);
const out = resolve(opt.out ?? 'docs/images/hero.png');
const READY = `(() => {
  const shown = (id) => { const el = document.getElementById(id); return el && !el.hidden; };
  return shown('viewer') || shown('failure') || (shown('empty') && !location.search.includes('sample='));
})()`;

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function waitFor(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`${url} did not respond within ${timeoutMs} ms`);
}

if (opt.build && !opt['no-build']) {
  const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    stdio: 'ignore',
  });
  if (build.status !== 0) throw new Error('vite build failed');
}

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', '5191', '--strictPort'],
  { stdio: 'ignore' },
);
const profile = mkdtempSync(join(tmpdir(), 'veritas-edge-'));
/** @type {import('node:child_process').ChildProcess | null} */
let edge = null;
const problems = /** @type {string[]} */ ([]);

try {
  await waitFor(PAGE, 15_000);
  edge = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--remote-debugging-port=5192',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const list = await waitFor('http://127.0.0.1:5192/json/list', 15_000);
  const targets = /** @type {{ type: string, webSocketDebuggerUrl: string }[]} */ (
    await list.json()
  );
  const target = targets.find((t) => t.type === 'page');
  if (!target) throw new Error('Edge exposed no page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    ws.onopen = resolveOpen;
    ws.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      problems.push(
        `exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`,
      );
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      problems.push(
        `console.error: ${msg.params.args.map((/** @type {{ value?: unknown, description?: string }} */ a) => a.value ?? a.description).join(' ')}`,
      );
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
    }
  };
  /**
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  const send = (method, params = {}) =>
    new Promise((resolveSend, reject) => {
      const id = nextId++;
      pending.set(id, (/** @type {any} */ msg) =>
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolveSend(msg.result),
      );
      ws.send(JSON.stringify({ id, method, params }));
    });
  /** @param {string} expression */
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result
      .value;

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  if (opt.downloads) {
    mkdirSync(resolve(opt.downloads), { recursive: true });
    await send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: resolve(opt.downloads),
    });
  }
  await send('Page.navigate', { url: PAGE });
  const end = Date.now() + 60_000;
  while (!(await evaluate(READY).catch(() => false))) {
    if (Date.now() > end) throw new Error('the page did not finish analysing within 60 s');
    await sleep(200);
  }
  if (opt.tab) await evaluate(`document.querySelector('[data-tab="${opt.tab}"]').click()`);
  if (opt.click) await evaluate(`document.getElementById(${JSON.stringify(opt.click)}).click()`);
  await sleep(opt.click ? 1500 : 400);
  const status = await evaluate(`document.getElementById('status-text').textContent`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`wrote ${out}\nstatus: ${status}`);
  ws.close();
} finally {
  edge?.kill();
  server.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (problems.length > 0) {
  console.error(`page problems:\n- ${problems.join('\n- ')}`);
  process.exitCode = 1;
}
