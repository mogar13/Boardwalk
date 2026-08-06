/**
 * BETTING THE HOUSE — the two seams slice 5 opened between the OS and a game's rulebook, and the
 * assertions that are the only thing keeping either from drifting.
 *
 * Neither seam can pay anybody the wrong amount: the referee runs the rulebook, and everything here
 * is about what the LOBBY says and locks. That is precisely why they need a test. A wrong payout
 * announces itself in a ledger; a lobby that says "winner takes the pot" at a table the house is
 * banking, or offers a `Casual` button at a table that will be dealt `sharp`, is a screen that is
 * simply wrong forever and looks completely fine — which is the failure the ante line already
 * shipped once (a guest offered a SIT button on a $25 table with nothing on screen saying so).
 *
 * 1. **`tableBacking` vs `potBacking`.** Two mechanisms for one rule, which this repo permits only
 *    with an assertion attached (`tests/uno-house-rules.test.ts` does the same for the manifest's
 *    toggle ids against the rulebook's keys). They exist apart because `src/system/room` may not
 *    import a rulebook — it moves a bag it must not interpret — so the agreement is asserted rather
 *    than made structural.
 * 2. **The pinned tier.** `manifest.options[].pinnedForMoney` is data the OS draws and the game
 *    means, so the value it names has to be a choice the option actually offers AND the level the
 *    odds were measured against.
 */
import { describe, expect, it } from 'vitest';
import {
  HOUSE_TABLE_LEVEL,
  MIN_HUMANS_TO_BET,
  housePayout,
  potBacking,
  potFor,
  type PotSeat,
} from '@boardwalk/game-logic/games/uno';
import { registry } from '@/games/registry';
import { tableBacking } from '@/system/room/ante';
import { pinnedOptionValues, type GameOptionsSpec } from '@/system/options/options';
import { unoBotLevel, unoManifest } from '@/games/uno/manifest';

const human = (uid: string): PotSeat => ({ kind: 'human', uid });
const ai = (): PotSeat => ({ kind: 'ai', uid: null });
const open = (): PotSeat => ({ kind: 'open', uid: null });

const RUNGS = [0, 100, 2_500, 10_000, 100_000];

