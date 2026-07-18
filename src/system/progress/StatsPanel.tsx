import { Card } from '@/ui';
import { findGame } from '@/games/registry';
import { useProfile } from '@/system/profile/useProfile';
import { ACHIEVEMENTS } from '@boardwalk/game-logic';
import { totalPlayed, totalWins } from '@boardwalk/game-logic';

/**
 * The play record — totals across everything, then a per-game breakdown with a win rate for each
 * table. `wins` here is the same `totalWins` the leaderboard ranks by, so the number a player sees
 * on their own profile is the number the board sorts them on. No second count, no drift.
 *
 * Everything on this page is DERIVED from the private `stats` (and `achievements`) — win rate,
 * favorite table, completion %. Nothing new is stored: a derived stat has one source of truth, the
 * `level`-from-`xp` rule applied to the whole panel. The per-game rows resolve `gameId` through the
 * registry, falling back to the raw id so a record with no game to name it is still a record.
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

/** Win rate as a whole percent, safe on a zero denominator. */
function winPercent(won: number, played: number): number {
  return played > 0 ? Math.round((won / played) * 100) : 0;
}

export function StatsPanel() {
  const profile = useProfile();
  if (profile === null) return null;

  const played = totalPlayed(profile.stats);
  const wins = totalWins(profile.stats);
  const winRate = winPercent(wins, played);
  const earned = ACHIEVEMENTS.filter((a) => a.id in profile.achievements).length;

  // Only games actually played, sorted by most-played so a player's main table leads. `reduce`
  // for the favorite would re-walk the list; the sorted array's head is the same answer.
  const games = Object.entries(profile.stats)
    .filter(([, s]) => s.played > 0)
    .sort(([, a], [, b]) => b.played - a.played);
  const favorite = games[0];
  const favoriteName = favorite ? (findGame(favorite[0])?.manifest.name ?? favorite[0]) : null;

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="font-display text-base-content text-sm font-semibold tracking-[0.2em] uppercase">
        Record
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Played" value={played.toLocaleString('en-US')} />
        <Tile label="Won" value={wins.toLocaleString('en-US')} />
        <Tile label="Win rate" value={`${String(winRate)}%`} />
        <Tile label="Badges" value={`${String(earned)} / ${String(ACHIEVEMENTS.length)}`} />
      </div>

      {favoriteName !== null && (
        <p className="text-bw-muted text-sm">
          Favorite table:{' '}
          <span className="text-base-content font-medium">{favoriteName}</span> —{' '}
          {favorite![1].played.toLocaleString('en-US')} games.
        </p>
      )}

      {games.length === 0 ? (
        <p className="text-bw-muted text-sm">
          No games played yet — your record fills in as you play.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {/* Column headers, wide screens only — the row carries its own labels on mobile. */}
          <div className="text-bw-muted hidden grid-cols-[1fr_auto_4rem] gap-4 px-1 pb-1 sm:grid">
            <span className="font-display text-[0.6rem] font-semibold tracking-[0.2em] uppercase">
              Game
            </span>
            <span className="font-display text-[0.6rem] font-semibold tracking-[0.2em] uppercase">
              Record
            </span>
            <span className="font-display text-right text-[0.6rem] font-semibold tracking-[0.2em] uppercase">
              Win %
            </span>
          </div>
          {games.map(([gameId, s]) => (
            <div
              key={gameId}
              className="border-bw-line/60 grid grid-cols-[1fr_auto] items-center gap-4 border-b py-2 text-sm last:border-b-0 sm:grid-cols-[1fr_auto_4rem]"
            >
              <span className="text-base-content font-medium">
                {findGame(gameId)?.manifest.name ?? gameId}
              </span>
              <span className="text-bw-muted tabular-nums">
                {s.won}W · {s.lost}L{s.pushed > 0 ? ` · ${String(s.pushed)}P` : ''}
              </span>
              <span className="font-display text-base-content hidden text-right font-semibold tabular-nums sm:block">
                {winPercent(s.won, s.played)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
