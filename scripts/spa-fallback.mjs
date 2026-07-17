// The GitHub Pages SPA fallback: dist/404.html is a byte-for-byte copy of index.html.
//
// WHY THIS EXISTS. The app uses BrowserRouter, so `/Boardwalk/play/blackjack` is a real
// route the client resolves — but typed directly or refreshed, that URL asks Pages for a
// file that does not exist, and Pages has no server-side rewrite to send it to index.html.
// What Pages DOES have is a convention: it serves the site's `404.html` for any unmatched
// path. So if 404.html is a copy of index.html, an unknown path boots the same SPA, and
// react-router takes it from there. This is the standard Pages-SPA trick, and it is the
// price of clean URLs on a static host (the alternative was a hash in every link, which
// every shared room link in Phase 5 would carry forever).
//
// WHY A PURE FUNCTION WITH TWO CALLERS, like config.ts. This is invoked from vite.config.ts
// at build time AND from tests/spa-fallback.test.ts against a fixture, and neither can see
// the other. A copy of the logic in the test is the v1 defect in miniature — a fact with
// two homes that drift. So the copy-and-verify lives here, once.
//
// WHY IT SELF-CHECKS. `copyFileSync` makes the two files byte-identical by construction, so
// the only real failure is "the copy did not run" or "index.html was not where we looked".
// This project's signature dread is a guard that reports success by doing nothing, and a
// missing 404.html fails exactly that way: the build stays green and only deep links break,
// silently, in production, discovered by a user. So this reads both files back and throws
// if they differ or are missing — the build goes red here rather than the deploy going
// quietly half-broken.

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copy `<distDir>/index.html` to `<distDir>/404.html`, then verify the two are byte-for-byte
 * identical. Throws if index.html is absent or the copy did not take.
 *
 * @param {string} distDir - the build output directory (Vite's resolved `build.outDir`).
 * @returns {string} the path written, for logging.
 */
export function writeSpaFallback(distDir) {
  const indexPath = join(distDir, 'index.html');
  const fallbackPath = join(distDir, '404.html');

  if (!existsSync(indexPath)) {
    throw new Error(
      `spa-fallback: ${indexPath} does not exist. The SPA 404 fallback cannot be built ` +
        `without index.html — did the Vite HTML build run before this?`
    );
  }

  copyFileSync(indexPath, fallbackPath);

  // The self-check. `copyFileSync` should make these identical; reading them back is what
  // turns "should" into "the build fails if not".
  const index = readFileSync(indexPath);
  const fallback = readFileSync(fallbackPath);
  if (!index.equals(fallback)) {
    throw new Error(
      `spa-fallback: ${fallbackPath} is not byte-identical to index.html after copy. ` +
        `A drifting fallback serves a stale app on deep links — refusing to ship it.`
    );
  }

  return fallbackPath;
}
