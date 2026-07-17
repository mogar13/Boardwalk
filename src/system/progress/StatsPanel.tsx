import { Card } from '@/ui';
import { findGame } from '@/games/registry';
import { useProfile } from '@/system/profile/useProfile';
import { totalPlayed, totalWins } from '@/system/progress/stats';

/**
 * The play record — totals across everything, then a per-game breakdown. `wins` here is the same
 * `totalWins` the leaderboard ranks by, so the number a player sees on their own profile is the
 * number the board sorts them on. No second count, no drift.
 *
 * The per-game rows resolve `gameId` through the registry — which is empty until Phase 6, so a
 * loaded stat for a game whose manifest is not registered falls back to its raw id rather than
 * vanishing. A record with no game to name it is still a record.
 */

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-base-300 border-bw-line rounded-box flex flex-col gap-1 border p-4">
      <span className="font-display text-bw-muted text-[0.6rem] font-semibold tracking-[0.2em] uppercase">
        {label}
      </span>
      <span className="font-display text-base-content text-2xl font-bold tabular-nums">
        {value}
      </span>
    </div>
  );
}

export function StatsPanel() {
  const profile = useProfile();
  if (profile === null) return null;

  const played = totalPlayed(profile.stats);
  const wins = totalWins(profile.stats);
  const winRate = played > 0 ? Math.round((wins / played) * 100) : 0;
  const games = Object.entries(profile.stats).filter(([, s]) => s.played > 0);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="font-display text-base-content text-sm font-semibold tracking-[0.2em] uppercase">
        Record
      </h2>

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Played" value={played.toLocaleString('en-US')} />
        <Tile label="Won" value={wins.toLocaleString('en-US')} />
        <Tile label="Win rate" value={`${String(winRate)}%`} />
      </div>

      {games.length === 0 ? (
        <p className="text-bw-muted text-sm">
          No games played yet — the tables open in Phase 6. Your record fills in as you play.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {games.map(([gameId, s]) => (
            <div
              key={gameId}
              className="border-bw-line/60 flex items-center justify-between border-b py-2 text-sm last:border-b-0"
            >
              <span className="text-base-content font-medium">
                {findGame(gameId)?.manifest.name ?? gameId}
              </span>
              <span className="text-bw-muted tabular-nums">
                {s.won}W · {s.lost}L{s.pushed > 0 ? ` · ${String(s.pushed)}P` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
