/**
 * A game icon is a filename on `manifest.icon`, and the only way it goes wrong is naming a file
 * that is not staged — the same failure `cardSrc` has (`tests/cards.test.ts`), and the same fix: a
 * disk check, because the string typechecks however wrong it is. This walks every registered
 * manifest that names an icon against `public/games/`.
 *
 * Icons are OPTIONAL — a game may register before its art is curated in — so a game with no icon is
 * skipped, not failed. But one that DECLARES an icon must resolve, or it is a dead reference.
 *
 * The base path is irrelevant to the disk check: `gameIconSrc` prefixes `import.meta.env.BASE_URL`
 * (`/` here, `/Boardwalk/` in prod), but what is verified is the FILENAME under `public/games/`.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gameIconSrc, registry } from '@/games/registry';

const GAMES_DIR = fileURLToPath(new URL('../public/games/', import.meta.url));

describe('game icons', () => {
  it('every icon a manifest names resolves to a file on disk', () => {
    const declared = registry
      .map((game) => game.manifest.icon)
      .filter((icon): icon is string => icon !== undefined);
    // Guard the guard: if no game declared an icon this assertion would pass vacuously.
    expect(declared.length).toBeGreaterThan(0);
    const missing = declared.filter((icon) => !existsSync(GAMES_DIR + icon));
    expect(missing, `unstaged game icons: ${missing.join(', ')}`).toEqual([]);
  });

  it('gameIconSrc is base-path-aware and undefined-safe', () => {
    expect(gameIconSrc(undefined)).toBeUndefined();
    // BASE_URL is '/' under test; the resolver just prefixes the games dir.
    expect(gameIconSrc('blackjack.png')).toBe('/games/blackjack.png');
  });
});
