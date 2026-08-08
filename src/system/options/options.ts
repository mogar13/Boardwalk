/**
 * Pre-game options — what a game DECLARES it can be played differently about, as data.
 *
 * WHAT THIS REPLACES. v1 had two option surfaces, `SystemUI.init({ hudDropdowns })` and
 * `SystemMatch.setup({ settingsConfig })`, both taking `{ id, label, type, default, options }`
 * arrays — the declarative idea was right, and it is the half of `system_ui.js` worth keeping
 * (plans/V1_FEATURE_GAPS.md #2). What is NOT kept is the god-object that rendered them: options
 * here are manifest data the shell renders, never a `system` prop a game is handed.
 *
 * WHY IT EXISTS NOW. Solitaire had already hand-rolled a draw-1/draw-3 picker into its own header
 * — two `<Button>`s and a `useState` living in the game — which is exactly the shape v1 repeated
 * across ~20 games until nobody could change how an option looked. This module is the seam that
 * one caller earns: the declaration is typed data, the values are resolved by a pure function, and
 * the control is one component (`GameOptions.tsx`).
 *
 * WHAT IS DELIBERATELY ABSENT.
 *
 * - **Only `type: 'select'`.** v1 also had a colour swatch (Monopoly's token picker). No game here
 *   wants one, and a control type with no caller is `loadout.color` reborn — the union has one
 *   member so that adding the second is a decision with a caller attached.
 * - **No persistence.** Values live for the mounted game. A namespaced per-game `localStorage`
 *   (v1's `blackjack_diff`, `chess_mode`) is V1_FEATURE_GAPS #10 and lands when someone misses it.
 * - **No difficulty type**, and this is now PROVEN rather than predicted. AI tiers (#1) are *an
 *   option*, not a second mechanism: UNO became the second AI game on 2026-07-21, and both it and
 *   Tic-Tac-Toe declare their difficulty as ordinary `select` choices here, with the meaning of a
 *   level living in that game's pure `logic/` (`chooseAiMove(state, seat, level, rng)`). Not one
 *   line of this module changed for it. The two games' vocabularies differ on purpose — see their
 *   manifests — which is exactly why no tier enum lives here.
 * - **No numbers, booleans or free text.** Every value is a `string` on purpose: it is what a
 *   control round-trips, and the *meaning* of `'3'` is the game's to read (Solitaire's
 *   `solitaireDrawCount`), which keeps the interpretation next to the reducer it feeds and pure.
 *
 * Nothing in this file touches React, storage or the DOM, so it is unit-testable end to end
 * (`tests/game-options.test.ts`).
 */

/** One selectable value of an option: what is stored, and what the control reads. */
export interface GameOptionChoice {
  readonly value: string;
  readonly label: string;
  /**
   * ONE LINE SAYING WHAT PICKING THIS DOES, shown under the row while it is the chosen value.
   *
   * A tier's label is a WORD — `Casual`, `Sharp`, `Perfect` — and a word says which rung it is and
   * never what the opponent will actually do. v1 had exactly this problem and never solved it: 22
   * games with a difficulty selector, three different vocabularies between them, and not one
   * sentence anywhere explaining what any rung meant. The answer lived in the engine.
   *
   * PER CHOICE RATHER THAN PER OPTION, because the useful sentence is about the value you are
   * looking at, and a static paragraph listing all three is something nobody reads twice. It is
   * OPTIONAL: Solitaire's "Draw 1 / Draw 3" explains itself and a padded line under it is
   * furniture. `tests/game-options.test.ts` asserts an option is all-or-nothing about them, since a
   * hint that appears for two rungs and vanishes for the third reads as a rendering bug.
   */
  readonly hint?: string;
}

/**
 * One declared option. `id` is the key its value is stored under (unique within a game, asserted
 * in `tests/game-options.test.ts` over every registered manifest), `default` must be one of
 * `choices` — a default outside the set would render a control with nothing selected and is
 * likewise a failing test rather than a runtime surprise.
 */
