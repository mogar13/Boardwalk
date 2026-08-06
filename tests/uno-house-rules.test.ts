import { describe, expect, it } from 'vitest';
import {
  applyMove,
  deal,
  toPublic,
  DEFAULT_HOUSE_RULES,
  resolveHouseRules,
  UNO_HOUSE_RULE_IDS,
  type UnoHouseRules,
  roundOver,
} from '@boardwalk/game-logic/games/uno';
import {
  houseRuleChoices,
  isRuleAvailable,
  isRuleOn,
  NO_TABLE_RULES,
  setTableRule,
  tableRulesFor,
  type HouseRuleSpec,
  type TableRules,
} from '@/system/room/houseRules';
import { unoManifest } from '@/games/uno/manifest';
import { registry } from '@/games/registry';

/**
 * HOUSE RULES, SLICE 1 — the seam, not the rules (plans/done/UNO_HOUSE_RULES.md §1).
 *
 * Every rule ships OFF, so nothing here asserts what stacking or ranked places DO. What it asserts
 * is the property that makes those safe to build on top: **the referee and every client read the
 * same booleans**, from the room, through one resolver, and a match keeps the rules it was dealt
 * with. A seam that gets that wrong fails in the worst available way — not a crash, but a guest
 * whose board greys out a card the dealer would have accepted.
 */

const SPECS: readonly HouseRuleSpec[] = [
  { id: 'stack', label: 'Stacking' },
  { id: 'crossStack', label: 'Cross-stacking', requires: 'stack' },
  { id: 'playToLast', label: 'Play for places' },
];

/**
 * UNO's real declaration, widened to the interface. The manifest is `as const`, so each spec
 * narrows to its own literal type and the ones without a `requires` do not have the property at
 * all — reading it off the union is a compile error. Widening here is what lets these tests treat
 * the declaration as the DATA it is, which is the whole point of the guard.
 */
const DECLARED: readonly HouseRuleSpec[] = unoManifest.houseRules;

describe('resolveHouseRules — garbage in, defaults out, never throws', () => {
  it('answers every rule OFF for anything that is not an object', () => {
    // The shape the seam actually meets: an old match row with no rules field, a room that
    // predates the feature, a hostile frame. None of them may throw, and none may read as ON.
    for (const junk of [undefined, null, 0, 1, '', 'stack', true, NaN, [], () => 0]) {
      expect(resolveHouseRules(junk)).toEqual(DEFAULT_HOUSE_RULES);
    }
  });

  it('reads only a literal `true` as on — a truthy value is a wire accident, not a yes', () => {
    for (const truthy of ['true', 1, 'yes', {}, []]) {
      expect(resolveHouseRules({ stack: truthy }).stack).toBe(false);
    }
    expect(resolveHouseRules({ stack: true }).stack).toBe(true);
  });

  it('ignores keys it does not know, and fills in the ones it does', () => {
    expect(resolveHouseRules({ playToLast: true, nonsense: true })).toEqual({
      stack: false,
      crossStack: false,
      playToLast: true,
    });
  });

  it('reads OWN properties only — an inherited rule is not a rule this table set', () => {
    /**
     * `{ __proto__: { stack: true } }` in a literal sets the PROTOTYPE, not a key, so a bare
     * `raw[id]` finds `stack` on an object that owns nothing. The first draft of `flag` did exactly
     * that, and this test is what found it — the failure direction is the bad one, since it turns a
     * rule ON for a table that never asked. Not reachable over the wire (`JSON.parse` makes
     * `__proto__` an ordinary own key), but "ids it does not know are ignored" has to be true.
     * Falsified by dropping the `Object.hasOwn` guard.
     */
    const inherited = { __proto__: { stack: true, playToLast: true } } as Record<string, unknown>;
    expect(resolveHouseRules(inherited)).toEqual(DEFAULT_HOUSE_RULES);
    expect(resolveHouseRules(Object.create({ stack: true }) as unknown)).toEqual(
      DEFAULT_HOUSE_RULES
    );
  });

  it('NORMALISES cross-stacking off without stacking', () => {
    // The property that keeps the reducer from having to spell `rules.stack && rules.crossStack` at
    // every read site — and from forgetting to at the fourth one. "+4 onto a +2" is a statement
    // about a stack; with no stack there is no position in which it means anything.
    expect(resolveHouseRules({ crossStack: true })).toEqual(DEFAULT_HOUSE_RULES);
    expect(resolveHouseRules({ stack: true, crossStack: true })).toEqual({
      stack: true,
      crossStack: true,
      playToLast: false,
    });
  });

  it('is total over the declared id set — every id, and no others', () => {
    // Falsified by adding a field to `UnoHouseRules` without adding it here: the key sets diverge.
    const all = Object.fromEntries(UNO_HOUSE_RULE_IDS.map((id) => [id, true]));
    expect(Object.keys(resolveHouseRules(all)).sort()).toEqual([...UNO_HOUSE_RULE_IDS].sort());
    expect(Object.keys(DEFAULT_HOUSE_RULES).sort()).toEqual([...UNO_HOUSE_RULE_IDS].sort());
  });

  it('never hands back a mutable default a caller could poison', () => {
    // `DEFAULT_HOUSE_RULES` is returned by reference on the garbage path, so a caller that wrote to
    // it would turn a rule on for every table that had not chosen one, process-wide.
    expect(Object.isFrozen(DEFAULT_HOUSE_RULES)).toBe(true);
  });
});

