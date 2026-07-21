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
import {
  defaultOptionValues,
  resolveOptionValues,
  setOptionValue,
  type GameOptionsSpec,
} from '@/system/options/options';
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
