import {
  resolveOptionValues,
  type GameOptionsSpec,
  type OptionValues,
} from '@/system/options/options';

/**
 * AN OPTION VALUE LIVES IN THE URL (plans/GAME_LAUNCH_MODAL.md §4) — the pure half.
 *
 * WHY THE URL AND NOT `useState`. The launch modal draws a game's option controls on the HUB, and
 * the values are read by a game the play route mounts one navigation later. `<GameShell>` is the
 * boundary that holds them and the play route is what mounts it, so a tier picked in a hub modal
 * has nowhere to live across the navigation that follows.
 *
 * This is not a new idea being introduced for the modal. It is the rule `<Lobby>` already states
 * for `?table=` and `?mode=`, for this exact reason and with the war story attached: a fact that
 * must survive a navigation or a reload lives where the reload can read it, and holding it in
 * state as well is two sources of truth for one fact. So `<GameShell>` DERIVES its values from
 * here and writes back here — it holds no copy at all, which is what makes "the refresh keeps it"
 * true by construction rather than by a seed that can drift.
 *
 * It also fixes a live bug on the way past: a mid-lobby refresh silently reset the AI tier to its
 * default while the host believed they had picked one.
 *
 * A QUERY STRING IS USER-EDITABLE TEXT, so nothing here trusts it. Reading goes through
 * `resolveOptionValues`, which is already total — an unknown id is dropped, an unoffered or
 * mistyped value falls back to the option's default — so a hand-edited or stale URL cannot produce
 * a value a game's reducer has no branch for. `tests/game-options.test.ts` asserts the round trip
 * and every way it can be fed garbage.
 */

/**
 * The namespace every option key sits under. Prefixed rather than bare so an option id can never
 * collide with `table`, `mode`, or whatever the shell puts in the query string next — and so
 * clearing "the options" is one predicate rather than a list of ids the writer would have to know.
 */
export const OPTION_PARAM_PREFIX = 'o.';

/** The query-string key one option's value is written under. */
export function optionParamName(id: string): string {
  return `${OPTION_PARAM_PREFIX}${id}`;
}

/**
 * The values a query string is asking for, complete and valid against the spec. Total: absent,
 * unknown, repeated and hostile keys all land on something the game declared it can handle.
 */
export function readOptionValues(spec: GameOptionsSpec, params: URLSearchParams): OptionValues {
  const raw: Record<string, string | null> = {};
  for (const option of spec) raw[option.id] = params.get(optionParamName(option.id));
  return resolveOptionValues(spec, raw);
}

/**
 * `params` with the options replaced by `values` — a NEW object, so a caller cannot mutate the
 * params React Router handed it.
 *
 * EVERY option key is cleared first, not just the ones being written. The alternative leaves the
 * losing game's keys behind when the launch modal moves from one game to another (`?o.bots=casual`
 * hanging around on a Tic-Tac-Toe URL), which is harmless — `resolveOptionValues` drops an id no
 * option owns — and reads as a bug in a link somebody shares. Non-option params (`table`, `mode`)
 * are untouched, which is the property the lobby depends on.
 */
export function writeOptionValues(params: URLSearchParams, values: OptionValues): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of [...next.keys()]) {
    if (key.startsWith(OPTION_PARAM_PREFIX)) next.delete(key);
  }
  for (const [id, value] of Object.entries(values)) next.set(optionParamName(id), value);
  return next;
}
