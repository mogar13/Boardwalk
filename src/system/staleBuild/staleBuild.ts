/**
 * Stale-build recovery — the fix for a blank page after a deploy.
 *
 * GitHub Pages serves `index.html` with `cache-control: max-age=600` and gives us no way to
 * change that. Vite fingerprints every chunk by content hash, and a Pages deploy REPLACES the
 * site, so the previous build's hashes 404 the moment the new one lands. A browser holding a
 * cached `index.html` therefore asks for chunks that no longer exist — for up to ten minutes
 * after every push, and longer for a tab left open. Nothing renders and nothing is logged: the
 * page is the CSS background and an empty `#root`.
 *
 * There are TWO failure sites and they need different mechanisms, which is the whole reason
 * this module has a sibling snippet inlined in `index.html`:
 *
 *   1. THE ENTRY CHUNK 404s. No application JavaScript runs at all — including this file — so
 *      nothing here can help. That case is caught by the inline `<script>` in `index.html`,
 *      which listens for resource load errors in the capture phase. It only helps on the NEXT
 *      stale deploy, because the snippet has to already be in the cached HTML to fire; the
 *      first hard refresh after this ships is still on the user.
 *   2. A LAZY CHUNK 404s MID-SESSION. The app booted fine, then the player clicked a game
 *      whose `React.lazy` chunk belongs to a build that no longer exists. Vite fires a
 *      cancelable `vite:preloadError` on `window` for exactly this. That is what
 *      `installStaleBuildRecovery` handles, and it is the quieter, worse half — the app is
 *      live and working right up until a route goes white with no error.
 *
 * Reloading is safe because the fix is genuinely "fetch the current `index.html`". What is NOT
 * safe is reloading unconditionally: a chunk that 404s because the deploy is actually broken
 * would spin the tab forever. Hence the cooldown — one reload per window, and if the fresh HTML
 * still cannot load its chunks, the error is allowed to surface instead of being papered over.
 *
 * The key and the cooldown are duplicated in the `index.html` snippet, because an inline script
 * cannot import. `tests/stale-build.test.ts` asserts the two agree, so the duplication is
 * checked rather than trusted.
 */

/** `sessionStorage` key holding the timestamp of the last recovery reload. */
export const STALE_BUILD_RELOAD_KEY = 'boardwalk:stale-build-reload';

/** Minimum gap between two recovery reloads. Below this we assume the deploy is broken. */
export const STALE_BUILD_COOLDOWN_MS = 10_000;

/**
 * Should a chunk-load failure trigger a recovery reload?
 *
 * Pure so the loop guard is testable without a browser — the branch that matters most is the one
 * that says NO, and a reload loop is not something you want to discover in production.
 */
export function shouldReloadForStaleBuild(
  now: number,
  lastRaw: string | null,
  cooldownMs: number = STALE_BUILD_COOLDOWN_MS
): boolean {
  if (lastRaw === null || lastRaw === '') return true;

  const last = Number(lastRaw);

  // Garbage in the key (hand-edited, or written by something else) is not evidence we just
  // reloaded, so it must not be able to BLOCK a recovery. Treat it as no record at all.
  if (!Number.isFinite(last) || last <= 0) return true;

  // A record from the future means the clock moved backwards between the two loads. The gap
  // arithmetic below would go negative and silently suppress every future recovery, so the
  // rewind is treated as a stale record — the same call this repo's daily-streak clock makes.
  if (last > now) return true;

  return now - last >= cooldownMs;
}

/** The slice of `window` this needs. Injected so the handler is testable off a real browser. */
export interface StaleBuildHost {
  addEventListener: (type: string, listener: (event: StaleBuildEvent) => void) => void;
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>;
  location: { reload: () => void };
  now: () => number;
}

/** The cancelable event Vite fires when a dynamic import fails. */
export interface StaleBuildEvent {
  preventDefault: () => void;
}

/**
 * Wire recovery for lazy chunks that belong to a build that is gone. Call once, at boot.
 *
 * Storage access is wrapped because `sessionStorage` THROWS rather than returning null in a
 * partitioned or storage-blocked context. An exception thrown out of this handler would leave
 * the white screen it exists to repair, so the guard degrades to "reload once, no memory"
 * instead of to nothing.
 */
export function installStaleBuildRecovery(host: StaleBuildHost): void {
  host.addEventListener('vite:preloadError', (event) => {
    const now = host.now();

    let last: string | null;
    try {
      last = host.sessionStorage.getItem(STALE_BUILD_RELOAD_KEY);
    } catch {
      last = null;
    }

    if (!shouldReloadForStaleBuild(now, last)) return;

    // Only now do we swallow Vite's default throw — if we are NOT reloading, the error must be
    // allowed to propagate, or a genuinely broken deploy fails silently forever.
    event.preventDefault();

    try {
      host.sessionStorage.setItem(STALE_BUILD_RELOAD_KEY, String(now));
    } catch {
      // Unwritable storage means no loop guard; reloading once is still the right move.
    }

    host.location.reload();
  });
}

/** The real-browser host. Separated so `installStaleBuildRecovery` stays free of globals. */
export function browserStaleBuildHost(): StaleBuildHost {
  return {
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    sessionStorage: window.sessionStorage,
    location: { reload: () => void window.location.reload() },
    now: () => Date.now(),
  };
}
