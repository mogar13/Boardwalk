import { Suspense, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card } from '@/ui';
import { findGame } from '@/games/registry';
import { GameShell } from '@/system/economy/GameShell';

/**
 * `/play/:gameId`. Resolves the id through the registry and mounts the game.
 *
 * This is the seam Phases 4 and 5 built up to and pointedly did not wire: `<GameShell>` has
 * existed since Phase 4 (it provides the economy context a game's `useGame`/`useBet` read), and
 * the registry gained a lazy `load` in Phase 6. Here they meet. The composition is the whole of
 * the answer to "how does a manifest attach to its component":
 *
 *   <GameShell manifest>          ← the economy context: id (stats key), betting bounds
 *     <Suspense>                  ← while the game's chunk is in flight
 *       <Game onExit={…} />       ← the lazy component, receiving ONLY onExit
 *
 * `onExit` is wired here, back to the hub — a game never learns how it was reached, only how to
 * leave (CLAUDE.md: `{ onExit }` and nothing else). Everything else the game needs is a hook it
 * imports itself. A multiplayer game reaches for the shared `<Lobby>` from inside this shell; a
 * solo game (solitaire, later) just renders — the play route does not need to know which, because
 * the only thing it owes every game is the context and the exit.
 *
 * An unknown id is a page state, not a crash: `findGame` returns undefined for a bad or stale
 * link, and this renders "no such game" rather than throwing.
 */
export function Play() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const game = findGame(gameId);

  const onExit = useCallback(() => {
    void navigate('/');
  }, [navigate]);

  if (game === undefined) {
    const body =
      gameId === undefined
        ? 'No game was named in the link.'
        : `Nothing is registered under “${gameId}”. Check the link, or head back to the boardwalk.`;
    return (
      <div className="flex flex-col gap-6">
        <Card className="flex flex-col items-start gap-4 p-8">
          <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.06em] uppercase">
            No such game
          </h1>
          <p className="text-bw-muted max-w-xl text-sm">{body}</p>
          <Button variant="primary" onClick={onExit}>
            Back to the hub
          </Button>
        </Card>
      </div>
    );
  }

  const Game = game.Component;
  return (
    <GameShell manifest={game.manifest}>
      <Suspense
        fallback={
          <Card className="p-8">
            <p className="text-bw-muted text-sm">Dealing you in…</p>
          </Card>
        }
      >
        <Game onExit={onExit} />
      </Suspense>
    </GameShell>
  );
}
