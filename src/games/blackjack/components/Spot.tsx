import { cx } from '@/ui';
import {
  handValue,
  isBlackjack,
  type Card,
  type Result,
} from '@boardwalk/game-logic/games/blackjack';
import { ChipStack } from '@/games/blackjack/components/ChipStack';
import { Hand, type HandSize } from '@/games/blackjack/components/Hand';
import { ScoreBubble } from '@/games/blackjack/components/ScoreBubble';

/**
 * ONE CHAIR AT THE TABLE — cards, total, the money in the circle, and whose chair it is.
 *
 * The order down the column is the order on a real table, and it is not arbitrary: the dealer is at
 * the top, so a chair's CARDS sit nearest the dealer, its BET sits in the painted circle in front
 * of them, and the PLAYER is furthest away. Boardwalk's board had the wager as a grey line of text
 * under the hand and the name above it, which is the reading order of a table seen from nowhere.
 *
 * **THE ACTIVE CUE IS THE NAMEPLATE AND THE BUBBLE, NEVER A BOX ROUND THE CHAIR.** UNO's board
 * settled that argument one game over — a felt with four lit rectangles on it spends the glow
 * budget without buying the distinction it exists for.
 */

/** What the line under a chair says once the round is over. One place, so the copy cannot drift. */
const RESULT_COPY: Record<Result, string> = {
  blackjack: 'Blackjack!',
  win: 'Wins',
  push: 'Push',
  lose: 'Loses',
};

export function Spot({
  name,
  you,
  active,
  waiting,
  cards,
  wagerCents,
  insuranceCents,
  doubled,
  result,
  settled,
  size = 'md',
  dropRem = 0,
}: {
  readonly name: string;
  /** Marks the chair as the local player's — the arc never MOVES you, it labels you. */
  readonly you: boolean;
  /** This chair is on turn. */
  readonly active: boolean;
  /** The table is waiting on this chair for something that is not a turn — a bet, or an
   *  insurance answer. Blackjack can stall on a chair whose turn it is not, which no other dealt
   *  game in this repo can do, so it needs saying at the chair rather than only in a line of prose. */
  readonly waiting?: boolean;
  readonly cards: readonly Card[];
  readonly wagerCents: number;
  readonly insuranceCents: number;
  readonly doubled: boolean;
  readonly result: Result | null;
  readonly settled: boolean;
  readonly size?: HandSize;
  /** How far down the arc this chair sits — `seatArc`'s answer, applied as a top margin. */
  readonly dropRem?: number;
}) {
  const dealt = cards.length > 0;
  const value = dealt ? handValue(cards) : null;
  const natural = dealt && isBlackjack(cards);
  const tone = !dealt
    ? 'idle'
    : value !== null && value.total > 21
      ? 'bust'
      : natural
        ? 'blackjack'
        : active
          ? 'active'
          : 'idle';

  return (
    <div
      className="flex flex-col items-center gap-1.5"
      style={{ marginTop: `${String(dropRem)}rem` }}
    >
      <Hand cards={cards} size={size} />

      {value !== null && <ScoreBubble total={value.total} tone={tone} size={size} />}

      {/* THE BETTING CIRCLE. Empty is a dashed ring rather than nothing: in the betting phase an
          empty circle is precisely what the table is waiting for, and a chair that renders nothing
          there reads as a chair with no player in it. */}
      <ChipStack cents={wagerCents} size={size} />

      {/* The two things a stake can be that its own number does not say. Insurance is a SEPARATE
          bet on the same hand, so it is named rather than folded into the figure above. */}
      {(doubled || insuranceCents > 0) && (
        <span className="text-bw-muted text-[0.65rem] tracking-wide uppercase">
          {doubled && 'doubled'}
          {doubled && insuranceCents > 0 && ' · '}
          {insuranceCents > 0 && 'insured'}
        </span>
      )}

      <span
        className={cx(
          'font-display max-w-[10rem] truncate rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-[0.1em] uppercase',
          active
            ? 'border-secondary text-secondary text-shadow-neon-cyan bg-base-300/70'
            : waiting === true
              ? 'border-bw-line text-base-content bg-base-300/70'
              : 'border-accent/30 text-accent/85 bg-base-300/50'
        )}
      >
        {active && <span aria-hidden>★ </span>}
        {name}
        {you && ' (you)'}
      </span>

      {settled && result !== null && (
        <span
          className={cx(
            'text-xs font-semibold',
            result === 'lose' ? 'text-error' : result === 'push' ? 'text-bw-muted' : 'text-success'
          )}
        >
          {RESULT_COPY[result]}
        </span>
      )}
    </div>
  );
}
