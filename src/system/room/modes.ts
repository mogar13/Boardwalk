import type { GameManifest } from '@/games/registry';

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