export interface GameOption {
  readonly id: string;
  /** The label over the control. */
  readonly label: string;
  /** One member today. See the file header for why the second arrives with its caller. */
  readonly type: 'select';
  readonly default: string;
  readonly choices: readonly GameOptionChoice[];
  /**
   * WHAT THIS OPTION IS FIXED AT WHEN THE TABLE IS PLAYING FOR MONEY, and one line saying why.
   *
   * Absent on every option but one, and the one is UNO's bot tier at a house-banked table: the
   * odds were priced against `sharp`, so leaving `casual` selectable at a `sharp` price is not an
   * exploit to be discovered later, it is the feature paying out on demand. `value` must be one of
   * `choices` (asserted in `tests/game-options.test.ts`, the same guard `default` has, and for the
   * same failure — a pin outside the set renders a control with nothing selected).
   *
   * It is DATA rather than a rule the OS knows, exactly like `manifest.houseRules`: the game says
   * what it pins and why, the shell draws a locked control and prints the sentence, and neither
   * one learns what the other means. The `why` rides here rather than in the lobby because the
   * lobby must not acquire an opinion about a value called `sharp`.
   *
   * IT IS NOT THE ENFORCEMENT. The referee pins the tier inside the transaction that takes the
   * ante; this is what stops the UI showing a choice the table is not honouring, which is the same
   * split as `canPlay` being a feel check over rules the dealer enforces.
   */
  readonly pinnedForMoney?: {
    readonly value: string;
    readonly why: string;
  };
}

/** What a manifest declares. Absent on a game with nothing to configure — most of them. */
export type GameOptionsSpec = readonly GameOption[];

/** The chosen values, keyed by option id. Always complete: every declared option has a value. */
export type OptionValues = Readonly<Record<string, string>>;

/** The shared empty spec, so `manifest.options ?? NO_OPTIONS` is referentially stable. */
export const NO_OPTIONS: GameOptionsSpec = [];

/** True when `value` is one of the option's declared choices. */
function isChoice(option: GameOption, value: unknown): value is string {
  return typeof value === 'string' && option.choices.some((choice) => choice.value === value);
}

/** The opening values: every option at its declared default. */
export function defaultOptionValues(spec: GameOptionsSpec): OptionValues {
  return Object.fromEntries(spec.map((option) => [option.id, option.default]));
}

/**
 * Coerce arbitrary stored/incoming values against the spec. The result is COMPLETE and VALID by
 * construction: an unknown id is dropped, a value the option does not offer falls back to the
 * default, and a missing one takes the default. This is the function that makes it safe to feed
 * these values straight into a pure reducer — a game reading an option never has to ask whether it
 * is one of the values it knows about.
 */
export function resolveOptionValues(
  spec: GameOptionsSpec,
  raw: Readonly<Record<string, unknown>> | undefined
): OptionValues {
  return Object.fromEntries(
    spec.map((option) => {
      const incoming: unknown = raw?.[option.id];
      return [option.id, isChoice(option, incoming) ? incoming : option.default];
    })
  );
}

/**
 * Set one option, returning the new values. A write of an unknown id or a value the option does
 * not offer is a NO-OP returning the same object — the control can only spell legal values, so a
 * refusal here means something else called it, and the safe answer to that is "nothing happened"
 * rather than a game reducer receiving a value it has no branch for.
 */
export function setOptionValue(
  spec: GameOptionsSpec,
  values: OptionValues,
  id: string,
  value: string
): OptionValues {
  const option = spec.find((candidate) => candidate.id === id);
  if (option === undefined || !isChoice(option, value)) return values;
  if (values[id] === value) return values;
  return { ...values, [id]: value };
}

/**
 * The values as the table will actually be played, with every `pinnedForMoney` option forced when
 * money is on the table.
 *
 * ONE FUNCTION SO THE CONTROL AND THE GAME CANNOT DISAGREE. `<GameOptions>` renders what this
 * returns and the game sends what this returns, so the tier a player is shown facing is the tier
 * the client asks for. A second implementation on either side is a lobby that says `sharp` while
 * the deal says `casual` — which nothing would surface, because the referee pins it anyway and the
 * game would play correctly while the screen lied.
 *
 * Unpinned (or nothing declared) returns the SAME OBJECT by identity, `setOptionValue`'s rule for
 * its reason: it is read in render, and a fresh object every pass is a re-render on every keystroke
 * anywhere in the lobby.
 */
export function pinnedOptionValues(
  spec: GameOptionsSpec,
  values: OptionValues,
  forMoney: boolean
): OptionValues {
  if (!forMoney) return values;
  return spec.reduce(
    (acc, option) =>
      option.pinnedForMoney === undefined
        ? acc
        : setOptionValue(spec, acc, option.id, option.pinnedForMoney.value),
    values
  );
}
