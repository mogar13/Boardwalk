/**
 * The pre-game options seam — the pure half, plus the integrity of every spec a manifest declares.
 *
 * Two things can go wrong with a declarative option, and this file is one guard for each:
 *
 * 1. **The resolution is wrong** — a stored or hostile value reaches a game's reducer as something
 *    it has no branch for. `resolveOptionValues` is the function that makes "complete and valid"
 *    true by construction, so it is asserted against every way a value can be absent or wrong.
 * 2. **The DECLARATION is wrong** — a default that is not one of the choices, or two options
 *    sharing an id. Both typecheck perfectly and neither throws; the first renders a control with
 *    nothing selected, the second silently makes one option unreachable. That is the same class as
 *    a `manifest.icon` naming a file nobody staged (`tests/game-icons.test.ts`), and the same fix:
 *    walk the real registry.
 */
import { describe, it, expect } from 'vitest';
import { ticTacToeHouseLevel, ticTacToeManifest } from '@/games/tic-tac-toe/manifest';
import { unoBotLevel, unoManifest } from '@/games/uno/manifest';
import {
  defaultOptionValues,
  resolveOptionValues,
  setOptionValue,
  type GameOptionsSpec,
} from '@/system/options/options';
import { readOptionValues, writeOptionValues } from '@/system/options/optionParams';
import { registry } from '@/games/registry';
import { solitaireDrawCount, solitaireManifest } from '@/games/solitaire/manifest';

const SPEC: GameOptionsSpec = [
  {
    id: 'draw',
    label: 'Draw',
    type: 'select',
    default: '1',
    choices: [
      { value: '1', label: 'Draw 1' },
      { value: '3', label: 'Draw 3' },
    ],
  },
  {
    id: 'deal',
    label: 'Deal',
    type: 'select',
    default: 'standard',
    choices: [
      { value: 'standard', label: 'Standard' },
      { value: 'winnable', label: 'Winnable' },
    ],
  },
];

describe('option values', () => {
  it('defaults every declared option, and nothing else', () => {
    expect(defaultOptionValues(SPEC)).toEqual({ draw: '1', deal: 'standard' });
    expect(defaultOptionValues([])).toEqual({});
  });

  it('resolves a complete, valid set from anything at all', () => {
    // Nothing stored, a partial set, an unoffered value, a wrong type, and a key no option owns —
    // every one of them lands on a value the game declared it can handle.
    expect(resolveOptionValues(SPEC, undefined)).toEqual({ draw: '1', deal: 'standard' });
    expect(resolveOptionValues(SPEC, { draw: '3' })).toEqual({ draw: '3', deal: 'standard' });
    expect(resolveOptionValues(SPEC, { draw: '7' })).toEqual({ draw: '1', deal: 'standard' });
    expect(resolveOptionValues(SPEC, { draw: 3 })).toEqual({ draw: '1', deal: 'standard' });
    expect(resolveOptionValues(SPEC, { draw: null })).toEqual({ draw: '1', deal: 'standard' });
    const resolved = resolveOptionValues(SPEC, { draw: '3', cheat: 'yes' });
    expect(resolved).toEqual({ draw: '3', deal: 'standard' });
    expect(Object.keys(resolved)).toEqual(['draw', 'deal']);
  });

  it('sets a value, and refuses one the option does not offer', () => {
    const values = defaultOptionValues(SPEC);
    expect(setOptionValue(SPEC, values, 'draw', '3')).toEqual({ draw: '3', deal: 'standard' });
    // A refusal is a NO-OP returning the SAME object — identity, not just equality, so a caller
    // rendering on change does not re-render on a write that changed nothing.
    expect(setOptionValue(SPEC, values, 'draw', '7')).toBe(values);
    expect(setOptionValue(SPEC, values, 'nosuch', '1')).toBe(values);
    expect(setOptionValue(SPEC, values, 'draw', '1')).toBe(values);
  });

  it('never mutates the values it is given', () => {
    const values = defaultOptionValues(SPEC);
    const before = { ...values };
    setOptionValue(SPEC, values, 'draw', '3');
    expect(values).toEqual(before);
  });
});

