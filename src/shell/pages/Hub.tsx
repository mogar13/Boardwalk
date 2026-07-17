import { Link } from 'react-router-dom';
import { Card } from '@/ui';
import { PIERS, gamesOnPier } from '@/games/registry';
import type { RegisteredGame } from '@/games/registry';
import { DailyRewardCard } from '@/system/rewards/DailyRewardCard';

/**
 * The hub — the boardwalk seen from the entrance. It renders the piers in order, and each
 * pier renders the games standing on it.
 *
 * Right now every pier is empty, because the registry is empty: the five games are Phase 6,
 * one independent unit each, and this phase ships the structure they arrive into rather
 * than five "coming soon" cards — which would be the game checklist ARCHITECTURE.md forbids
 * in its most important line. So a pier with no games shows an honest "opening soon", and
 * the day a game's manifest lands in the registry it appears here with no change to this
 * file. That is the test of the structure: the hub reads the registry, it does not hardcode
 * a catalogue.
 */

function GameCard({ game }: { game: RegisteredGame }) {
  // A link to `/play/:id`, keyed off `manifest.id` — the same string the route resolves back
  // through `findGame`. The hub never hardcodes a game; it reads the registry, so a new game
  // appears here the moment its manifest lands, with no change to this file.
  const { id, name, blurb } = game.manifest;
  return (
    <Link to={`/play/${id}`} className="block">
      <Card interactive className="flex h-full flex-col gap-2 p-5">
        <h3 className="font-display text-base-content text-base font-semibold tracking-[0.1em] uppercase">
          {name}
        </h3>
        <p className="text-bw-muted text-sm">{blurb}</p>
      </Card>
    </Link>
  );
}

function EmptyPier() {
  return (
    <Card className="border-bw-line/60 flex items-center justify-center border-dashed p-8">
      <p className="text-bw-muted text-sm">Opening soon — the first games arrive in Phase 6.</p>
    </Card>
  );
}

export function Hub() {
  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-base-content text-3xl font-bold tracking-[0.08em] uppercase">
          The Boardwalk
        </h1>
        <p className="text-bw-muted max-w-2xl text-sm">
          Pick a pier. The Casino takes your bankroll; the Tables and the Arcade are just for the
          game.
        </p>
      </header>

      <DailyRewardCard />

      {PIERS.map((pier) => {
        const games = gamesOnPier(pier.id);
        return (
          <section key={pier.id} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-base-content text-sm font-semibold tracking-[0.2em] uppercase">
                {pier.name}
              </h2>
              <p className="text-bw-muted max-w-2xl text-sm">{pier.tagline}</p>
            </div>

            {games.length === 0 ? (
              <EmptyPier />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {games.map((game) => (
                  <GameCard key={game.manifest.id} game={game} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
