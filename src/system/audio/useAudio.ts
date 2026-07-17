import { useCallback, useEffect } from 'react';
import { AUDIO_STORAGE_KEY, readMuted, useAudioStore } from '@/system/audio/audioStore';
import { play as enginePlay, unlock } from '@/system/audio/engine';
import type { SoundName } from '@/system/audio/sounds';

/**
 * The game-facing audio hook. A game does `const { play } = useAudio()` and then `play('deal')` —
 * a ROLE, never a filename (see `sounds.ts`). Muting, the browser unlock gate, and cross-tab sync
 * are the OS's problem and handled once here, so a game never touches an `HTMLAudioElement` or a
 * `localStorage` key, the same way it never touches a Firebase listener.
 *
 * `play` is a no-op when muted — checked HERE, not in the engine, so the unlock primer can still
 * fire on the first gesture even if the player is muted (the browser needs the gesture regardless;
 * muting only silences the game's own sounds). The callback is stable, so passing it to an effect
 * dependency array or an event handler does not re-fire the effect on every render.
 */

/**
 * Global one-time wiring: the autoplay-unlock gesture listeners and the cross-tab mute sync. Guarded
 * by a module flag so it attaches EXACTLY once no matter how many components call the hook — a hook
 * runs per component, but these are page-global concerns, so they must not accumulate a listener per
 * mount (v1's exact class of leak, in a smaller place).
 */
let wired = false;
function wireGlobalOnce(): void {
  if (wired || typeof document === 'undefined') return;
  wired = true;

  const primeUnlock = (): void => {
    unlock();
  };
  document.addEventListener('click', primeUnlock, { once: true });
  document.addEventListener('touchstart', primeUnlock, { once: true });

  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key !== AUDIO_STORAGE_KEY) return;
    // Re-read through the same guarded helper rather than trusting `e.newValue`, so the store and
    // localStorage agree even if the event is malformed. `syncMuted` does NOT re-persist — the
    // originating tab already wrote it, and echoing would be a write loop.
    useAudioStore.getState().syncMuted(readMuted());
  });
}

export interface AudioApi {
  /** Play a role. Silent while muted. Never throws; a blocked or missing sound is swallowed. */
  readonly play: (name: SoundName) => void;
  /** Current mute flag, from the store (re-renders the caller when it flips). */
  readonly muted: boolean;
  /** Flip mute, persisting across tabs and reloads. */
  readonly toggleMute: () => void;
}

export function useAudio(): AudioApi {
  const muted = useAudioStore((s) => s.muted);
  const toggleMute = useAudioStore((s) => s.toggleMute);

  useEffect(() => {
    wireGlobalOnce();
  }, []);

  const play = useCallback(
    (name: SoundName) => {
      if (useAudioStore.getState().muted) return;
      enginePlay(name);
    },
    // `muted` is read fresh from the store inside, so `play` never goes stale and never needs to
    // change identity — a stable callback is what lets a game list it in an effect's deps safely.
    []
  );

  return { play, muted, toggleMute };
}
