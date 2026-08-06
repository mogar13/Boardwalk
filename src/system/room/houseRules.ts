/**
 * HOUSE RULES AT THE OS LAYER — how a table can agree to play differently, as room state.
 *
 * The sibling of `ante.ts`, and it exists for the same reason: a pre-game decision that every seat
 * at the table is bound by is OS work. A game DECLARES which rules it has (`manifest.houseRules`),
 * the lobby draws a toggle each, and the value is stamped onto the room at create — exactly where
 * `anteCents` rides, for exactly its reasons. A guest has to be able to read the rules BEFORE
 * taking a chair, and `state` is `null` until the host deals.
 *
 * WHY THE OS CARRIES AN OPAQUE BAG OF BOOLEANS. `TableRules` is `Record<string, boolean>` and not
 * any game's rules type, so `src/system/room` never imports a rulebook. That is not squeamishness
 * about a dependency: a house rule MEANS something only inside one game, and the moment the OS
 * spells `stack` it has an opinion about UNO that a second game with house rules would have to work
 * around. The OS moves the bag; the GAME narrows it, through its own pure resolver
 * (`resolveHouseRules` for UNO), which is the thing that turns an untrusted `Record` into a value
 * a reducer can read without branching. The split is the same one `patchState` makes with
 * `TPublic`: the OS transports what it must not interpret.
 *
 * IT IS NOT `manifest.options`. Those values live in `<GameShell>` and are per-CLIENT, which is
 * fine for a difficulty the host alone reads and wrong for a rule the referee enforces and every
 * client's `canPlay` has to agree with. See `plans/UNO_HOUSE_RULES.md` §1.
 */

/**
 * WHAT A TABLE TURNED ON, keyed by rule id. Wire-safe by construction: booleans only, no nesting,
 * dense — a rule that is off is `false` or simply absent, and both read the same way through a
 * game's resolver, so there is no null for RTDB to drop and no sentinel to invent.
 *
 * Untrusted on arrival, always. It reaches a client off a room snapshot the server built from a
 * `create` frame a browser sent, which is why every consumer goes through a resolver rather than
 * reading a key directly.
 */
export type TableRules = Readonly<Record<string, boolean>>;

/**
 * A table that agreed to nothing — the default, and the shape every non-declaring game's room
 * carries. Frozen for `ANTE_RUNGS_CENTS`'s reason: a shared default that can be written to is a
 * default that acquires a rule nobody chose.
 */
export const NO_TABLE_RULES: TableRules = Object.freeze({});

/**
 * ONE TOGGLE A GAME OFFERS — manifest DATA, so the OS draws the control and the game never does.
 * The `manifest.betting` precedent: a game declares what it plays for, the OS owns the picker.
 *
 * There is no `type` field and no default. Every house rule is a boolean and every one of them is
 * OFF unless a table says otherwise — an on-by-default house rule would be a game silently retuned
 * under everybody who does not read the lobby, which is the rule `plans/UNO_HOUSE_RULES.md` §3
 * states about `playToLast` and which holds for all of them.
 */
export interface HouseRuleSpec {
  /** Matches a key the game's own resolver reads. Guarded as a bijection — see the tests. */
  readonly id: string;
  /** The toggle's label. */
  readonly label: string;
  /** One line under it — what the rule actually does at the table. */
  readonly hint?: string;
  /**
   * Another rule's id this one is meaningless without ("+4 onto a +2" needs stacking at all). The
   * lobby refuses to offer it until its prerequisite is on, and the GAME's resolver normalises it
   * away if it arrives set anyway — belt and braces on purpose, because these are two different
   * jobs: this one shapes a control, that one shapes the value a reducer reads. A test asserts the
   * two agree, since a `requires` here with no matching normalisation there would ship a toggle
   * that looks respected and is not.
   */
  readonly requires?: string;
}

/**
 * The toggles to draw. `[]` for a game that declares none, which the lobby reads as "draw nothing"
 * — the `tableSizeChoices`/`anteChoices` convention, where a control that cannot change the
 * outcome is worse than no control.
 *
 * A spec whose `requires` names an id the game does not declare is DROPPED rather than rendered
 * permanently dead: a checkbox that can never be reached is the same defect as one that changes
 * nothing, and a typo in a prerequisite is exactly how you get one.
 */
export function houseRuleChoices(specs?: readonly HouseRuleSpec[]): readonly HouseRuleSpec[] {
  if (specs === undefined || specs.length === 0) return [];
  const ids = new Set(specs.map((s) => s.id));
  return specs.filter((s) => s.requires === undefined || ids.has(s.requires));
}

/** Is this rule on? Absent reads as off, which is what every default is. */
export function isRuleOn(values: TableRules, id: string): boolean {
  return values[id] === true;
}

/**
 * May this toggle be operated? Only once anything it requires is on. A dependent whose
 * prerequisite is off is drawn disabled rather than hidden, so the relationship is visible —
 * "cross-stacking" appearing out of nowhere the moment you tick "stacking" reads as a bug.
 */
export function isRuleAvailable(values: TableRules, spec: HouseRuleSpec): boolean {
  return spec.requires === undefined || isRuleOn(values, spec.requires);
}

/**
 * Turn a rule on or off, and keep the set coherent.
 *
 * TURNING A PREREQUISITE OFF TURNS OFF WHAT DEPENDS ON IT, transitively. Otherwise un-ticking
 * "stacking" leaves `crossStack: true` sitting in the bag — invisible in the lobby, carried to the
 * server, and normalised away by the game's resolver only if it remembers to. The value the host
 * sends should be the value the host can see.
 *
 * Returns the SAME object when nothing changed, so a no-op click does not re-render — the identity
 * discipline `setOptionValue` holds to.
 */
export function setTableRule(
  values: TableRules,
  specs: readonly HouseRuleSpec[],
  id: string,
  on: boolean
): TableRules {
  const spec = specs.find((s) => s.id === id);
  if (spec === undefined) return values;
  if (on && !isRuleAvailable(values, spec)) return values;
  if (isRuleOn(values, id) === on) return values;

  const next: Record<string, boolean> = { ...values, [id]: on };
  if (!on) {
    // Cascade: drop anything that required this, then anything that required THOSE.
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of specs) {
        if (s.requires !== undefined && next[s.id] === true && next[s.requires] !== true) {
          next[s.id] = false;
          changed = true;
        }
      }
    }
  }
  return next;
}

/**
 * What actually goes on the wire: the ids that are ON, and nothing else.
 *
 * Sending `{stack: false}` and sending `{}` mean the same thing to every resolver, and the shorter
 * one keeps a room record (and the public listing that quotes it) from carrying a key for every
 * rule every game has ever declared. Undeclared ids are dropped here too, so a hand-edited client
 * cannot smuggle a key into a room record — the server bounds it again on arrival, because that is
 * the boundary that is not optional.
 */
export function tableRulesFor(values: TableRules, specs: readonly HouseRuleSpec[]): TableRules {
  const out: Record<string, boolean> = {};
  for (const spec of specs) if (values[spec.id] === true) out[spec.id] = true;
  return out;
}
