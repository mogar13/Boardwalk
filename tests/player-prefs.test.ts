/**
 * PLAYER PREFERENCES — the third kind of thing a game can be played differently under, and the one
 * whose failures are all quiet.
 *
 * Nothing here can crash. A preference that reads back wrong simply makes the board behave the way
 * the player asked it not to, which reads as the app ignoring them rather than as a bug — so every
 * case below is about a value SURVIVING, and about the declaration that decides what it means when
 * nothing has been stored.
 *
 * Four things can go wrong, and there is a block for each:
 *
 * 1. **The resolution coerces.** `localStorage` hands back strings, and `Boolean('false')` is
 *    `true` — the obvious implementation turns every explicitly-disabled preference back ON the
 *    moment it round-trips through storage. That is the whole reason `resolvePref` matches two
 *    literals rather than coercing.
 * 2. **The key collides.** Two games sharing `autoDraw` would share one switch, which reads as the
 *    setting leaking rather than as a bug; and the store SWEEPS `localStorage` by prefix, so a
 *    prefix that is also another feature's prefix would adopt that feature's key as a preference.
 * 3. **The sweep trusts what it finds.** Stored text is user-editable, and a hand-written `"yes"`
 *    must not out-rank the default the game declared.
 * 4. **The DECLARED DEFAULT is wrong** — the one field here that can silently retune a live game.
 *    Auto-draw has shipped ON since it landed, so a `default: false` would turn a working feature
 *    off under every player who never opens the panel. Nothing static can know what "already
 *    shipped" means, so that half is a PINNED TABLE the registry is checked against, which makes
 *    adding a preference require someone to state its shipped behaviour on purpose.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PREF_KEY_PREFIX,
  playerPrefChoices,
  prefKey,
  resolvePref,
  type PlayerPrefSpec,
} from '@/system/prefs/prefs';
import { readStoredPrefs, usePrefsStore } from '@/system/prefs/prefsStore';
import { AUDIO_STORAGE_KEY } from '@/system/audio/audioStore';
import { OFFLINE_STORAGE_KEY } from '@/system/offline/queue';
import { STALE_BUILD_RELOAD_KEY } from '@/system/staleBuild/staleBuild';
import { registry } from '@/games/registry';

const ON: PlayerPrefSpec = { id: 'autoDraw', label: 'Auto draw', default: true };
const OFF: PlayerPrefSpec = { id: 'autoPass', label: 'Auto pass', default: false };

/** A `localStorage` good enough for the two things this module does: sweep it, and write to it. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
  };
}

function installStorage(store: ReturnType<typeof fakeStorage> | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  installStorage(undefined);
});

describe('resolvePref — stored text becomes a boolean, or the default', () => {
  it('reads the two literals it wrote', () => {
    expect(resolvePref('true', OFF)).toBe(true);
    expect(resolvePref('false', ON)).toBe(false);
  });

  /**
   * THE CASE THE FUNCTION EXISTS FOR. `Boolean('false')` is `true`, so a coercing implementation
   * cannot express "the player turned this off" at all — it re-enables auto-draw on every reload,
   * which looks exactly like the toggle not saving.
   */
  it('does not coerce — an explicit false stays false against a true default', () => {
    expect(resolvePref('false', ON)).toBe(false);
    expect(Boolean('false')).toBe(true); // the trap, stated so the case cannot be tidied away
  });

  it('falls back to the DECLARED default for anything else', () => {
    for (const junk of [null, undefined, '', ' ', '1', '0', 'yes', 'no', 'TRUE', 'False', '{}']) {
      expect(resolvePref(junk, ON), `${String(junk)} vs a true default`).toBe(true);
      expect(resolvePref(junk, OFF), `${String(junk)} vs a false default`).toBe(false);
    }
  });
});

describe('prefKey — namespaced, so two games do not share one switch', () => {
  it('separates the same pref id across games', () => {
    expect(prefKey('uno', 'autoDraw')).not.toBe(prefKey('dominoes', 'autoDraw'));
  });

  it('separates two prefs within one game', () => {
    expect(prefKey('uno', 'autoDraw')).not.toBe(prefKey('uno', 'autoPass'));
  });

  it('carries the prefix the sweep looks for', () => {
    expect(prefKey('uno', 'autoDraw').startsWith(PREF_KEY_PREFIX)).toBe(true);
  });

  /**
   * THE SWEEP IS BY PREFIX, so the prefix has to be one nothing else in this app shares. If another
   * feature's key started with it, `readStoredPrefs` would adopt that key as a preference — and the
   * damage is asymmetric: the mute flag stores `'true'`/`'false'` too, so it would be adopted
   * SILENTLY and correctly-looking, as a preference no game declares and nothing ever clears.
   */
  it('cannot collide with any other storage key this app writes', () => {
    for (const key of [AUDIO_STORAGE_KEY, OFFLINE_STORAGE_KEY, STALE_BUILD_RELOAD_KEY]) {
      expect(key.startsWith(PREF_KEY_PREFIX), key).toBe(false);
    }
  });
});

