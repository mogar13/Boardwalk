import { useState } from 'react';
import { Card, cx } from '@/ui';
import { useAuth } from '@/system/auth/useAuth';
import { formatMoney } from '@/system/profile/money';
import { xpProgress } from '@/system/profile/xp';
import { BOARDS, boardById, winRateOf, type Board, type BoardId } from '@/system/progress/boards';
import { useLeaderboard } from '@/system/progress/useLeaderboard';
import type { LeaderboardEntry } from '@/system/repo';

/**
 * The public standings — the reader the `leaderboard/` node was built for. Phase 4 shipped one
 * board (wins); this is the "everyone can be #1 at something" expansion: four axes — wins, bankroll,
 * level, win rate — each a tab. One stiff number let exactly one player top the board; four let a
 * grinder, a whale, a leveller and a sharp each own one.
 *
 * The ranking is NOT decided here — `@/system/progress/boards` owns every board's order, and the
 * repo sorts by the same `compare`, so the page and the repo cannot disagree. This file only picks
 * a board, reads its ranked rows, and draws them. Your own row is cyan (= here): the board's whole
 * point is finding yourself on it.
 */

/** The board's headline value for one row, formatted for display. Exhaustive over `BoardId`. */
function boardValue(board: Board, entry: LeaderboardEntry): string {
  switch (board.id) {
    case 'wins':
      return entry.wins.toLocaleString('en-US');
    case 'richest':
      return formatMoney(entry.bankrollCents);
    case 'level':
      return `Lvl ${String(xpProgress(entry.xp).level)}`;
    case 'winRate':
      return `${String(Math.round(winRateOf(entry) * 100))}%`;
  }
}

function Row({
  entry,
  rank,
  isMe,
  board,
}: {
  entry: LeaderboardEntry;
  rank: number;
  isMe: boolean;
  board: Board;
}) {
  const { level } = xpProgress(entry.xp);
  // Gold is money and only money — so the value column glows gold on the Richest board and nowhere
  // else, the same rule the whole theme follows.
  const moneyBoard = board.id === 'richest';
  return (
    <div
      className={cx(
        'rounded-field grid grid-cols-[2rem_1fr_auto] items-center gap-4 px-3 py-2.5 sm:grid-cols-[2.5rem_1fr_7rem]',
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
      <span
        {...(moneyBoard ? { 'data-money': true } : {})}
        className={cx(
          'text-right text-sm font-semibold tabular-nums tracking-tight',
          moneyBoard ? 'text-accent' : 'text-base-content font-display'
        )}
      >
        {boardValue(board, entry)}
      </span>
    </div>
  );
}

export function Leaderboard() {
  const { session } = useAuth();
  const [board, setBoard] = useState<BoardId>('wins');
  const { loading, entries, error } = useLeaderboard(board, 25);
  const active = boardById(board);

  return (
    // A ranked list reads better held to a column than stretched edge-to-edge, so this one
    // page opts out of the shell's full width — the grid pages (hub, store) fill; a list does not.
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-base-content text-3xl font-bold tracking-[0.08em] uppercase">
          Leaderboard
        </h1>
        <p className="text-bw-muted max-w-2xl text-sm">{active.blurb}</p>
      </header>

      {/* Board tabs. Cyan = here, the same "you are on this one" meaning the ring has everywhere.
          Buttons, not links — the board is view state, not a route, so it does not belong in the
          URL (yet). `aria-pressed` makes each a toggle a screen reader can read the state of. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Leaderboard boards">
        {BOARDS.map((b) => {
          const selected = b.id === board;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setBoard(b.id);
              }}
              aria-pressed={selected}
              className={cx(
                'rounded-field font-display px-3 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase',
                'transition-colors duration-200 ease-strike',
                selected
                  ? 'bg-secondary/15 text-secondary ring-secondary/40 ring-1'
                  : 'text-bw-muted hover:text-base-content'
              )}
            >
              {b.label}
            </button>
          );
        })}
      </div>

      <Card className="flex flex-col gap-1 p-3">
        {/* Column headers, on wide screens only — the row layout carries the labels on mobile. */}
        <div className="text-bw-muted hidden grid-cols-[2.5rem_1fr_7rem] gap-4 px-3 pb-2 sm:grid">
          <span className="font-display text-[0.6rem] font-semibold tracking-[0.2em] uppercase">
            #
          </span>
          <span className="font-display text-[0.6rem] font-semibold tracking-[0.2em] uppercase">
            Player
          </span>
          <span className="font-display text-right text-[0.6rem] font-semibold tracking-[0.2em] uppercase">
            {active.column}
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
            {board === 'winRate'
              ? 'No one has played enough games to rank yet — this board needs a real sample.'
              : 'No standings yet. Win a game and you’ll be the first name here.'}
          </p>
        ) : (
          entries.map((entry, i) => (
            <Row
              key={entry.uid}
              entry={entry}
              rank={i + 1}
              isMe={entry.uid === session?.uid}
              board={active}
            />
          ))
        )}
      </Card>
    </div>
  );
}
