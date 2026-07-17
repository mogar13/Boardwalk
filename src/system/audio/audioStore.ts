import { create } from 'zustand';

/**
 * The mute flag, and nothing else — the one piece of audio state that is genuinely STATE (the
 * rest, the HTMLAudioElement cache and the unlock latch, lives in the engine as module
 * singletons, because they are not things a component re-renders on). Zustand for the same reason
 * the profile is: a selector re-renders only the mute button, not the tree, and audio does not
 * belong on a context that would thrash.
 *
 * PERSISTED TO localStorage, and read defensively. v1's `SystemAudio.isMuted` read localStorage
 * on every access specifically so a mute toggled in another tab took effect immediately; here the
 * value seeds the store once and a `storage` listener (installed by the hook) keeps tabs in sync,
 * which is the same guarantee without a getter that hits disk on every sound. The read is guarded
 * because this module is importable in a Node test where `localStorage` does not exist — a bare
 * access would throw at import.
 */

const STORAGE_KEY = 'boardwalk_muted';

/** Read the persisted flag, or `false`, tolerating a missing/hostile `localStorage`. */
export function readMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    // Private-mode or storage-disabled: the in-memory flag still works for this tab.
  }
}

interface AudioState {
  readonly muted: boolean;
  readonly toggleMute: () => void;
  /** Set from a cross-tab `storage` event — updates the store WITHOUT re-persisting (no echo loop). */
  readonly syncMuted: (muted: boolean) => void;
}

export const useAudioStore = create<AudioState>((set, get) => ({
  muted: readMuted(),
  toggleMute() {
    const next = !get().muted;
    writeMuted(next);
    set({ muted: next });
  },
  syncMuted(muted) {
    set({ muted });
  },
}));

export const AUDIO_STORAGE_KEY = STORAGE_KEY;
