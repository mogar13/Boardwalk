/**
 * HOUSE RULES — the ways a table can agree to play UNO differently, as one dense object of
 * booleans that both the referee and every client read.
 *
 * WHY THIS IS NOT A `manifest.option`. The options seam is the declared home for a pre-game
 * choice, and it is the wrong one here for the reason CLAUDE.md already states as that seam's one
 * limit: option values live in `<GameShell>`, which is per-CLIENT, and today's only room-game
 * option is read exclusively by the host. A house rule is read by everyone —
 *
 *   • a guest's board dims a card `canPlay` refuses, so a guest playing under different rules than
 *     the dealer swallows legal clicks and offers illegal ones;
 *   • the REFEREE enforces them, and it must take them from somewhere no client can name.
 *
 * So a house rule rides where the ante rides: stamped on the ROOM at create, published to every
 * subscriber in `RoomMeta`, and read off the room by the dealer. `unoStart` still has no field for
 * any of it — the property UNO_POT bought and this must not spend, because a client that can name
 * a game parameter can name a perfectly FAIR game nobody consented to.
 *
 * DENSE BOOLEANS, NOT A FLAG STRING OR A BITFIELD. All three have to survive the wire and be
 * agreed on by two codebases, and a typed object is the only one of them a compiler checks.
 *
 * EVERY RULE DEFAULTS OFF, and that is load-bearing rather than tidy: all-false IS "UNO as it plays
 * today", so the feature is additive on a live app and a table nobody configures is exactly the
 * table that already exists.
 */

/**
 * The rules a table can turn on. Each field is `false` in `DEFAULT_HOUSE_RULES`, and each is
 * enforced by the reducer in a later slice — this module is the seam, not the rules.
 */
export interface UnoHouseRules {
  /** Stacking: a +2 answers a +2, a +4 answers a +4, and the debt runs until somebody takes it. */
  readonly stack: boolean;
  /** …and a +4 answers a +2. Meaningless without `stack`, and normalised away without it — below. */
  readonly crossStack: boolean;
  /** Keep playing after 1st place: 2nd, then 3rd, last player standing is last. */
  readonly playToLast: boolean;
}

/**
 * Every rule off — today's game, exactly.
 *
 * Frozen for the reason `ANTE_RUNGS_CENTS` is: a shared default that can be pushed onto is a
 * default that acquires a rule nobody agreed to, and this object is handed straight back to
 * callers by `resolveHouseRules`.
 */
export const DEFAULT_HOUSE_RULES: UnoHouseRules = Object.freeze({
  stack: false,
  crossStack: false,
  playToLast: false,
});

/**
 * THE RULE IDS, as data — the list the lobby's toggles are declared against.
 *
 * It exists so "the ids a table can offer" and "the keys the reducer reads" cannot become two
 * lists. `tests/uno-house-rules.test.ts` asserts this equals the manifest's declared toggles as a
 * SET in both directions, which is the drift that would otherwise typecheck perfectly and render a
 * control that does nothing: a fourth toggle added to the manifest that no rule reads, or a rule
 * added here that no table can ever turn on.
 */
export const UNO_HOUSE_RULE_IDS: readonly (keyof UnoHouseRules)[] = Object.freeze([
  'stack',
  'crossStack',
  'playToLast',
]);

/**
 * `true` only for an OWN property whose value is a real boolean `true`.
 *
 * Two narrowings, both paid for. A truthy string or a `1` is a wire accident and not a yes — the
 * same call `sanitizeRules` makes on the server, so the two ends agree on what "on" is spelled
 * like. And `Object.hasOwn` rather than a bare index, because a bare index walks the PROTOTYPE
 * chain: an object literal carrying `__proto__: { stack: true }` sets the prototype rather than a
 * key, and every rule on it would then read as on for an object that owns nothing at all. A JSON
 * payload cannot do that (`JSON.parse` makes `__proto__` an ordinary own key), so this is not a
 * live hole over the wire — but this function's whole contract is "ids it does not know are
 * ignored", and reading inherited state is that contract being untrue in the one direction that
 * turns rules ON. Caught by the test that asserts it.
 */
const flag = (raw: Record<string, unknown>, id: keyof UnoHouseRules): boolean =>
  Object.hasOwn(raw, id) && raw[id] === true;

/**
 * GARBAGE IN, DEFAULTS OUT, NEVER THROWS — the discipline `resolveOptionValues` exists for, and
 * for the same reason: **a reducer reading a rule must never have to handle a value the table
 * could not have offered.** Every read site in the rulebook takes a complete `UnoHouseRules`, so
 * none of them branches on `undefined` and none of them can disagree about what a missing field
 * means.
 *
 * It takes `unknown` because that is honestly what arrives. Three callers, all of them holding
 * something they did not author:
 *
 *   • the DEALER, resolving what the room store recorded from a `create` frame a browser sent;
 *   • `toPublic`, resolving what came back out of `uno_matches.state_json` — which for a match
 *     dealt before this field existed is `undefined`, and must project as all-false rather than as
 *     a hole in the wire shape. That is not a defensive nicety: there are live rows on the Pi, and
 *     a match dealt yesterday genuinely WAS dealt under today's rules;
 *   • a client resolving `RoomMeta.houseRules`, which the OS carries as an opaque bag of booleans
 *     precisely so that `src/system/room` never has to import a game's rulebook.
 *
 * CROSS-STACKING IS NORMALISED OFF WITHOUT STACKING. `crossStack` means "+4 onto a +2", which is a
 * statement about a stack — with no stack there is no position in which it means anything. It is
 * resolved away HERE rather than checked at each read site, so the reducer never spells
 * `rules.stack && rules.crossStack` and cannot forget to on the fourth one. Same call as flooring
 * a fractional stake at the boundary instead of asking every ledger row to.
 */
export function resolveHouseRules(raw: unknown): UnoHouseRules {
  if (raw === null || typeof raw !== 'object') return DEFAULT_HOUSE_RULES;
  const bag = raw as Record<string, unknown>;
  const stack = flag(bag, 'stack');
  return {
    stack,
    crossStack: stack && flag(bag, 'crossStack'),
    playToLast: flag(bag, 'playToLast'),
  };
}
