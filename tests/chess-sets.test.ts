import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHESS_GLYPH,
  CHESS_SETS,
  DEFAULT_CHESS_SET,
  chessPieceSrc,
  chessSet,
  type ChessPieceLetter,
} from '@/system/chess/chessSets';
import { CATALOG, cosmeticsOfKind } from '@boardwalk/game-logic';

/**
 * THE `chessset` COSMETIC — art that is on disk, and a catalogue that cannot outrun it.
 *
 * The same category as `tests/cards.test.ts`, `tests/felts.test.ts` and `tests/dice.test.ts`: a
 * filename is a string and typechecks however wrong it is, so the only real check is resolving it
 * against the disk. This one has a specific hazard the others do not, and it was hit while
 * curating the art: chess notation uses `n` for the KNIGHT because `k` is taken by the king, so
 * naming files from the first letter of the English word silently collapses two pieces into one.
 * That produced twelve files where two were wrong and ten were right, which no count check would
 * have caught — hence the exhaustive per-piece resolution below.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PIECES: readonly ChessPieceLetter[] = ['k', 'q', 'r', 'b', 'n', 'p'];

/** `chessPieceSrc` returns a BASE_URL-prefixed web path; map it back to a file under `public/`. */
function onDisk(src: string): string {
  return join(ROOT, 'public', src.replace(/^\/+/, '').replace(/^Boardwalk\//, ''));
}

describe('chess set art', () => {
  it('resolves all 12 men for every set that has piece art', () => {
    const withArt = CHESS_SETS.filter((s) => s.pieces !== 'glyph');
    expect(withArt.length).toBeGreaterThan(0);

    for (const set of withArt) {
      for (const color of ['w', 'b'] as const) {
        for (const type of PIECES) {
          const src = chessPieceSrc(set, color, type);
          expect(src, `${set.id} ${color}${type} has no src`).not.toBeNull();
          expect(existsSync(onDisk(src!)), `missing art: ${set.id} ${color}${type} → ${src!}`).toBe(
            true
          );
        }
      }
    }
  });

  /**
   * THE KING/KNIGHT COLLISION, stated as its own case. Both are drawn from the same folder, so a
   * naming slip makes them the SAME FILE and the board renders a king on both squares — which
   * looks like a rendering bug, not a curation one. Distinctness is the only thing that catches it.
   */
  it('gives the king and the knight different files', () => {
    for (const set of CHESS_SETS.filter((s) => s.pieces !== 'glyph')) {
      for (const color of ['w', 'b'] as const) {
        expect(chessPieceSrc(set, color, 'k')).not.toBe(chessPieceSrc(set, color, 'n'));
      }
      // And every one of the twelve is its own file — a set with two identical men is a set with
      // a piece missing, whichever pair collided.
      const all = (['w', 'b'] as const).flatMap((c) => PIECES.map((t) => chessPieceSrc(set, c, t)));
      expect(new Set(all).size, `${set.id} has duplicate piece art`).toBe(12);
    }
  });

  it('draws glyphs and no image for the starter set', () => {
    const classic = chessSet(DEFAULT_CHESS_SET);
    expect(classic.pieces).toBe('glyph');
    for (const type of PIECES) {
      expect(chessPieceSrc(classic, 'w', type)).toBeNull();
      // Every glyph set piece still has something to draw — a null src falls through to this map,
      // so a missing entry would render an empty square with no error anywhere.
      expect(CHESS_GLYPH[type]).toBeTruthy();
    }
  });

  /**
   * The STARTER keeps the board that shipped in Phase 6. `squares: null` is the load-bearing part:
   * it means the default board draws `bg-base-300`/`bg-base-200`, the same two utilities it always
   * did, so this whole cosmetic kind is additive on a live account and nobody's board moves.
   */
  it('leaves the default board exactly as it was — no squares of its own', () => {
    expect(chessSet(DEFAULT_CHESS_SET).squares).toBeNull();
  });

  it('falls back to the STARTER for an unknown or absent id, never to nothing', () => {
    // The card-back rule, not the felt's `null`: a board must always draw. A retired set id left
    // on an account degrades to the classic board, not to a grid of broken images.
    expect(chessSet(undefined).id).toBe(DEFAULT_CHESS_SET);
    expect(chessSet('cs_does_not_exist').id).toBe(DEFAULT_CHESS_SET);
    expect(chessSet('').id).toBe(DEFAULT_CHESS_SET);
  });

  it('is base-path aware, so production does not 404', () => {
    // Pages serves from `/Boardwalk/`, so a root-relative path breaks in prod and only in prod —
    // the failure mode `cardSrc` and `feltSrc` each have a case for.
    const src = chessPieceSrc(chessSet('cs_carved_brown'), 'w', 'k');
    expect(src).toContain(import.meta.env.BASE_URL);
  });
});

describe('chess set catalogue', () => {
  it('registers every catalogue set, and sells every registered one', () => {
    // BOTH DIRECTIONS. A catalogue row with no registered set is a purchase that renders nothing;
    // a registered set with no row is dead data. `frames.test.ts` makes the same pair of checks.
    const sold = cosmeticsOfKind('chessset').map((c) => c.id);
    const registered = CHESS_SETS.map((s) => s.id);
    expect([...sold].sort()).toEqual([...registered].sort());
  });

  it('has exactly one free starter, and it is the default', () => {
    const free = cosmeticsOfKind('chessset').filter((c) => c.priceCents === 0);
    expect(free).toHaveLength(1);
    expect(free[0]?.id).toBe(DEFAULT_CHESS_SET);
  });

  it('sells no earn-only set, because no chain grants one', () => {
    // The felt rule: an earn-only cosmetic with no grant site is unobtainable forever, which is the
    // `big_win`-with-no-unlock-site defect wearing a hat.
    expect(cosmeticsOfKind('chessset').filter((c) => c.priceCents === null)).toEqual([]);
  });

  it('gives every set its own appearance — two ids that look identical are one item sold twice', () => {
    const seen = CHESS_SETS.map(
      (s) => `${s.pieces}|${s.squares?.dark ?? '-'}|${s.squares?.light ?? '-'}`
    );
    expect(new Set(seen).size).toBe(CHESS_SETS.length);
  });

  it('spells square classes in FULL, so Tailwind can see them', () => {
    // The runtime half: every class is a well-formed `bg-chess-*`. This catches a typo'd literal.
    for (const set of CHESS_SETS) {
      if (set.squares === null) continue;
      for (const cls of [set.squares.dark, set.squares.light]) {
        expect(cls).toMatch(/^bg-chess-[a-z]+-(dark|light)$/);
      }
    }
  });

  /**
   * THE SOURCE-TEXT HALF, and it is the one that matters. Tailwind v4 generates a utility only if
   * it finds the COMPLETE name while scanning source; an interpolated `` `bg-chess-${name}-dark` ``
   * produces the right string at runtime and no CSS at all, so the board renders with no square
   * colour and every runtime assertion still passes.
   *
   * That is not hypothetical here — the check above was written first, claimed to guard exactly
   * this, and was falsified by replacing one class with a template literal: it stayed green,
   * because it inspects the value and Tailwind inspects the file. A test whose comment promises
   * more than it checks is the defect this repo keeps re-finding, so the promise is now kept by
   * reading the file, the same way `tests/theme-tokens.test.ts` reads `theme.css`.
   */
  it('builds no square class by interpolation — the scanner reads text, not values', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/system/chess/chessSets.ts', import.meta.url)),
      'utf8'
    );
    // COMMENTS STRIPPED FIRST. The module's own docblock quotes the forbidden pattern as the
    // example of what not to write, so scanning the raw file flags the warning against the
    // mistake — which is how this test failed on a clean tree the first time it ran. Only code
    // is scanned; a comment cannot generate a utility either way.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).not.toMatch(/`[^`]*bg-chess-[^`]*\$\{/);
  });

  it('backs every square class with a token the theme actually defines', () => {
    // `bg-chess-brown-dark` only exists if `--color-chess-brown-dark` does. Tailwind emits nothing
    // for an unmatched one and reports no error, so this resolves the utility against the one file
    // allowed to name a colour — the same check `tests/theme-tokens.test.ts` makes for shadows.
    const theme = fileURLToPath(new URL('../packages/theme/theme.css', import.meta.url));
    const css = readFileSync(theme, 'utf8');
    for (const set of CHESS_SETS) {
      if (set.squares === null) continue;
      for (const cls of [set.squares.dark, set.squares.light]) {
        expect(css, `theme.css defines no --color-${cls.slice(3)}`).toContain(
          `--color-${cls.slice(3)}:`
        );
      }
    }
  });

  it('is in the catalogue under exactly the ids the type expects', () => {
    for (const item of CATALOG.filter((c) => c.kind === 'chessset')) {
      expect(item.id).toMatch(/^cs_/);
    }
  });
});