describe('readStoredPrefs — a sweep that trusts nothing it finds', () => {
  beforeEach(() => {
    usePrefsStore.setState({ values: {} });
  });

  it('picks up only its own keys', () => {
    installStorage(
      fakeStorage({
        [prefKey('uno', 'autoDraw')]: 'false',
        [AUDIO_STORAGE_KEY]: 'true',
        somethingElse: 'true',
      })
    );
    expect(readStoredPrefs()).toEqual({ [prefKey('uno', 'autoDraw')]: false });
  });

  /**
   * A hostile or hand-edited value is left ABSENT rather than guessed at, and absent is what makes
   * the spec's default apply. Storing it as `true` would let a hand-written `"yes"` out-rank the
   * default the game declared — the same posture `readOptionValues` takes with the query string.
   */
  it('leaves an un-parseable value absent, so the declared default still wins', () => {
    installStorage(fakeStorage({ [prefKey('uno', 'autoDraw')]: 'yes' }));
    const values = readStoredPrefs();
    expect(prefKey('uno', 'autoDraw') in values).toBe(false);
    expect(resolvePref(undefined, ON)).toBe(true);
  });

  it('is empty rather than throwing when there is no storage at all', () => {
    installStorage(undefined);
    expect(readStoredPrefs()).toEqual({});
  });

  /**
   * THE ROUND TRIP, which is the property the whole module is for: what `setPref` writes is what
   * a later boot reads back, as the SAME boolean. It is asserted through both halves rather than
   * on the in-memory map alone, because the map is correct for free — the persisted spelling is
   * the part that has to agree with `resolvePref`.
   */
  it('round-trips a value through storage in both directions', () => {
    installStorage(fakeStorage());
    usePrefsStore.getState().setPref('uno', 'autoDraw', false);
    expect(readStoredPrefs()[prefKey('uno', 'autoDraw')]).toBe(false);
    expect(resolvePref('false', ON)).toBe(false);

    usePrefsStore.getState().setPref('uno', 'autoDraw', true);
    expect(readStoredPrefs()[prefKey('uno', 'autoDraw')]).toBe(true);
  });

  it('survives a storage that throws on write', () => {
    const hostile = fakeStorage();
    hostile.setItem = () => {
      throw new Error('quota');
    };
    installStorage(hostile);
    expect(() => usePrefsStore.getState().setPref('uno', 'autoDraw', false)).not.toThrow();
    // The in-memory value still applies for this tab, which is the whole degradation.
    expect(usePrefsStore.getState().values[prefKey('uno', 'autoDraw')]).toBe(false);
  });
});

describe('playerPrefChoices — a game that declares none draws none', () => {
  it('is empty for an undeclared list', () => {
    expect(playerPrefChoices(undefined)).toEqual([]);
    expect(playerPrefChoices([])).toEqual([]);
  });

  it('passes a declared list through in order', () => {
    expect(playerPrefChoices([ON, OFF]).map((s) => s.id)).toEqual(['autoDraw', 'autoPass']);
  });
});

/**
 * THE DECLARATION HALF, over the REAL registry — `tests/game-options.test.ts`'s second half, for
 * the kind that did not exist when that file was written.
 *
 * `SHIPPED_DEFAULTS` is a PIN and says so. No test can compute "the behaviour this game already
 * had"; what it can do is refuse to let a preference exist without somebody writing that behaviour
 * down here, which is the forcing function. Asserted as a SET in both directions, so a new
 * preference fails until it is declared and a deleted one cannot leave a stale row behind.
 */
const SHIPPED_DEFAULTS: Readonly<Record<string, Readonly<Record<string, boolean>>>> = {
  // Auto-draw has drawn for a stuck hand since the day it landed. Off would be a live feature
  // silently disabled for everyone who never opens the panel.
  uno: { autoDraw: true },
};

describe('every declared preference is well-formed', () => {
  const declared = registry.flatMap(({ manifest }) =>
    playerPrefChoices(manifest.playerPrefs).map((spec) => ({ gameId: manifest.id, spec }))
  );

  it('has preferences to be true of', () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it('gives every preference a unique id within its game', () => {
    for (const { manifest } of registry) {
      const ids = playerPrefChoices(manifest.playerPrefs).map((s) => s.id);
      expect(new Set(ids).size, manifest.id).toBe(ids.length);
    }
  });

  /**
   * A blank label renders an unreadable button and a blank hint renders an empty line under it —
   * both typecheck, and `hint?: string` accepts `''` happily. The options seam learned this one
   * the same way.
   */
  it('gives every preference a label, and a hint that is either absent or real', () => {
    for (const { gameId, spec } of declared) {
      expect(spec.label.trim(), `${gameId}.${spec.id}`).not.toBe('');
      if (spec.hint !== undefined) expect(spec.hint.trim(), `${gameId}.${spec.id}`).not.toBe('');
    }
  });

  it('declares the default that matches the behaviour the game already shipped', () => {
    const actual: Record<string, Record<string, boolean>> = {};
    for (const { gameId, spec } of declared) {
      (actual[gameId] ??= {})[spec.id] = spec.default;
    }
    expect(actual).toEqual(SHIPPED_DEFAULTS);
  });
});
