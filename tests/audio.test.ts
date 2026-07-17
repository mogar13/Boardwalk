/**
 * The sound registry is a promise that a file exists, and this is the test that keeps it honest.
 *
 * `sounds.ts` is pure data on purpose (no DOM, no engine) so it can be checked against the real
 * `public/audio/` directory here: every file a role names must be on disk, or the promise is a
 * dead reference — the audio equivalent of `loadout.color`, a manifest entry read by nothing
 * because the thing it points at is not there. A misspelled or un-staged filename typechecks fine
 * (it is a string), so only a disk check catches it. This is the "a guard that matches nothing
 * reports success" rule pointed at assets: the registry MUST resolve, and here it is made to.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allSoundFiles, SOUND_NAMES, SOUNDS } from '@/system/audio/sounds';

const AUDIO_DIR = fileURLToPath(new URL('../public/audio/', import.meta.url));

describe('the sound registry', () => {
  it('names at least one file for every role', () => {
    for (const name of SOUND_NAMES) {
      expect(SOUNDS[name].length, `role "${name}" has no files`).toBeGreaterThan(0);
    }
  });

  it('resolves every declared file to one that exists on disk', () => {
    const missing = allSoundFiles().filter((file) => !existsSync(AUDIO_DIR + file));
    expect(missing, `these registry sounds are not staged in public/audio/: ${missing.join(', ')}`).toEqual(
      []
    );
  });

  it('lists no file twice within a single role (a variation pool should be distinct takes)', () => {
    for (const name of SOUND_NAMES) {
      const pool = SOUNDS[name];
      expect(new Set(pool).size, `role "${name}" repeats a file`).toBe(pool.length);
    }
  });

  it('exposes the click primer as a single short file (the engine reaches for SOUNDS.click[0])', () => {
    expect(SOUNDS.click.length).toBe(1);
    expect(SOUNDS.click[0]).toBeDefined();
  });
});
