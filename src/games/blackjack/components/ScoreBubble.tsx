import { cx } from '@/ui';

/**
 * A HAND'S TOTAL, in the chip-sized disc that sits under it — v1's `.score-bubble`, kept, because
 * it is the one number a blackjack player reads on every single card and it was previously rendered
 * as part of a grey uppercase caption ("YOU HAVE 16").
 *
 * **IT SPENDS NO NEW GLOW.** The budget is blue = act, cyan = here, gold = money, and this bubble
 * needs to say four different things, so three of them are said with a flat border and a text
 * colour rather than with light: cyan (and only cyan) for the chair on turn, which is "here"; error
 * for a bust; accent for a natural, which is the one case that IS money. Everything else is the
 * ordinary surface. A lit disc under every hand at a four-handed table is five glowing objects on a
 * felt that already has a lit action button.
 */
export function ScoreBubble({
  total,
  tone = 'idle',
  size = 'md',
  className,
}: {
  /** The hand's best total — `handValue().total`, never re-derived here. */
  readonly total: number;
  readonly tone?: 'idle' | 'active' | 'bust' | 'blackjack';
  readonly size?: 'sm' | 'md';
  /** Layout only. */
  readonly className?: string;
}) {
  return (
    <span
      className={cx(
        'font-display inline-flex items-center justify-center rounded-full border-2 font-bold tabular-nums',
        size === 'sm' ? 'h-7 min-w-7 px-1.5 text-xs' : 'h-9 min-w-9 px-2 text-sm',
        tone === 'active' && 'border-secondary text-secondary text-shadow-neon-cyan bg-base-300/80',
        tone === 'bust' && 'border-error text-error bg-base-300/80',
        tone === 'blackjack' && 'border-accent text-accent bg-base-300/80',
        tone === 'idle' && 'border-bw-line text-base-content bg-base-300/80',
        className
      )}
    >
      {total}
    </span>
  );
}
