import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card } from '@/ui';
import { findGame } from '@/games/registry';

/**
 * `/play/:gameId`. Resolves the id through the registry and mounts the game — except no
 * games are registered yet (Phase 6), so today every id resolves to nothing and this is the
 * "no such game" state. That is not a stub: it is the real not-found path, which a bad or
 * stale link will hit even after games exist, so it is worth having right now.
 *
 * When Phase 6 fills the registry, this is where a game's component mounts, receiving
 * `{ onExit }` and NOTHING else — every other capability is a hook. `onExit` is wired here
 * (back to the hub) so the contract exists before the first game does: a game never learns
 * how it was reached, only how to leave.
 */
export function Play() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const game = findGame(gameId);

  const onExit = () => {
    void navigate('/');
  };

  // Phase 6: `if (game) return <Suspense><Lazy onExit={onExit} /></Suspense>`. The loader
  // is not built yet — see registry.ts on why a lazy import with no component to load would
  // be an abstraction ahead of its caller.
  const title = game ? game.name : 'No such game';
  const body = game
    ? 'This game is registered but not built yet — its component lands in Phase 6.'
    : gameId === undefined
      ? 'No game was named in the link.'
      : `Nothing is registered under “${gameId}”. The five games arrive in Phase 6 — until then the boardwalk is all signs and no tables.`;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col items-start gap-4 p-8">
        <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.06em] uppercase">
          {title}
        </h1>
        <p className="text-bw-muted max-w-xl text-sm">{body}</p>
        <Button variant="primary" onClick={onExit}>
          Back to the hub
        </Button>
      </Card>
    </div>
  );
}
