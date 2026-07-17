import { Card, cx } from '@/ui';
import { useAuth } from '@/system/auth/useAuth';
import { formatMoney } from '@/system/profile/money';
import { xpProgress } from '@/system/profile/xp';
import { useLeaderboard } from '@/system/progress/useLeaderboard';
import type { LeaderboardEntry } from '@/system/repo';

/**
 * The public standings — the reader the `leaderboard/` node was built for. Phase 2 wrote the
 * projection and pinned it; Phase 3 left this a placeholder because it "ranks by wins, a stat
 * Phase 4 adds with its writer"; Phase 4 added the writer, so the page arrives with the field
 * worth reading, exactly as promised.
 *
 * Ranked by wins, tie-broken by bankroll then XP — the order `LeaderboardRepo.top` returns, so the
 * page never re-sorts. Your own row is cyan (= here): the board's whole point is finding yourself
 * on it. Gold is the bankroll and only the bankroll.
 */

function Row({ entry, rank, isMe }: { entry: LeaderboardEntry; rank: number; isMe: boolean }) {
  const { level } = xpProgress(entry.xp);
  return (
    <div
      className={cx(
        'grid grid-cols-[2rem_1fr_auto] items-center gap-4 rounded-field px-3 py-2.5 sm:grid-cols-[2.5rem_1fr_5rem_7rem]',
        isMe && 'bg-secondary/10 ring-secondary/40 ring-1'
      )}
    >
      <span className="font-display text-bw-muted text-sm font-semibold tabular-nums">{rank}</span>
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-2xl" aria-hidden>
          {entry.avatar}
        </span>
        <div className="flex min-w-0 flex-col">
          <span
            className={cx(
              'font-display truncate text-sm font-semibold tracking-[0.06em]',
              isMe ? 'text-secondary' : 'text-base-content'
            )}
          >
            {entry.name}
          </span>
          <span className="text-bw-muted text-xs">Level {level}</span>
        </div>
      </div>
      <div className="flex flex-col items-end sm:items-start">
        <span className="font-display text-base-content text-sm font-semibold tabular-nums">
          {entry.wins.toLocaleString('en-US')}
        </span>
        <span className="text-bw-muted font-display text-[0.6rem] font-semibold tracking-[0.2em] uppercase sm:hidden">
          wins
        </span>
      </div>
      <span
        data-money
        className="text-accent hidden text-right text-sm font-semibold tracking-tight sm:block"
      >
        {formatMoney(entry.bankrollCents)}
      </span>
    </div>
  );
}

export function Leaderboard() {
  const { session } = useAuth();
  const { loading, entries, error } = useLeaderboard(25);

  return (
    // A ranked list reads better held to a column than stretched edge-to-edge, so this one
    // page opts out of the shell's full width — the grid pages (hub, store) fill; a list does not.
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-base-content text-3xl font-bold tracking-[0.08em] uppercase">
          Leaderboard
        </h1>
        <p className="text-bw-muted max-w-2xl text-sm">
          The public standings, ranked by wins. Everyone can see this — it is the one projection of
          a profile that is world-readable, and it holds no more than a name, an avatar, a level,
          wins and a bankroll.
        </p>
      </header>

      <Card className="flex flex-col gap-1 p-3">
        {/* Column headers, on wide screens only — the row layout carries the labels on mobile. */}
        <div className="text-bw-muted hidden grid-cols-[2.5rem_1fr_5rem_7rem] gap-4 px-3 pb-2 sm:grid">
          <span className="font-display text-[0.6rem] font-semibold tracking-[0.2em] uppercase">
            #
          </span>
          <span className="font-display text-[0.6rem] font-semibold tracking-[0.2em] uppercase">
            Player
          </span>
          <span className="font-display text-[0.6rem] font-semibold tracking-[0.2em] uppercase">
            Wins
          </span>
          <span className="font-display text-right text-[0.6rem] font-semibold tracking-[0.2em] uppercase">
            Bankroll
          </span>
        </div>

        {loading ? (
          <p className="text-bw-muted px-3 py-8 text-center text-sm">Loading the standings…</p>
        ) : error ? (
          <p className="text-bw-muted px-3 py-8 text-center text-sm">
            Couldn’t load the standings — try again in a moment.
          </p>
        ) : entries.length === 0 ? (
          <p className="text-bw-muted px-3 py-8 text-center text-sm">
            No standings yet. Win a game and you’ll be the first name here.
          </p>
        ) : (
          entries.map((entry, i) => (
            <Row key={entry.uid} entry={entry} rank={i + 1} isMe={entry.uid === session?.uid} />
          ))
        )}
      </Card>
    </div>
  );
}