describe('every declared spec in the registry', () => {
  const declared = registry.filter((game) => game.manifest.options !== undefined);

  it('has at least one caller — a seam with none is spec-ware', () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it('gives every option a unique id, and every choice a unique value', () => {
    for (const { manifest } of declared) {
      const ids = (manifest.options ?? []).map((option) => option.id);
      expect(new Set(ids).size, `${manifest.id}: duplicate option id`).toBe(ids.length);
      for (const option of manifest.options ?? []) {
        const values = option.choices.map((choice) => choice.value);
        expect(new Set(values).size, `${manifest.id}/${option.id}: duplicate choice`).toBe(
          values.length
        );
      }
    }
  });

  it('offers the default it declares — the failure that renders an empty control', () => {
    for (const { manifest } of declared) {
      for (const option of manifest.options ?? []) {
        expect(option.choices.length, `${manifest.id}/${option.id}: no choices`).toBeGreaterThan(1);
        expect(
          option.choices.map((choice) => choice.value),
          `${manifest.id}/${option.id}: default is not a choice`
        ).toContain(option.default);
      }
    }
  });

  it('pins a value it also offers, wherever an option pins one for money', () => {
    // The `default` guard's twin, and it fails the same silent way: a `pinnedForMoney.value` that
    // is not one of `choices` renders a locked control with nothing in it, and typechecks, because
    // both are plain strings. The registry-wide sweep is what makes this true of the SEVENTH game
    // rather than of the one that happens to declare it today (UNO's bot tier, pinned to the level
    // the house's odds were measured against).
    for (const { manifest } of declared) {
      for (const option of manifest.options ?? []) {
        const pin = option.pinnedForMoney;
        if (pin === undefined) continue;
        expect(
          option.choices.map((choice) => choice.value),
          `${manifest.id}/${option.id}: pinned value is not a choice`
        ).toContain(pin.value);
        // A lock with no reason on it reads as a broken control. The game writes the sentence
        // because the lobby must not acquire an opinion about what a value means.
        expect(pin.why.trim(), `${manifest.id}/${option.id}: pin has no reason`).not.toBe('');
        // And only a game that puts money on the table can pin anything FOR money.
        expect(
          manifest.betting,
          `${manifest.id}: pins for money but declares no betting`
        ).toBeDefined();
      }
    }
  });
});

describe('solitaire reads its own option', () => {
  it('turns the chosen string into the number the reducer takes', () => {
    expect(solitaireDrawCount(defaultOptionValues(solitaireManifest.options))).toBe(1);
    expect(solitaireDrawCount({ draw: '3' })).toBe(3);
    expect(solitaireDrawCount({ draw: '1' })).toBe(1);
    // Unreachable through the seam (values are resolved before a game sees them), but the reducer
    // must still be handed a number it accepts rather than an undefined draw.
    expect(solitaireDrawCount({})).toBe(1);
  });
});

/**
 * AI difficulty (V1_FEATURE_GAPS #1) declares no new mechanism — a tier is a `select` whose value a
 * game maps to a level its pure chooser takes. What that buys is one new way to be wrong, and it is
 * the frames-tone-vs-rarity shape: add a fourth choice to a manifest and the mapper keeps returning
 * the level it always did, silently, with the control still rendering perfectly. So the guard is a
 * BIJECTION — every declared choice reaches its own level, and every level is declared.
 */
describe('the AI difficulty declarations', () => {
  const tiers = [
    {
      what: 'tic-tac-toe/house',
      option: ticTacToeManifest.options[0],
      read: ticTacToeHouseLevel as (values: Record<string, string>) => string,
      shipped: 'perfect',
    },
    {
      what: 'uno/bots',
      option: unoManifest.options[0],
      read: unoBotLevel as (values: Record<string, string>) => string,
      shipped: 'sharp',
    },
  ];

  it('maps every declared choice to a level of its own — none collapses into another', () => {
    for (const { what, option, read } of tiers) {
      const levels = option.choices.map((choice) => read({ [option.id]: choice.value }));
      expect(new Set(levels).size, `${what}: two choices mean the same thing`).toBe(levels.length);
    }
  });

  it('leaves the shipped house as the default — a new option must not retune a live game', () => {
    for (const { what, option, read, shipped } of tiers) {
      expect(read(defaultOptionValues([option])), `${what}: default moved`).toBe(shipped);
      expect(option.default, `${what}: default is not the shipped level`).toBe(shipped);
    }
  });

  it('falls back to the shipped level rather than an undefined one', () => {
    // Unreachable through the seam (`resolveOptionValues` runs first), but a game must never hand
    // its chooser a level it has no branch for — that is a bot that stalls its own table.
    for (const { what, read, shipped } of tiers) {
      expect(read({}), `${what}: empty values`).toBe(shipped);
      expect(read({ house: 'brutal', bots: 'brutal' }), `${what}: unoffered value`).toBe(shipped);
    }
  });
});

/**
 * AN OPTION VALUE LIVES IN THE URL (plans/done/GAME_LAUNCH_MODAL.md §4), because a tier is chosen in a
 * modal on the HUB and read by a game the play route mounts one navigation later. `<GameShell>`
 * derives from here and writes back here, holding no copy — so what these cases protect is the one
 * property that makes that safe: the round trip is lossless, and everything else is defaults.
 *
 * A query string is USER-EDITABLE TEXT, which is why the read goes through `resolveOptionValues`
 * rather than being trusted. A value a reducer has no branch for is `solitaireDrawCount` returning
 * `undefined` and a deal of NaN cards; here it is simply the default.
 */
describe('options in the query string', () => {
  const params = (init: string) => new URLSearchParams(init);

  it('round-trips every value a real game offers', () => {
    // Swept over the registry rather than SPEC, so this is a fact about the games this app ships:
    // every choice of every declared option survives being written and read back.
    for (const { manifest } of registry) {
      for (const option of manifest.options ?? []) {
        for (const choice of option.choices) {
          const written = writeOptionValues(params(''), { [option.id]: choice.value });
          expect(
            readOptionValues([option], written)[option.id],
            `${manifest.id}/${option.id}=${choice.value}`
          ).toBe(choice.value);
        }
      }
    }
  });

  it('reads a missing, unoffered, empty or repeated key as the default', () => {
    expect(readOptionValues(SPEC, params(''))).toEqual({ draw: '1', deal: 'standard' });
    expect(readOptionValues(SPEC, params('o.draw=9'))).toEqual({ draw: '1', deal: 'standard' });
    expect(readOptionValues(SPEC, params('o.draw='))).toEqual({ draw: '1', deal: 'standard' });
    // A repeated key is what a hand-edited URL and a double write both produce. `get` takes the
    // first, which is a value the option offers — the point is that neither spelling escapes the
    // resolver, not which one wins.
    expect(readOptionValues(SPEC, params('o.draw=3&o.draw=9'))).toEqual({
      draw: '3',
      deal: 'standard',
    });
  });

  it('ignores a key no option owns, and a bare id with no prefix', () => {
    // `o.` is a namespace so that an option id can never collide with `table` or `mode`. A bare
    // `draw=3` is therefore NOT an option — reading it as one would let a link set a value the
    // shell never wrote.
    expect(readOptionValues(SPEC, params('o.zzz=1&table=ABCD'))).toEqual({
      draw: '1',
      deal: 'standard',
    });
    expect(readOptionValues(SPEC, params('draw=3'))).toEqual({ draw: '1', deal: 'standard' });
  });

  it('leaves every other param alone, and clears the options it replaces', () => {
    // The lobby's `?table=`/`?mode=` are the same query string, and losing either of them is
    // losing the table. Meanwhile the previous game's option keys must GO: the launch modal moves
    // from one game to another, and `resolveOptionValues` would ignore a stale `o.bots` while a
    // shared link kept carrying it forever.
    const next = writeOptionValues(params('table=ABCD&mode=ai&o.bots=casual'), { draw: '3' });
    expect(next.get('table')).toBe('ABCD');
    expect(next.get('mode')).toBe('ai');
    expect(next.get('o.bots')).toBeNull();
    expect(next.get('o.draw')).toBe('3');
  });

  it('does not mutate the params it was handed', () => {
    // React Router hands out one `URLSearchParams` per location; writing into it would corrupt the
    // value another render is still reading — `plannedSeats`' rule, one layer up.
    const before = params('table=ABCD&o.draw=1');
    const after = writeOptionValues(before, { draw: '3' });
    expect(before.toString()).toBe('table=ABCD&o.draw=1');
    expect(after).not.toBe(before);
  });
});
