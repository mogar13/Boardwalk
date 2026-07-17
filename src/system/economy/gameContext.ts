import { createContext, useContext } from 'react';
import type { GameManifest } from '@/games/registry';

/**
 * The context `<GameShell>` provides and `useGame`/`useBet` read. This is the ONE thing a game
 * is wrapped in, and it carries the ONE thing those hooks need that is per-game: the manifest —
 * its id (the stats key) and its betting bounds.
 *
 * WHY A CONTEXT AND NOT A PROP. CLAUDE.md's rule is that a game receives `{ onExit }` and
 * nothing else, because a `system` prop rebuilds the `window.SystemUI` god-object this project
 * exists to escape. So the manifest cannot arrive as a prop through the game; it arrives through
 * a context the shell sets, and the hooks pull exactly what they use from it. `useGame().manifest`
 * is a game reading its own declaration, never the shell handing it a toolbox.
 *
 * WHAT IS DELIBERATELY NOT HERE: seats, mode, `localSeatIds`. Those are Phase 5 (multiplayer),
 * and putting an empty `seats: []` here now would be an interface ahead of its caller — the
 * `RoomRepo`-in-Phase-2 mistake. `useSeats` and the multiplayer half of the context land with
 * rooms. Phase 4's context is the economy's, and the economy needs the manifest and no more.
 */
export interface GameContextValue {
  readonly manifest: GameManifest;
}

const GameContext = createContext<GameContextValue | null>(null);

/** The provider — used only by `<GameShell>`. Exported so the component file can render it. */
export const GameContextProvider = GameContext.Provider;

/**
 * The manifest the current game declared, or a loud throw if called outside `<GameShell>`.
 *
 * The throw is the point: a `null` default that hooks silently tolerated would let `useBet` run
 * with no bounds and no id, recording a bet under `""` — which is precisely v1's id-drift class
 * of bug, arriving through a different door. A game is only ever mounted by the play route, which
 * wraps it in `<GameShell>`; reaching this from anywhere else is a wiring mistake, and it should
 * fail at the first render, not on the first bet.
 */
export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (ctx === null) {
    throw new Error(
      'useGame()/useBet() must be called inside <GameShell>. A game is mounted by the play route, ' +
        'which provides the context; a hook reaching this from outside one has no manifest to read.'
    );
  }
  return ctx;
}