describe("the manifest's toggles and the rulebook's keys are one list", () => {
  /**
   * THE DRIFT THIS EXISTS FOR typechecks perfectly and renders perfectly. Add a fourth toggle to
   * the manifest and the lobby draws it, the host ticks it, the server stores it, the wire carries
   * it — and the resolver drops it on the floor, so it does nothing, forever, silently. The
   * opposite direction is a rule the reducer reads that no table can ever turn on.
   *
   * Asserted as a SET in both directions, the same shape as the mastery-chain guard.
   */
  it('every declared toggle is a rule the resolver reads, and every rule has a toggle', () => {
    const declared = (unoManifest.houseRules ?? []).map((s) => s.id).sort();
    expect(declared).toEqual([...UNO_HOUSE_RULE_IDS].sort());
  });

  it("a spec's `requires` agrees with what the resolver normalises away", () => {
    // Two mechanisms for one rule — the lobby disables the control, the resolver drops the value —
    // and this is what stops them disagreeing. For every spec that declares a prerequisite, setting
    // the dependent WITHOUT it must resolve to off; for every spec that does not, it must not.
    for (const spec of DECLARED) {
      const alone = resolveHouseRules({ [spec.id]: true }) as unknown as Record<string, boolean>;
      expect(alone[spec.id]).toBe(spec.requires === undefined);
    }
  });

  it('no other game declares house rules it has no resolver for', () => {
    // The bijection above is UNO's. This is the rule for everyone else: a game that declares
    // toggles owes a resolver, and none of the other five has one.
    const others = registry.filter((g) => g.manifest.id !== 'uno');
    expect(others.filter((g) => g.manifest.houseRules !== undefined)).toEqual([]);
  });

  it('declares unique, non-empty ids and labels, and no dangling prerequisite', () => {
    const specs = DECLARED;
    const ids = specs.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of specs) {
      expect(s.id).not.toBe('');
      expect(s.label).not.toBe('');
      if (s.requires !== undefined) expect(ids).toContain(s.requires);
    }
    // Every declared spec survives `houseRuleChoices` — i.e. the lobby draws all of them. A spec
    // silently dropped here is a control the host can never reach.
    expect(houseRuleChoices(specs).map((s) => s.id)).toEqual(ids);
  });
});

describe('the OS bag of booleans', () => {
  it('draws nothing for a game that declares none', () => {
    expect(houseRuleChoices(undefined)).toEqual([]);
    expect(houseRuleChoices([])).toEqual([]);
  });

  it('drops a spec whose prerequisite the game does not declare', () => {
    // A dangling `requires` renders a checkbox that can never be enabled — the same defect as a
    // control that cannot change the outcome, which is what `tableSizeChoices` collapses for.
    const dangling = houseRuleChoices([{ id: 'crossStack', label: 'x', requires: 'stack' }]);
    expect(dangling).toEqual([]);
  });

  it('reads an absent rule as off, so `{}` and every-rule-false are the same table', () => {
    expect(isRuleOn(NO_TABLE_RULES, 'stack')).toBe(false);
    expect(isRuleOn({ stack: false }, 'stack')).toBe(false);
    expect(isRuleOn({ stack: true }, 'stack')).toBe(true);
  });

  it('SURVIVES A SNAPSHOT FROM A SERVER THAT PREDATES THE FIELD', () => {
    /**
     * The deploy-ordering guard. The frontend deploys on push and the Pi deploys by hand, so a new
     * client WILL at some point read a snapshot from a referee that has never heard of house rules
     * — its `meta.houseRules` is `undefined`, and `undefined[id]` is a TypeError that takes down
     * the lobby for EVERY room game, not just UNO. The Pi still goes first; this is what makes
     * getting that wrong degrade instead of break. Falsified by dropping the `?.`.
     */
    const fromOldServer = undefined as unknown as TableRules;
    expect(isRuleOn(fromOldServer, 'stack')).toBe(false);
    expect(isRuleAvailable(fromOldServer, SPECS[1] as HouseRuleSpec)).toBe(false);
    expect(tableRulesFor(fromOldServer, SPECS)).toEqual({});
  });

  it('will not turn on a rule whose prerequisite is off', () => {
    const next = setTableRule(NO_TABLE_RULES, SPECS, 'crossStack', true);
    expect(next).toBe(NO_TABLE_RULES); // same object — a no-op click must not re-render
    expect(isRuleAvailable(NO_TABLE_RULES, SPECS[1] as HouseRuleSpec)).toBe(false);
  });

  it('CASCADES: turning a prerequisite off turns off what depended on it', () => {
    // Without this, un-ticking "stacking" leaves `crossStack: true` in the bag — invisible in the
    // lobby, carried to the server, and only saved by the game's resolver remembering. The value a
    // host sends should be the value a host can see.
    let v: TableRules = setTableRule(NO_TABLE_RULES, SPECS, 'stack', true);
    v = setTableRule(v, SPECS, 'crossStack', true);
    expect(v).toEqual({ stack: true, crossStack: true });
    v = setTableRule(v, SPECS, 'stack', false);
    expect(v.crossStack).toBe(false);
    expect(resolveHouseRules(v)).toEqual(DEFAULT_HOUSE_RULES);
  });

  it('is a no-op — by identity — when nothing changes', () => {
    const on = setTableRule(NO_TABLE_RULES, SPECS, 'stack', true);
    expect(setTableRule(on, SPECS, 'stack', true)).toBe(on);
    expect(setTableRule(on, SPECS, 'nosuchrule', true)).toBe(on);
  });

  it('sends only what is on and only what the game declared', () => {
    const v: TableRules = { stack: true, crossStack: false, smuggled: true };
    expect(tableRulesFor(v, SPECS)).toEqual({ stack: true });
  });
});

