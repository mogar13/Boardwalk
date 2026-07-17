/**
 * Does the SPA fallback actually produce a byte-identical 404.html — and fail loudly when
 * it can't?
 *
 * This is the guard behind the decision to use BrowserRouter on GitHub Pages. The fallback
 * itself (`copyFileSync`) makes the two files identical by construction, so the interesting
 * failures are the ones that would otherwise be SILENT: index.html not where we looked, or
 * a future refactor that breaks the copy while leaving the build green. A missing 404.html
 * breaks only deep links, only in production, discovered by a user — this repo's signature
 * dread. So the function self-checks, and these tests assert both that it copies faithfully
 * and that it throws rather than returning quietly when it cannot.
 *
 * Run against a temp dir, not a real build: the unit under test is the copy-and-verify, and
 * standing up a full Vite build (which needs Firebase config) to test a file copy would be
 * testing the wrong thing slowly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSpaFallback } from '../scripts/spa-fallback.mjs';

const dirs: string[] = [];

function freshDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'boardwalk-spa-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('writeSpaFallback', () => {
  it('writes a 404.html byte-identical to index.html', () => {
    const dist = freshDist();
    const html = '<!doctype html><html><body><div id="root"></div></body></html>';
    writeFileSync(join(dist, 'index.html'), html);

    writeSpaFallback(dist);

    const index = readFileSync(join(dist, 'index.html'));
    const fallback = readFileSync(join(dist, '404.html'));
    expect(fallback.equals(index)).toBe(true);
  });

  it('preserves bytes exactly, including a hashed asset tag', () => {
    // The real index.html carries a hashed script src; a lossy copy (a re-render, a
    // reformat) would break it. Byte-for-byte is the requirement, not "looks the same".
    const dist = freshDist();
    const html =
      '<!doctype html>\n<html lang="en">\n<head><script type="module" ' +
      'src="/Boardwalk/assets/index-a1b2c3d4.js"></script></head>\n<body>\n' +
      '<div id="root"></div>\n</body>\n</html>\n';
    writeFileSync(join(dist, 'index.html'), html);

    writeSpaFallback(dist);

    expect(readFileSync(join(dist, '404.html'), 'utf8')).toBe(html);
  });

  it('returns the path it wrote', () => {
    const dist = freshDist();
    writeFileSync(join(dist, 'index.html'), '<html></html>');
    expect(writeSpaFallback(dist)).toBe(join(dist, '404.html'));
  });

  it('throws — does not return silently — when index.html is absent', () => {
    // The silent-failure guard. An empty dist (index.html never emitted) must go red here,
    // in the build, not deploy a site with no fallback and a green log.
    const dist = freshDist();
    mkdirSync(join(dist, 'assets'));
    expect(() => writeSpaFallback(dist)).toThrow(/index\.html does not exist/);
  });
});
