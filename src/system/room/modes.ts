import type { GameManifest } from '@/games/registry';
import type { SeatFill } from '@/system/room/seats';

/**
 * WHAT A WAY IN IS CALLED — the one place the words are written.
 *
 * The lobby used to render its mode buttons as the raw union member, so the screen literally said
 * "ai" and "online" (plans/done/GAME_LAUNCH_MODAL.md §2). That was invisible for as long as the only way
 * to a table was a page nobody looked at twice; the launch modal puts the same row at eye level on
 * the entrance screen, where a lowercase enum member reads as a bug.
 *
 * The map is EXHAUSTIVE by type (`Record<GameMode, string>`), so a fifth mode is a compile error
 * here rather than a button rendering an empty string — which is what a missing entry would draw,
 * silently, on the one control that decides how a game is played. `tests/launch-modal.test.ts`
 * asserts the labels are non-empty and distinct, because two buttons reading the same word is a
 * picker that cannot be used and no type can see it.
 *
 * BOTH the modal and the lobby read this. That is the whole reason it is a module rather than two
 * inline ternaries: the copy on the entrance and the copy at the table are the same copy.
 */

/** Every way a game can be played — the manifest's own union, named once. */
export type GameMode = GameManifest['modes'][number];

/**
 * The three modes that mean a ROOM. `solo` is the room-less one (Blackjack, Solitaire): no seats,
 * no subscription, no lobby — so it is not a mode `RoomIdentity` can carry, and the lobby filters
 * it out rather than offering a button it could not honour.
 */
export type RoomMode = Exclude<GameMode, 'solo'>;

export const MODE_LABEL: Record<GameMode, string> = {
  // v1's own words on the first two ("🎮 Solo / AI", "👥 Play Online"), because they were right and
  // because half the point of the modal is that it is v1's entrance rebuilt.
  solo: 'Play',
  ai: 'Solo / AI',
  hotseat: 'Same screen',
  online: 'Play Online',
};

/**
 * One line under each way in — what picking it actually does. Absent on `solo`, deliberately: a
 * game with one way in is not offering a choice, and a sentence explaining the only button on the
 * screen is furniture.
 */
export const MODE_HINT: Partial<Record<GameMode, string>> = {
  ai: 'Your table, filled with bots. Start as soon as it opens.',
  hotseat: 'Two players, one screen — pass it back and forth.',
  online: 'Open a table for other people, or join one by code.',
};

/**
 * The room modes a manifest offers, in declaration order. One call site's `filter` lifted out of
 * the lobby so the modal and the lobby agree about which buttons are room buttons — and so the
 * narrowing to `RoomMode` is written once instead of as a type predicate at each caller.
 */
export function roomModesOf(modes: readonly GameMode[]): RoomMode[] {
  return modes.filter((m): m is RoomMode => m !== 'solo');
}

/**
 * WHAT A WAY IN MEANS FOR THE EMPTY CHAIRS — the one place a mode becomes a fill.
 *
 * It lives HERE and not in `seats.ts` because that file's header is a promise ("below this line
 * there is no mode, only seats") and this is the mode vocabulary's own module — the same reason
 * `MODE_LABEL` is here rather than in the components that draw it.
 *
 * It became a function the moment a second reader appeared. `TableSetup` maps mode to fill to build
 * the table, and the guard on the entrance's auto-start has to ask the same question of the real
 * registry; a test that re-spelled the ternary would be comparing a copy of the rule to the rule,
 * which is the vacuous guard CLAUDE.md's Enforcement note keeps warning about. One function means
 * the sweep is asking the shipped mapping what it does.
 *
 * ONLINE STAYS OPEN, and that is a decision rather than an omission
 * (plans/done/GAME_LAUNCH_MODAL.md §5.3): a public table that comes up full starts before anyone
 * can walk up to it, which is the wrong default for the one mode whose entire point is other
 * people. It is also exactly what makes online the one mode that still shows a Start button —
 * a table with open chairs is a table waiting for somebody, and that wait is the feature.
 */
export function fillForMode(mode: RoomMode): SeatFill {
  if (mode === 'ai') return 'ai';
  if (mode === 'hotseat') return 'local';
  return 'none';
}

/**
 * A TABLE YOU OPEN FOR OTHER PEOPLE HAS A CHAIR FOR ONE — the seat range a given way in may
 * actually pick from, which is the manifest's range everywhere except online, where it floors at
 * two.
 *
 * It lives HERE for `fillForMode`'s reason and not in `seats.ts`, whose header promises that below
 * it there is no mode, only seats. And it is one function read by BOTH the picker and the default,
 * because two spellings of a floor is how a picker offers a size the default does not use.
 *
 * WHAT IT CLOSES. Blackjack declares `seats { min: 1, max: 4 }` — legitimately, since the dealer is
 * an opponent who takes no chair — and that number is a property of the GAME, true at every table
 * it deals. Online is where it stops being sensible: a one-chair table has no chair for anybody
 * else, so it comes up full, `seatsAreReady` is true, and the entrance's auto-start deals it on the
 * spot. Pressing "Play Online" would hand you a solo hand, with no lobby, no joinable seat and no
 * listing (the room browser excludes tables with no claimable chair, correctly). Nothing errors and
 * nothing is charged wrongly; it is simply not what the button says, which is the failure this repo
 * keeps meeting and keeps naming.
 *
 * The floor is TWO rather than "min + 1": the rule is that somebody can join, and one free chair is
 * what that takes. A game whose range cannot reach two is left alone rather than pushed past its
 * own maximum — `tableSizeChoices` then collapses to nothing and the picker disappears, which is
 * the existing behaviour for a range holding one size.
 */
export function seatRangeFor(
  range: { readonly min: number; readonly max: number },
  mode: RoomMode
): { readonly min: number; readonly max: number } {
  if (mode !== 'online' || range.min >= 2) return range;
  return { min: Math.min(2, range.max), max: range.max };
}
