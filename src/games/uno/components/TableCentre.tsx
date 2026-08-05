import { cx } from '@/ui';
import { unoBackSrc, unoCardSrc } from '@/games/uno/art';
import type { Card, UnoColor } from '@boardwalk/game-logic/games/uno';

/**
 * THE MIDDLE OF THE TABLE — the draw pile, the discard, which colour is live, and which way play is
 * going. v1 put all four in the centre and it is right: these are the only facts every player needs
 * at once, and a hidden-hand game has nowhere else to put them.
 *
 * THE DIRECTION RING is the piece that looks decorative and is not. Reverse is the one action card
 * whose effect is invisible — a skip removes a turn you can see coming, a draw-two lands on somebody,
 * but a reverse changes nothing on the felt and everything about who plays next. v1 answered with
 * four arrows slowly orbiting the piles, and the reason it works is that the ROTATION carries the
 * state, not the arrowheads: you read it out of the corner of your eye without looking at it. It is
 * `animate-spin` slowed right down and run backwards for anticlockwise, so it costs no new theme
 * token, and `prefers-reduced-motion` stops it with everything else.
 *
 * THE ACTIVE COLOUR is a tinted pill rather than v1's solid one. Solid was the obvious port and it
 * fails on contrast: `--color-uno-yellow` is a light token and `--color-uno-red` a mid one, so one
 * label would need dark text and the other light, and a per-colour text rule is two more tokens for
 * a thing that is already unambiguous. Tint the surface, keep the border and the dot at full
 * strength, and the text stays `base-content` against a background the theme has already checked.
 */

const SWATCH: Record<UnoColor, string> = {
  red: 'bg-uno-red',
  blue: 'bg-uno-blue',
  green: 'bg-uno-green',
  yellow: 'bg-uno-yellow',
};
const TINT: Record<UnoColor, string> = {
  red: 'bg-uno-red/15 border-uno-red/70',
  blue: 'bg-uno-blue/15 border-uno-blue/70',
  green: 'bg-uno-green/15 border-uno-green/70',
  yellow: 'bg-uno-yellow/15 border-uno-yellow/70',
};

export interface TableCentreProps {
  readonly top: Card;
  readonly color: UnoColor;
  readonly direction: 1 | -1;
  readonly deckCount: number;
  readonly canDraw: boolean;
  readonly onDraw: () => void;
}

export function TableCentre({
  top,
  color,
  direction,
  deckCount,
  canDraw,
  onDraw,
}: TableCentreProps) {
  return (
    <div className="relative flex flex-col items-center gap-3 py-2">
      {/* The ring, behind the piles and out of the hit-testing path. */}
      <div
        aria-hidden
        className={cx(
          'text-bw-line-strong pointer-events-none absolute top-1/2 left-1/2 size-64 -translate-x-1/2 -translate-y-1/2',
          'animate-spin [animation-duration:14s]',
          direction === -1 && '[animation-direction:reverse]'
        )}
      >
        {(
          [
            ['↑', 'top-0 left-1/2 -translate-x-1/2'],
            ['→', 'top-1/2 right-0 -translate-y-1/2'],
            ['↓', 'bottom-0 left-1/2 -translate-x-1/2'],
            ['←', 'top-1/2 left-0 -translate-y-1/2'],
          ] as const
        ).map(([glyph, at]) => (
          <span key={at} className={cx('absolute text-2xl leading-none', at)}>
            {glyph}
          </span>
        ))}
      </div>

      <div className="relative flex items-center gap-8">
        {/* DRAW PILE — a real stack, because "how much deck is left" is a thing players watch. */}
        <button
          type="button"
          disabled={!canDraw}
          onClick={onDraw}
          aria-label={`Draw a card — ${String(deckCount)} left in the deck`}
          className={cx(
            'group relative rounded-box transition',
            canDraw
              ? 'hover:-translate-y-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-secondary'
              : 'cursor-default opacity-70'
          )}
        >
          <img
            src={unoBackSrc()}
            alt=""
            aria-hidden
            className="absolute top-1 left-1 h-28 w-auto rounded-md opacity-60"
          />
          <img
            src={unoBackSrc()}
            alt=""
            aria-hidden
            className="absolute top-0.5 left-0.5 h-28 w-auto rounded-md opacity-80"
          />
          <img
            src={unoBackSrc()}
            alt=""
            aria-hidden
            className={cx(
              'relative h-28 w-auto rounded-md transition',
              canDraw && 'group-hover:shadow-glow-primary'
            )}
          />
          <span className="bg-base-100/90 border-bw-line text-bw-muted absolute -right-2 -bottom-2 rounded-full border px-1.5 py-0.5 text-[0.65rem] tabular-nums">
            {deckCount}
          </span>
        </button>

        {/* DISCARD — keyed on the card's id so a new top card MOUNTS and plays `pitch` once. */}
        <img
          key={top.id}
          src={unoCardSrc(top)}
          alt="Top of the pile"
          className="animate-pitch h-28 w-auto rounded-md"
        />
      </div>

      <span
        className={cx(
          'font-display inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.7rem] font-semibold tracking-[0.15em] uppercase',
          TINT[color]
        )}
      >
        <span aria-hidden className={cx('inline-block size-2.5 rounded-full', SWATCH[color])} />
        {color}
      </span>
    </div>
  );
}