describe('the OS and the rulebook agree about who is funding a table', () => {
  /**
   * THE BIJECTION, over every table shape UNO declares and every rung the ladder offers.
   *
   * Read off the REAL manifest rather than a fixture, because the flag that makes a lone player
   * chargeable at all (`betting.house`) is a manifest declaration and half of what is being
   * compared. A fixture would prove the two functions agree about a game that does not exist.
   */
  it('answers the same thing for every table shape, every rung and every mix', () => {
    const betting = unoManifest.betting;
    for (const ante of RUNGS) {
      for (let size = 2; size <= 7; size += 1) {
        for (let humans = 0; humans <= size; humans += 1) {
          for (const filler of [ai, open]) {
            const seats: PotSeat[] = Array.from({ length: size }, (_, i) =>
              i < humans ? human(`u${String(i)}`) : filler()
            );
            expect(tableBacking(betting, ante, humans)).toBe(potBacking(seats, ante));
          }
        }
      }
    }
  });

  it('flips to a players’ pot at exactly the rulebook’s threshold', () => {
    // The OS restates `MIN_HUMANS_TO_BET` because it may not import it. The constant itself is
    // private to `ante.ts` — what is asserted is the behaviour it produces, at the boundary and one
    // below it, which is what would actually be wrong if somebody changed one and not the other.
    const betting = unoManifest.betting;
    expect(tableBacking(betting, 2_500, MIN_HUMANS_TO_BET)).toBe('players');
    expect(tableBacking(betting, 2_500, MIN_HUMANS_TO_BET - 1)).toBe('house');
  });

  it('says NOTHING for a game that never measured what its bots are worth', () => {
    // The flag is the whole gate: without it a lone player at a betting game plays for XP, exactly
    // as every table did before this slice. Asserted with a hand-built spec rather than a real
    // manifest because UNO is the only game that declares it, and the case that matters is the one
    // where a future game does not.
    expect(tableBacking({ min: 100, max: 100_000 }, 2_500, 1)).toBe('none');
    expect(tableBacking({ min: 100, max: 100_000, house: false }, 2_500, 1)).toBe('none');
    expect(tableBacking({ min: 100, max: 100_000 }, 2_500, 2)).toBe('players');
    expect(tableBacking(undefined, 2_500, 4)).toBe('none');
  });

  it('degrades rather than rendering a sentence about money it cannot compute', () => {
    const betting = unoManifest.betting;
    expect(tableBacking(betting, Number.NaN, 4)).toBe('none');
    expect(tableBacking(betting, -2_500, 4)).toBe('none');
    expect(tableBacking(betting, 2_500, Number.NaN)).toBe('none');
    expect(tableBacking(betting, 0, 4)).toBe('none');
  });

  it('only lets a game bank a lone player if it can actually SEAT one against bots', () => {
    // A house table is one human and the rest of the chairs filled by the house. A game declaring
    // `betting.house` without an `ai` mode declares a table it cannot build — the lobby would offer
    // a stake at a table that can never fill, so Start never lights up. The seat-picker rule
    // ("every size it offers is one the lobby can actually START") one step across.
    for (const game of registry) {
      if (game.manifest.betting?.house !== true) continue;
      expect(game.manifest.modes).toContain('ai');
      expect(game.manifest.seats.max).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the tier the house pays for is pinned, and the control cannot say otherwise', () => {
  const spec: GameOptionsSpec = unoManifest.options;

  it('pins a value the option actually offers, and it is the measured level', () => {
    // Two failures, both of which typecheck and neither of which throws. A pin outside `choices`
    // renders a locked control with nothing in it (the `default` guard's twin). A pin that is not
    // `HOUSE_TABLE_LEVEL` is worse and completely silent: the referee deals the level the odds were
    // priced against, the lobby promises a different one, and the player is told they are facing
    // something they are not.
    const pinned = spec.filter((option) => option.pinnedForMoney !== undefined);
    expect(pinned.length).toBeGreaterThan(0);
    for (const option of pinned) {
      const pin = option.pinnedForMoney;
      expect(option.choices.map((c) => c.value)).toContain(pin?.value);
      expect(pin?.why.length ?? 0).toBeGreaterThan(0);
    }
    expect(spec.find((o) => o.id === 'bots')?.pinnedForMoney?.value).toBe(HOUSE_TABLE_LEVEL);
  });

  it('overrides a chosen tier when the house is paying, and only then', () => {
    // The pin is what both the control and the game read, so this is the whole of "the screen and
    // the deal agree". At a table of PEOPLE it must change nothing — nobody there is paying for
    // anybody else's difficulty.
    const casual = { bots: 'casual' };
    expect(unoBotLevel(pinnedOptionValues(spec, casual, true))).toBe(HOUSE_TABLE_LEVEL);
    expect(unoBotLevel(pinnedOptionValues(spec, casual, false))).toBe('casual');
  });

  it('returns the same object by identity when nothing is pinned', () => {
    // Read in render, so a fresh object every pass is a re-render on every keystroke in the lobby —
    // `setOptionValue`'s rule, which this is built on top of.
    const values = { bots: 'sharp' };
    expect(pinnedOptionValues(spec, values, false)).toBe(values);
    expect(pinnedOptionValues(spec, values, true)).toBe(values); // already at the pinned value
    expect(pinnedOptionValues([], { bots: 'casual' }, true)).toEqual({ bots: 'casual' });
  });
});

describe('what the lobby is describing is what the referee will pay', () => {
  it('quotes a house pot the player can actually be paid, at every rung and size', () => {
    // The lobby names no multiple, deliberately — the odds are a rule of the game. What it DOES
    // claim, by saying "the house banks the pot", is that there is a pot to bank. This asserts the
    // claim: wherever the OS says `'house'`, the rulebook builds a pot bigger than the one stake in
    // it, so the sentence on screen is backed by money the referee will actually move.
    for (const ante of RUNGS.filter((r) => r > 0)) {
      for (let size = 2; size <= 7; size += 1) {
        const seats = [human('solo'), ...Array.from({ length: size - 1 }, () => ai())];
        expect(tableBacking(unoManifest.betting, ante, 1)).toBe('house');
        expect(potFor(seats, ante)).toBe(housePayout(ante, size));
        expect(potFor(seats, ante)).toBeGreaterThan(ante);
      }
    }
  });
});
