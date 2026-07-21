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
