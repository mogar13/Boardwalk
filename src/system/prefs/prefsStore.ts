import { create } from 'zustand';
import { PREF_KEY_PREFIX, prefKey, resolvePref, type PlayerPrefSpec } from '@/system/prefs/prefs';

/**
 * WHERE A PLAYER'S OWN TOGGLES LIVE — `audioStore.ts`'s sibling, and built to the same shape for
 * the same reasons: Zustand so a selector re-renders the one board that reads a preference rather
 * than the tree, `localStorage` so it survives a reload, and a `storage` listener so two tabs of
 * one account do not disagree.
 *
 * It is the mute flag's generalisation and it is deliberately no more general than that. A
 * preference is a BOOLEAN keyed by `(gameId, prefId)` — there is no value type, no schema and no
 * migration, because the moment a preference needs a shape it has stopped being "how my client
 * operates the controls" and become an option or a house rule. See `prefs.ts` for that test.
 *
 * WHY THE WHOLE MAP IS SEEDED AT MODULE LOAD rather than read lazily per key. A selector must be
 * pure — it runs during render — so a `usePlayerPref` that hit `localStorage` on a miss and cached
 * the result would be writing state from a render, which React 19 will tear on. Sweeping our own
 * prefixed keys once at startup makes every subsequent read a plain object lookup, and an absent
 * key is simply a preference nobody has touched, which resolves to the spec's default. The sweep
 * is O(number of stored preferences), which is bounded by how many toggles the games declare.
 */

/** Read every stored preference into a plain map. Tolerates a missing or hostile `localStorage`. */
export function readStoredPrefs(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  try {
    const store = globalThis.localStorage;
    // Not optional-chained into the loop: `length` and `key(i)` must come from the SAME object,
    // and a store that vanishes between them is the kind of thing that throws in private mode.
    if (store === undefined) return out;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key === null || !key.startsWith(PREF_KEY_PREFIX)) continue;
      const raw = store.getItem(key);
      // Anything that is not one of the two literals is left ABSENT rather than stored as a
      // guessed boolean — absent is what makes the spec's default apply, and a hand-edited
      // `"yes"` must not out-rank the default the game declared. Same rule as `resolvePref`,
      // which is where a value with a spec to hand goes through.
      if (raw === 'true') out[key] = true;
      else if (raw === 'false') out[key] = false;
    }
  } catch {
    // Storage disabled: every preference is its declared default for this session.
  }
  return out;
}

function writeStoredPref(key: string, on: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, on ? 'true' : 'false');
  } catch {
    // Private-mode or storage-disabled: the in-memory value still works for this tab.
  }
}

interface PrefsState {
  /** Full storage key → value, for keys that have actually been set. Absent = the spec's default. */
  readonly values: Readonly<Record<string, boolean>>;
  /** Set one preference, persisting it. */
  readonly setPref: (gameId: string, prefId: string, on: boolean) => void;
  /** Re-seed from storage after a cross-tab write. Does NOT persist — no echo loop. */
  readonly syncPrefs: () => void;
}

export const usePrefsStore = create<PrefsState>((set) => ({
  values: readStoredPrefs(),
  setPref(gameId, prefId, on) {
    const key = prefKey(gameId, prefId);
    writeStoredPref(key, on);
    set((s) => ({ values: { ...s.values, [key]: on } }));
  },
  syncPrefs() {
    set({ values: readStoredPrefs() });
  },
}));

/**
 * Cross-tab sync, attached EXACTLY once however many components read a preference — `useAudio`'s
 * `wireGlobalOnce`, and the same leak it avoids: a hook runs per component, and a listener added
 * per mount is v1's leak in a smaller place.
 *
 * It re-seeds the whole map rather than trusting `e.newValue`, so the store and storage agree even
 * if the event is malformed, and it filters on our own prefix so another feature's key does not
 * cost a sweep.
 */
let wired = false;
function wirePrefsSyncOnce(): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('storage', (e: StorageEvent) => {
    // `key === null` is `localStorage.clear()` from another tab — everything is gone, so re-seed.
    if (e.key !== null && !e.key.startsWith(PREF_KEY_PREFIX)) return;
    usePrefsStore.getState().syncPrefs();
  });
}

/**
 * READ ONE PREFERENCE — the game-facing half. A board calls this with its own manifest's spec and
 * gets a plain boolean, so nothing in a game ever spells a storage key or handles a missing value.
 *
 * The spec is passed in rather than looked up by id for the reason `resolveOptionValues` takes one:
 * the DEFAULT lives on the spec, so a caller holding the spec cannot read a preference the game
 * does not declare, and cannot get a value the game never offered.
 */
export function usePlayerPref(gameId: string, spec: PlayerPrefSpec): boolean {
  wirePrefsSyncOnce();
  return usePrefsStore((s) => {
    const stored = s.values[prefKey(gameId, spec.id)];
    // The map holds booleans; `resolvePref` takes the string form, so absent goes in as `undefined`
    // and lands on the default. One resolver for both paths — the storage sweep and this read
    // cannot come to different conclusions about what "not set" means.
    return resolvePref(stored === undefined ? undefined : String(stored), spec);
  });
}

/** Flip a preference. Returns a stable callback — it closes over nothing but the store. */
export function setPlayerPref(gameId: string, prefId: string, on: boolean): void {
  usePrefsStore.getState().setPref(gameId, prefId, on);
}
