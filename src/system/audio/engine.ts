import { SOUNDS, type SoundName } from '@/system/audio/sounds';

/**
 * The playback engine — the one impure corner of the audio OS. It touches `HTMLAudioElement`, so
 * it is NOT in a game's `logic/` (nothing here is portable to a server), but it is also not React:
 * it is a module singleton the hook drives, because an audio element cache and the browser's
 * one-time unlock latch are not things a component owns or re-renders on.
 *
 * EVERYTHING IS GUARDED FOR NO-DOM. This module is safe to import where `window`/`Audio` do not
 * exist (a Node test, an SSR pass): there is no top-level DOM access, and every function no-ops
 * when `Audio` is undefined. That keeps `sounds.ts` importable in tests without dragging a
 * fake DOM in behind it.
 *
 * FAILURE IS SILENT BY DESIGN. `play()` swallows rejections. A sound is a garnish; a blocked
 * autoplay, a decode error, or a missing file must never surface as an unhandled rejection that
 * breaks a hand of blackjack. v1 landed here too — every `.play()` there ends `.catch(() => …)`.
 */

const BASE = `${import.meta.env.BASE_URL}audio/`;

/** One cached element per FILE (not per role), so variations share nothing and can overlap. */
const cache = new Map<string, HTMLAudioElement>();
let unlocked = false;

function hasAudio(): boolean {
  return typeof document !== 'undefined' && typeof Audio !== 'undefined';
}

function element(file: string): HTMLAudioElement | null {
  if (!hasAudio()) return null;
  let el = cache.get(file);
  if (el === undefined) {
    el = new Audio(BASE + file);
    el.preload = 'auto';
    cache.set(file, el);
  }
  return el;
}

/** Pick a file for a role — a random take for a multi-file pool, so rapid deals do not machine-gun. */
function fileFor(name: SoundName): string {
  const pool = SOUNDS[name];
  // A pool is never empty (the registry type guarantees at least the declared entries), but index
  // defensively so a hand-edited registry cannot hand `new Audio(undefined)` to the browser.
  const pick = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
  return pick ?? '';
}

/**
 * Play a role. Rewinds first, so the same element retriggers on a fast repeat instead of being
 * ignored mid-play. No-op without a DOM, and never throws. Muting is the CALLER's job (the hook
 * checks the store) — the engine just plays what it is told, which keeps the unlock primer able to
 * fire while muted.
 */
export function play(name: SoundName): void {
  const el = element(fileFor(name));
  if (el === null) return;
  el.currentTime = 0;
  void el.play().catch(() => {
    // Autoplay blocked, decode failed, or file missing — a garnish, so let it go quietly.
  });
}

/**
 * Satisfy the browser's autoplay gate on the first user gesture: play the short `click` primer at
 * zero volume and immediately pause it, which "unlocks" the audio context so later, gesture-less
 * plays (an AI's card, an opponent's move) are allowed. Idempotent — the latch means the real
 * click that triggers it is not itself silenced.
 */
export function unlock(): void {
  if (unlocked || !hasAudio()) return;
  const first = SOUNDS.click[0];
  if (first === undefined) return;
  const el = element(first);
  if (el === null) return;
  const restore = el.volume;
  el.volume = 0;
  void el
    .play()
    .then(() => {
      el.pause();
      el.currentTime = 0;
      el.volume = restore;
      unlocked = true;
    })
    .catch(() => {
      el.volume = restore;
    });
}