describe('the rules ride the MATCH, not just the room', () => {
  const rng = () => 0.42;

  it('`deal` stamps them onto the game, resolved', () => {
    const g = deal(3, rng, 0, { stack: true, crossStack: true, junk: true });
    expect(g.houseRules).toEqual({ stack: true, crossStack: true, playToLast: false });
  });

  it('`deal` defaults to every rule off, so an unconfigured table is the table that existed', () => {
    expect(deal(3, rng).houseRules).toEqual(DEFAULT_HOUSE_RULES);
    expect(deal(3, rng, 0, undefined).houseRules).toEqual(DEFAULT_HOUSE_RULES);
  });

  it('SURVIVES A MOVE — the play branch rebuilds the game field by field', () => {
    /**
     * The bug this catches is invisible and total. `applyMove`'s play branch returns a fresh object
     * literal rather than spreading its input, so a field added to `UnoGame` and not added there is
     * simply absent from move one onward — no type error, no crash, and `resolveHouseRules` then
     * reads the hole as all-false. A stacking table would quietly stop stacking the instant anybody
     * played a card. Falsified by deleting the `houseRules` line in that literal.
     */
    const rules = { stack: true, playToLast: true };
    let g = deal(3, rng, 0, rules);
    const expected = resolveHouseRules(rules);
    expect(g.houseRules).toEqual(expected);

    // Play the table out for a while, through both branches (a play and a draw).
    for (let i = 0; i < 25 && !roundOver(g); i += 1) {
      const hand = g.hands[g.turn] ?? [];
      const playable = hand.find((c) => c.color === g.color || c.color === 'wild');
      const before = g;
      g =
        playable === undefined
          ? applyMove(g, g.turn, { type: 'draw' }, rng)
          : applyMove(g, g.turn, { type: 'play', cardId: playable.id, chosenColor: 'red' }, rng);
      if (g === before) g = applyMove(g, g.turn, { type: 'draw' }, rng);
      expect(g.houseRules).toEqual(expected);
    }
  });

  it('SURVIVES THE JSON ROUND TRIP the referee stores the match through', () => {
    // `uno_matches.state_json` is where a match lives between requests, so anything that does not
    // survive `JSON.parse(JSON.stringify(...))` does not survive a restart.
    const g = deal(4, rng, 0, { stack: true });
    const back = JSON.parse(JSON.stringify(g)) as typeof g;
    expect(back.houseRules).toEqual({ stack: true, crossStack: false, playToLast: false });
  });

  it('`toPublic` carries them, so a client feel-check reads what the referee enforced', () => {
    const g = deal(3, rng, 0, { stack: true, playToLast: true });
    expect(toPublic(g, 0).houseRules).toEqual({
      stack: true,
      crossStack: false,
      playToLast: true,
    });
  });

  it('`toPublic` RESOLVES rather than passes through — a pre-feature match projects as off', () => {
    /**
     * There are live `uno_matches` rows on the Pi dealt before this field existed. Read back, their
     * `game.houseRules` is `undefined`, and passing that straight onto the projection would put a
     * hole on the wire where every client expects three booleans. All-false is not a fallback here:
     * a match dealt before house rules existed was genuinely dealt under exactly these rules.
     */
    const legacy = { ...deal(3, rng), houseRules: undefined } as unknown as Parameters<
      typeof toPublic
    >[0];
    const view = toPublic(legacy, 0);
    expect(view.houseRules).toEqual(DEFAULT_HOUSE_RULES);
    // And it is a real object on the wire, not a dropped key.
    const onWire = JSON.parse(JSON.stringify(view)) as { houseRules?: unknown };
    expect(onWire.houseRules).toEqual(DEFAULT_HOUSE_RULES);
  });

  it('is wire-safe: no null anywhere, so RTDB has nothing to drop', () => {
    const view = toPublic(deal(2, rng, 0, { stack: true }), 0);
    const rules: UnoHouseRules = view.houseRules;
    expect(Object.values(rules).every((v) => typeof v === 'boolean')).toBe(true);
    expect(JSON.stringify(view)).not.toContain('null');
  });
});
