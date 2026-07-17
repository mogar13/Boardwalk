/**
 * The registry — what `games.json` was in v1, made typed, and the place `gameId` is
 * defined ONCE so it cannot drift.
 *
 * WHY THIS FILE EXISTS AND WHAT IT REPLACES. v1 kept a `games.json` of ids and a separate
 * set of per-game constants, and the two drifted: `texas_holdem` recorded its stats as
 * `"poker"`, `domino` as `"dominoes"`, `c4` as `"connect4"` — five of thirty-one games'
 * stats silently never reached the hub because the id the game reported was not the id the
 * catalogue knew. The fix is not "be careful": it is that a game's id is `manifest.id` and
 * `manifest.id` is the registry key, so "the id in the catalogue" and "the id the game
 * reports" are the same string by construction. There is nowhere for a second spelling to
 * live.
 *
 * WHY THE REGISTRY IS EMPTY. There are no games yet — Phase 6 builds the five, one
 * independent unit each. This phase ships the SHELL that will host them: the router, the
 * top bar, the auth gate, the hub, and this typed structure they slot into. An empty
 * registry is the honest state, and it is deliberately not pre-filled with five "coming
 * soon" entries, because that is exactly the game checklist ARCHITECTURE.md and CLAUDE.md
 * both forbid — a rendered list of five promises is a checklist whether it is called one or
 * not. A game appears here in the same commit that builds it, and not before.
 *
 * WHAT IS DELIBERATELY NOT HERE: any component-loading machinery. ARCHITECTURE.md describes
 * `React.lazy` + `<Suspense>` per game, and that is right — but a lazy loader with no
 * component to load is the `validateAndCommit()` mistake in miniature, an abstraction built
 * before its caller. How a manifest attaches to its component gets decided by the first
 * game needing it in Phase 6, which is the only design input that has ever worked here. So
 * the registry is manifests today; the play route reads them and, finding none, says so.
 */

/**
 * A pier is an area of the boardwalk — the hub's information architecture, decided by
 * design rather than per game. This is the v2 answer to v1's `category` field, where 30 of
 * 31 games were tagged `"board"` (including Slots and 8-Ball Pool) and the hub rendered one
 * undifferentiated bucket. The failure there was a freeform per-game string that everyone
 * filled in the same way; the fix is a small, fixed, typed set that a game is ASSIGNED to,
 * not one it invents.
 *
 * The set is intentionally short. Three lit areas of one boardwalk, and a game names which
 * one it stands on in its manifest. The taxonomy firms up as the five games land — if it
 * turns out every game wants the same pier, that is the `category` bug returning and the
 * signal to collapse this, exactly as ARCHITECTURE.md says to extract only what repeats.
 */
export type Pier = 'casino' | 'tables' | 'arcade';

export interface PierInfo {
  readonly id: Pier;
  /** The sign over the pier. */
  readonly name: string;
  /** One line under the sign — what kind of game stands here. */
  readonly tagline: string;
}

/**
 * Ordered, because the hub renders them in this order and the order is a design choice: the
 * casino is the front of the boardwalk, under the biggest sign. An array (not a `Record`)
 * so iteration order is the source of truth rather than an accident of key insertion.
 */
export const PIERS: readonly PierInfo[] = [
  {
    id: 'casino',
    name: 'The Casino',
    tagline: 'Where the money moves. Bet your bankroll, win or lose it at the table.',
  },
  {
    id: 'tables',
    name: 'The Tables',
    tagline: 'Skill, no stakes. Take a seat across from a friend or the house.',
  },
  {
    id: 'arcade',
    name: 'The Arcade',
    tagline: 'Quick hits. One player, one screen, one more round.',
  },
];

/**
 * What a game DECLARES. Chrome, seats and betting are data, not code the game writes — the
 * shell reads this to lay out the hub card, the lobby and (from Phase 4) the bet rack, the
 * way v1's `SystemUI.init({gameName, rules, hudDropdowns})` let a game declare its chrome
 * instead of building it. The difference is this is typed and derives every downstream key
 * from `id`.
 *
 * Authored `as const satisfies GameManifest` in each game's `manifest.ts` (Phase 6), so the
 * literal `id` narrows to a string the registry can key on while the shape stays checked.
 */
export interface GameManifest {
  /**
   * THE ONLY gameId. Stats, rooms, achievements and the `/play/:gameId` route all derive
   * from this one string — never a literal spelled a second time somewhere else. This is
   * the single field the whole "no id drift" guarantee rests on.
   */
  readonly id: string;

  /** Shown on the hub card and over the table. */
  readonly name: string;

  /** One line on the hub card — what the game is, in a breath. */
  readonly blurb: string;

  /** Which pier it stands on. Assigned, from the fixed set above. */
  readonly pier: Pier;

  /**
   * Table size. `min`/`max` humans; `min` of 1 means it can be played solo (against AI, or
   * genuinely alone like solitaire). The seat array is the universal multiplayer primitive
   * — v1's best idea — and this is where a game says how long that array is.
   */
  readonly seats: { readonly min: number; readonly max: number };

  /**
   * Which ways the game can be played. Note these are NOT branched on inside a game — v1's
   * `"local"`-vs-`"hotseat"` split across 14 games (7 spelled it each way) is the bug this
   * project deletes with `localSeatIds` in Phase 5. This field is the LOBBY's menu of what
   * to offer, not a mode string a game reads.
   */
  readonly modes: readonly ('ai' | 'hotseat' | 'online')[];

  /**
   * Present only for games where money is on the table. Absent means the game does not
   * touch the bankroll at all (chess, solitaire) — and absence is the signal, not a
   * `betting: false`, because "this game has no economy" and "this game's minimum bet is
   * zero" are different facts and only one of them is true here.
   */
  readonly betting?: { readonly min: number; readonly max: number };
}

/**
 * A registered game: its manifest, and (from Phase 6) whatever the shell needs to mount it.
 * Today that is just the manifest — see the header on why the component loader is not here
 * yet. Kept as a named alias so Phase 6 widens it in one place.
 */
export type RegisteredGame = GameManifest;

/**
 * The catalogue. Empty until Phase 6 — see the header. When a game is built, its manifest
 * is added here in the same commit, and `as const` on each manifest keeps `id` a literal.
 */
export const registry: readonly RegisteredGame[] = [];

/**
 * Resolve a `/play/:gameId` param to a game, or `undefined` if no such id is registered.
 * The route renders "no such game" for `undefined` rather than throwing — an unknown id is
 * a bad link, which is a page state, not a crash.
 */
export function findGame(id: string | undefined): RegisteredGame | undefined {
  if (id === undefined) return undefined;
  return registry.find((game) => game.id === id);
}

/** The games standing on a given pier, in registry order. Empty piers render an empty state. */
export function gamesOnPier(pier: Pier): readonly RegisteredGame[] {
  return registry.filter((game) => game.pier === pier);
}
