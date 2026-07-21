import { lazy, type ComponentType } from 'react';
import type { GameOptionsSpec } from '@/system/options/options';
import { ticTacToeManifest } from '@/games/tic-tac-toe/manifest';
import { blackjackManifest } from '@/games/blackjack/manifest';
import { chessManifest } from '@/games/chess/manifest';
import { unoManifest } from '@/games/uno/manifest';
import { solitaireManifest } from '@/games/solitaire/manifest';
import { liarsDiceManifest } from '@/games/liars-dice/manifest';

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
 * HOW A MANIFEST ATTACHES TO ITS COMPONENT — the question Phases 0–5 deferred to "the first
 * game needing it", now answered by Tic-Tac-Toe. A `RegisteredGame` is a manifest plus a
 * `Component`: a `React.lazy` wrapper built ONCE here at module load, so each game's code is a
 * SEPARATE chunk pulled only when someone opens it. That is the code-split ARCHITECTURE.md's
 * Phase-3 note wanted (the bundle crossed 500kB with router + firebase in one chunk, and
 * "React.lazy per game in Phase 6 is the answer") — and it is the smallest thing that works: the
 * manifest is imported eagerly (it is tiny, and the hub and the play route both need it before any
 * component loads), the component is imported lazily.
 *
 * WHY `lazy(...)` LIVES HERE AND NOT IN THE PLAY ROUTE. `react-hooks/static-components` forbids
 * calling `lazy` inside a component's render — a lazy wrapper minted per render is a new component
 * type each time, which remounts and resets state (here: tears down the room subscription on every
 * tick). Building it once, at module scope, is the fix the rule points at, and the registry is the
 * one module that already runs exactly once and already names every game.
 */

/**
 * The one prop a game receives. CLAUDE.md's rule, made a type: "a game receives `{ onExit }` and
 * nothing else — everything else is a hook." A `system` prop would rebuild the `window.SystemUI`
 * god-object this project exists to escape, so the surface is deliberately this small: a game
 * learns how to LEAVE and nothing about how it was reached. Its manifest comes from `useGame()`,
 * its room from `useRoom()`, its bankroll from `useBankroll()` — each imported exactly where used.
 */
export interface GameProps {
  readonly onExit: () => void;
}

/** A game's mountable component — the default export of its `*Game.tsx`, taking only `GameProps`. */
export type GameComponent = ComponentType<GameProps>;

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

  /**
   * The hub-card icon: a bare filename under `public/games/` (e.g. `'blackjack.png'`),
   * resolved to a base-path-aware URL by `gameIconSrc`. OPTIONAL on purpose — a game may
   * register before its art is curated in (the same "bring the asset with its reader" rule
   * the audio/card registries hold to), and the hub draws a neutral placeholder until then.
   * `tests/game-icons.test.ts` asserts every icon that IS named resolves to a file on disk,
   * so a typo is a failing test, not a silent broken image — the `cardSrc` rule, for icons.
   */
  readonly icon?: string;

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
   *
   * `'solo'` is the room-LESS mode: a single player against the house or the board, with no
   * lobby, no seats and no subscription (Blackjack, and later Solitaire). A game that offers
   * only `['solo']` never mounts `<Lobby>` — the play route mounts its board straight into
   * `<GameShell>` — so the mode string here is documentation and a hub hint, not something the
   * game reads. It is a real, reusable mode (two callers), not a per-game invention, which is
   * the bar this union holds to.
   */
  readonly modes: readonly ('solo' | 'ai' | 'hotseat' | 'online')[];

  /**
   * Present only for games where money is on the table. Absent means the game does not
   * touch the bankroll at all (chess, solitaire) — and absence is the signal, not a
   * `betting: false`, because "this game has no economy" and "this game's minimum bet is
   * zero" are different facts and only one of them is true here.
   */
  readonly betting?: { readonly min: number; readonly max: number };

  /**
   * How this game can be played DIFFERENTLY — draw-1 vs draw-3, a house rule, later an AI tier.
   * Data, rendered by the OS's `<GameOptions>` and read back by the game through
   * `useGameOptions()`; the shell never learns what a value means and the game never draws a
   * control. Absent on a game with nothing to configure, which is four of the five.
   *
   * This is v1's `settingsConfig` idea kept and its delivery mechanism thrown away — see
   * `src/system/options/options.ts` for what was deliberately not carried over.
   */
  readonly options?: GameOptionsSpec;
}

/**
 * A registered game: its manifest, and the lazy component that mounts it. `Component` is a
 * `React.lazy` wrapper around a dynamic `import()` of the game's `*Game.tsx`, so a game's code
 * lives in its own chunk, fetched only when the play route renders it. The manifest, by contrast,
 * is a static import (see `registry` below): the hub needs every game's name and pier to draw the
 * cards before any component is fetched.
 */
export interface RegisteredGame {
  readonly manifest: GameManifest;
  readonly Component: GameComponent;
}

/**
 * The catalogue. A game is added here in the same commit that builds it — Tic-Tac-Toe is the
 * first, the SDK's smoke test. `as const satisfies GameManifest` on each manifest keeps `id` a
 * literal, so `registry`, the stats key, the room path and the `/play/:gameId` route are the same
 * string by construction — there is nowhere for a second spelling to live.
 */
export const registry: readonly RegisteredGame[] = [
  {
    manifest: ticTacToeManifest,
    Component: lazy(() => import('@/games/tic-tac-toe/TicTacToeGame')),
  },
  {
    manifest: blackjackManifest,
    Component: lazy(() => import('@/games/blackjack/BlackjackGame')),
  },
  {
    manifest: chessManifest,
    Component: lazy(() => import('@/games/chess/ChessGame')),
  },
  {
    manifest: unoManifest,
    Component: lazy(() => import('@/games/uno/UnoGame')),
  },
  {
    manifest: solitaireManifest,
    Component: lazy(() => import('@/games/solitaire/SolitaireGame')),
  },
  {
    manifest: liarsDiceManifest,
    Component: lazy(() => import('@/games/liars-dice/LiarsDiceGame')),
  },
];

/**
 * Resolve a `/play/:gameId` param to a game, or `undefined` if no such id is registered.
 * The route renders "no such game" for `undefined` rather than throwing — an unknown id is
 * a bad link, which is a page state, not a crash.
 */
export function findGame(id: string | undefined): RegisteredGame | undefined {
  if (id === undefined) return undefined;
  return registry.find((game) => game.manifest.id === id);
}

/** The games standing on a given pier, in registry order. Empty piers render an empty state. */
export function gamesOnPier(pier: Pier): readonly RegisteredGame[] {
  return registry.filter((game) => game.manifest.pier === pier);
}

/**
 * A game icon's URL from its bare filename, base-path-aware — `/Boardwalk/games/…` in prod,
 * `/games/…` in dev/test. The same shape as `cardSrc`, and the single place the `public/games/`
 * path is spelled, so the icon set could be re-dropped or moved without hunting call sites.
 * Returns `undefined` when the manifest names no icon, which is the hub's cue to draw its
 * placeholder rather than a broken `<img>`.
 */
export function gameIconSrc(icon: string | undefined): string | undefined {
  return icon === undefined ? undefined : `${import.meta.env.BASE_URL}games/${icon}`;
}
