/**
 * Does stale-build recovery actually recover — and, more importantly, does it know when to
 * STOP?
 *
 * The bug this guards was found in production: GitHub Pages caches `index.html` for ten
 * minutes while a deploy replaces every content-hashed chunk, so a cached copy requests an
 * entry chunk that 404s and the page renders as an empty `#root` over the CSS background.
 * Nothing is logged and no test caught it, because every static guard in this repo was green
 * the entire time — the artefact was correct, the CACHE was stale.
 *
 * The dangerous half of the fix is the reload itself. "Reload when a chunk fails" is one typo
 * away from an infinite refresh loop on a genuinely broken deploy — a worse failure than the
 * blank page, because it burns the user's battery and cannot be read. So the loop guard is the
 * unit under test, and the branch asserted hardest is the one that declines to reload.
 *
 * The inline snippet in `index.html` is tested as TEXT rather than executed: it exists
 * precisely for the case where no module JavaScript runs, so it cannot import the constants it
 * duplicates. Asserting the two copies agree is the only thing standing between "the guard is
 * wired" and "the guard silently reads a key nothing writes".
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STALE_BUILD_COOLDOWN_MS,
  STALE_BUILD_RELOAD_KEY,
  installStaleBuildRecovery,
  shouldReloadForStaleBuild,
  type StaleBuildEvent,
  type StaleBuildHost,
} from '@/system/staleBuild/staleBuild';

const NOW = 1_700_000_000_000;

describe('shouldReloadForStaleBuild', () => {
  it('reloads when nothing has been recorded', () => {
    expect(shouldReloadForStaleBuild(NOW, null)).toBe(true);
    expect(shouldReloadForStaleBuild(NOW, '')).toBe(true);
  });

  it('refuses a second reload inside the cooldown — the loop guard', () => {
    expect(shouldReloadForStaleBuild(NOW, String(NOW - 1))).toBe(false);
    expect(shouldReloadForStaleBuild(NOW, String(NOW - (STALE_BUILD_COOLDOWN_MS - 1)))).toBe(
      false
    );
  });

  it('allows another reload at and past the cooldown boundary', () => {
    expect(shouldReloadForStaleBuild(NOW, String(NOW - STALE_BUILD_COOLDOWN_MS))).toBe(true);
    expect(shouldReloadForStaleBuild(NOW, String(NOW - STALE_BUILD_COOLDOWN_MS - 1))).toBe(true);
  });

  it('treats garbage in the key as no record, so it can never BLOCK recovery', () => {
    for (const junk of ['abc', 'NaN', '0', '-5', 'Infinity', '{}']) {
      expect(shouldReloadForStaleBuild(NOW, junk)).toBe(true);
    }
  });

  it('treats a future timestamp as stale rather than suppressing every future reload', () => {
    // A clock rewind between loads. Naive `now - last >= cooldown` goes negative here and
    // silently disables recovery for as long as the skew lasts.
    expect(shouldReloadForStaleBuild(NOW, String(NOW + 60_000))).toBe(true);
  });
});

/** A fake browser: records what the handler did, without needing a DOM. */
function fakeHost(overrides: Partial<StaleBuildHost> = {}) {
  const store = new Map<string, string>();
  let listener: ((event: StaleBuildEvent) => void) | null = null;
  const reload = vi.fn();

  const host: StaleBuildHost = {
    addEventListener: (type, fn) => {
      if (type === 'vite:preloadError') listener = fn;
    },
    sessionStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    },
    location: { reload },
    now: () => NOW,
    ...overrides,
  };

  installStaleBuildRecovery(host);

  const fire = () => {
    const preventDefault = vi.fn();
    if (listener === null) throw new Error('handler was never registered');
    listener({ preventDefault });
    return { preventDefault };
  };

  return { fire, reload, store };
}

describe('installStaleBuildRecovery', () => {
  it('reloads on the first preload error and records the attempt', () => {
    const { fire, reload, store } = fakeHost();
    const { preventDefault } = fire();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(store.get(STALE_BUILD_RELOAD_KEY)).toBe(String(NOW));
  });

  it('does not reload twice inside the cooldown, and lets the error surface', () => {
    const { fire, reload } = fakeHost();
    fire();
    const second = fire();

    expect(reload).toHaveBeenCalledTimes(1);
    // Crucial: the second error is NOT swallowed. A broken deploy has to stay visible.
    expect(second.preventDefault).not.toHaveBeenCalled();
  });

  it('still reloads once when sessionStorage throws (blocked/partitioned storage)', () => {
    const { fire, reload } = fakeHost({
      sessionStorage: {
        getItem: () => {
          throw new Error('storage blocked');
        },
        setItem: () => {
          throw new Error('storage blocked');
        },
      },
    });

    expect(() => fire()).not.toThrow();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('the index.html boot guard', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

  it('is present and runs before the module entry, or it cannot catch the entry 404', () => {
    const guardAt = html.indexOf('boardwalk:stale-build-reload');
    const entryAt = html.indexOf('src="/src/main.tsx"');

    expect(guardAt).toBeGreaterThan(-1);
    expect(entryAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(entryAt);
  });

  it('listens in the capture phase, because resource load errors do not bubble', () => {
    expect(html).toMatch(/addEventListener\(\s*'error'[\s\S]*?true\s*\)/);
  });

  it('duplicates the SAME key and cooldown as the module', () => {
    expect(html).toContain(`var KEY = '${STALE_BUILD_RELOAD_KEY}';`);
    expect(html).toContain(`var COOLDOWN_MS = ${String(STALE_BUILD_COOLDOWN_MS)};`);
  });
});
