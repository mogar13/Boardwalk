import { useGameContext } from '@/system/economy/gameContext';
import { NO_OPTIONS, type GameOptionsSpec, type OptionValues } from '@/system/options/options';

/**
 * `useGameOptions()` — a game reading how it was asked to be played.
 *
 * A hook, not a prop, for the reason every other capability here is a hook: a game receives
 * `{ onExit }` and nothing else (CLAUDE.md), so options arrive the way the manifest, the bankroll
 * and the room do — through a context the shell set, pulled by the one thing that uses it.
 *
 * `values` is COMPLETE and VALID (see `resolveOptionValues`): every declared option has one of its
 * declared choices, so a game reads `values.draw` without asking whether it is a value it knows.
 * What that string MEANS stays with the game — Solitaire's `solitaireDrawCount` turns `'3'` into
 * the `3` its pure reducer takes — which is what keeps the interpretation next to the rules and
 * out of the OS.
 *
 * `setOption` exists so the OS's own `<GameOptions>` control can write; a game normally only
 * reads. A game is free to call it (a "switch to Draw 3" button in its own chrome would), but a
 * game writing an option it also reads is a loop it owns and should think about — see
 * `SolitaireGame`, where an option CHANGE means a fresh deal, not a mid-game mutation. That is v1's
 * one piece of hard-won subtlety here: Chess queued a difficulty change to the next game rather
 * than mutating a game in flight.
 */
export interface GameOptionsApi {
  /** What this game declared. Empty for a game with nothing to configure. */
  readonly spec: GameOptionsSpec;
  /** The chosen values, keyed by option id — always complete, always a declared choice. */
  readonly values: OptionValues;
  /** Choose a value. An unknown id or an unoffered value changes nothing. */
  readonly setOption: (id: string, value: string) => void;
}

export function useGameOptions(): GameOptionsApi {
  const { manifest, optionValues, setOption } = useGameContext();
  return { spec: manifest.options ?? NO_OPTIONS, values: optionValues, setOption };
}
