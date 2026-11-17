# 0004. Enforce "no network" with a CSP and a static check

Status: accepted

## Context

People check images they do not want to share: evidence, documents, private photos. The app
says the image never leaves the device. A sentence in the README is not a guarantee: a later
change, a dependency or a debugging `fetch` could break it silently, and a user cannot audit
a minified bundle.

## Decision

Two independent mechanisms, both checked in CI:

1. The production build injects a Content-Security-Policy meta tag as the first element of
   `<head>`: `default-src 'self'`, `connect-src 'self'`, `script-src 'self'`,
   `style-src 'self'`, `img-src 'self' blob: data:`, `worker-src 'self'`,
   `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. The browser refuses any
   request to another origin, whatever code issues it. `tools/check-dist.mjs` fails the
   build if the tag is missing, comes after a script, or allows anything beyond the origin.
2. `test/security/no-network.test.js` scans `src/` with comments stripped. It fails on
   `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `RTCPeerConnection`,
   `importScripts` and dynamic `import()`; on any URL literal other than the XMP namespace
   identifiers; and on `fetch` anywhere except `src/app/samples.js`, whose two calls must
   take a path under the app's own base URL.

The exported HTML report carries its own stricter policy (`default-src 'none'`, inline
images only, no scripts), so opening a saved report makes no requests either.

## Consequences

- Same-origin requests remain possible (the samples need them), so the guarantee is "nothing
  leaves for another server", which is what matters for privacy. GitHub Pages logs that the
  page and the sample files were requested, as any static host does; analysed files are never
  part of a request.
- A meta-tag CSP cannot set `frame-ancestors` or reporting; GitHub Pages does not allow custom
  response headers, so those are out of reach for this deployment.
- The UI cannot use an external map tile service to show GPS positions. Coordinates are shown
  as numbers, and the panel says why.
- Inline `style` attributes are blocked by `style-src 'self'`; the code sets the few dynamic
  sizes through the CSSOM (`element.style.width = ...`), which CSP permits.
