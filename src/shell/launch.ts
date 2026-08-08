import type { GameManifest } from '@/games/registry';
import { MODE_LABEL, type GameMode, type RoomMode } from '@/system/room/modes';
import { writeOptionValues } from '@/system/options/optionParams';
import type { OptionValues } from '@/system/options/options';

/**
 * THE LAUNCH MODAL, as pure functions — everything the entrance decides, decided where a test can
 * reach it (plans/done/GAME_LAUNCH_MODAL.md §1, §9).
 *
 * The component renders what these return and holds no second opinion, the same split
 * `plannedSeats`/`<SeatPreview>` and `opponentSlots`/UNO's board already use. What is left in
 * `GameLaunchModal.tsx` is the drawing.
 */

/** One way into a game: the mode, and the words on its button. */
export interface LaunchMode {
  readonly mode: GameMode;
  readonly label: string;
}

/**
 * The ways in, in the order the manifest declares them.
 *
 * EVERY GAME GETS THE MODAL, Blackjack included (decision 3) — v1 did the same, opening its launch
 * panel from every card and merely varying which buttons it held. The modal is the ENTRANCE to a
 * game, not a picker, so a game with one way in shows one way in, and the day Blackjack declares a
 * seat count and a dealer-stand tier they are drawn here with no change to this file.
 */
export function launchModes(manifest: GameManifest): LaunchMode[] {
  return manifest.modes.map((mode) => ({ mode, label: MODE_LABEL[mode] }));
}

/**
 * What picking a mode has to ASK before the game can start.
 *
 * - `'table'` — a room: seats, stake, house rules, who may join, and Create. Every room mode, always.
 * - `'options'` — no room, but the game declares something to choose (Solitaire's draw count).
 * - `'none'` — nothing to ask. The modal navigates on the click rather than showing an empty panel
 *   with a Play button under it, which is what Blackjack's setup step would otherwise be today.
 */
export type LaunchStep = 'table' | 'options' | 'none';

export function launchStepFor(manifest: GameManifest, mode: GameMode): LaunchStep {
  if (isRoomMode(mode)) return 'table';
  return (manifest.options?.length ?? 0) > 0 ? 'options' : 'none';
}

/**
 * Whether this way in means a ROOM. A type predicate rather than a `!==` at each site, so the modal
 * narrows to `RoomMode` where it hands the mode to `<TableSetup>` instead of casting — and so "a
 * room mode always gets the table step" is one rule with one spelling, read by both.
 */
export function isRoomMode(mode: GameMode): mode is RoomMode {
  return mode !== 'solo';
}

/**
 * WHERE A LAUNCH LANDS — `/play/:id`, carrying the facts that have to survive the navigation.
 *
 * `table` and `mode` are `<Lobby>`'s (it reads both back off the URL, which is the only place
 * either of them lives), and the options ride beside them for the reason `optionParams.ts` gives.
 * A solo game carries no `mode` at all: nothing reads it there, and a query string that names a
 * fact nobody consults is a fact that will eventually be believed.
 */
export function playPath(args: {
  readonly gameId: string;
  readonly mode?: RoomMode;
  readonly table?: string;
  readonly options: OptionValues;
}): string {
  const { gameId, mode, table, options } = args;
  const params = new URLSearchParams();
  if (table !== undefined && table !== '') params.set('table', table);
  if (mode !== undefined) params.set('mode', mode);
  const query = writeOptionValues(params, options).toString();
  return query === '' ? `/play/${gameId}` : `/play/${gameId}?${query}`;
}

/**
 * WHETHER THIS CLICK IS THE MODAL'S, or the browser's.
 *
 * The hub card is an `<a href="/play/:id">` and stays one — it is a real link to a real route, so
 * ctrl/cmd-click, middle-click, "open in new tab" and a copied address all keep working, and the
 * route still works typed. A `<button>` would silently take every one of those away, which is the
 * kind of loss nobody files a bug about; they just stop doing it.
 *
 * So the modal intercepts the PLAIN left click and nothing else. The predicate is here rather than
 * inline in the handler because "which clicks are plain" is exactly the sort of thing that gets one
 * modifier short and is then unfalsifiable by hand — you would have to remember to try alt-click.
 */
export function isPlainClick(e: {
  readonly button?: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): boolean {
  if (e.button !== undefined && e.button !== 0) return false;
  return !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}
