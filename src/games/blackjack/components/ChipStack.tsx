import { cx } from '@/ui';
import { formatMoney } from '@boardwalk/game-logic';
import { chipSrc, chipStack } from '@/games/blackjack/chips';

/**
 * A WAGER, AS CHIPS IN THE BETTING CIRCLE.
 *
 * The board used to say `$25` in 12px grey text under a hand, which is a spreadsheet cell. Money on
 * a blackjack table is a physical object sitting in a painted circle, and it is the only thing on
 * the felt that tells you at a glance who is in the hand and for how much — which matters at a
 * table where four chairs stake independently and none of them is your business until the dealer
 * gets there.
 *
 * **THE FIGURE IS NOT OPTIONAL AND IS NOT A PROP.** `chipStack` breaks an amount into $1-and-up
 * chips, so a sub-dollar remainder has no chip to be — insurance on a $25 hand is $12.50 and draws
 * as $12. The chips ILLUSTRATE and the label STATES, so the label is rendered here, from the same
 * `cents` the stack was built from, rather than left to a caller who might not bother.
 */

/** How many chips of one denomination are actually drawn before the count takes over. */
const MAX_VISIBLE = 5;
/** How far each chip in a stack sits above the one below it, in rem — a leaned-back stack. */
const STACK_STEP_REM = 0.34;

export function ChipStack({
  cents,
  size = 'md',
  className,
}: {
  /** The amount staked, in cents. Drives both the chips and the figure under them. */
  readonly cents: number;
  /** `sm` for a neighbour's chair, `md` for your own and the solo table. */
  readonly size?: 'sm' | 'md';
  /** Layout only. */
  readonly className?: string;
}) {
  const runs = chipStack(cents);
  const chipRem = size === 'sm' ? 1.7 : 2.25;

  if (runs.length === 0) {
    // No bet is drawn as an EMPTY circle rather than as nothing: the painted circle is where a bet
    // goes, and a chair with an empty one reads as "has not bet yet", which in the betting phase is
    // exactly what the table is waiting for.
    return (
      <div
        className={cx(
          'border-bw-line/60 flex items-center justify-center rounded-full border border-dashed',
          size === 'sm' ? 'h-9 w-9' : 'h-12 w-12',
          className
        )}
        aria-label="No bet"
      />
    );
  }

  return (
    <div className={cx('flex flex-col items-center gap-1', className)}>
      <div className="flex items-end justify-center gap-1">
        {runs.map((run) => {
          const drawn = Math.min(run.count, MAX_VISIBLE);
          return (
            <div
              key={run.denomCents}
              className="relative"
              style={{
                width: `${String(chipRem)}rem`,
                // The stack's own height: one chip, plus the lift of everything above it.
                height: `${String(chipRem + (drawn - 1) * STACK_STEP_REM)}rem`,
              }}
            >
              {Array.from({ length: drawn }, (_, i) => (
                <img
                  key={i}
                  src={chipSrc(run.denomCents)}
                  alt=""
                  aria-hidden
                  width={256}
                  height={256}
                  className="absolute left-0 w-full drop-shadow-md"
                  style={{
                    // Later chips sit HIGHER and on top — a stack builds upward.
                    bottom: `${String(i * STACK_STEP_REM)}rem`,
                    zIndex: i,
                  }}
                />
              ))}
              {run.count > MAX_VISIBLE && (
                <span className="text-bw-muted absolute -right-1 -bottom-1 z-10 text-[0.6rem] font-bold">
                  ×{run.count}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* Gold, because it is money, and it is the truth the chips only approximate. */}
      <span
        data-money
        className={cx(
          'font-display text-accent font-bold tracking-tight',
          size === 'sm' ? 'text-xs' : 'text-sm'
        )}
      >
        {formatMoney(cents)}
      </span>
    </div>
  );
}
