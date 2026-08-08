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
 * state: you read it out of the corner of your eye without looking at it. It is `animate-spin`
 * slowed right down and run backwards for anticlockwise, so it costs no new theme token, and
 * `prefers-reduced-motion` stops it with everything else.
 *
 * THE ARROWHEADS ARE TANGENTIAL, and this is the part the first pass got wrong. It placed `↑ → ↓ ←`
 * at top/right/bottom/left — each arrow pointing straight OUT from the centre, which is not a
 * rotation at all, it is an explosion. Spinning it did not rescue the reading: a player sees four
 * arrows aimed at the four walls of the room and the spin looks like decoration wrapped around the
 * piles. An arrow that says "play goes this way" has to point ALONG the circle, not away from it —
 * clockwise is `→` at the top, `↓` on the right, `←` at the bottom, `↑` on the left, which is v1's
 * own set, and it is legible in a still screenshot before the animation contributes anything.
 * So both halves now carry the state: the arrowheads say which way, the spin repeats it in motion.
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

/** Where each arrow sits on the ring. The glyph it carries depends on which way play is going. */
const AT = [
  'top-0 left-1/2 -translate-x-1/2',
  'top-1/2 right-0 -translate-y-1/2',
  'bottom-0 left-1/2 -translate-x-1/2',
  'top-1/2 left-0 -translate-y-1/2',
] as const;

/** Tangential, in the same order as `AT`: top, right, bottom, left. Clockwise, then anticlockwise. */
const GLYPHS: Record<1 | -1, readonly [string, string, string, string]> = {
  1: ['→', '↓', '←', '↑'],
  [-1]: ['←', '↑', '→', '↓'],
};

export interface TableCentreProps {
  readonly top: Card;
  readonly color: UnoColor;
  readonly direction: 1 | -1;
  readonly deckCount: number;
  /** Cards a live stack owes whoever is on turn; `0` at a table not playing that house rule. */
  readonly pending: number;
  readonly canDraw: boolean;
  readonly onDraw: () => void;
}

export function TableCentre({
  top,
  color,
  direction,
  deckCount,
  pending,
  canDraw,
  onDraw,
}: TableCentreProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      {/* THE RING IS CENTRED ON THE PILES, not on this whole column, and it is the reason the
          wrapper below exists. It used to be absolutely placed against the outer box — which
          includes the colour pill — so it sat ~1.25rem BELOW the cards it is supposed to orbit,
          and its top arrow landed in the far seat's hand instead of on the felt between them.
          Wrapping the piles gives it a box whose centre is the piles' centre, and the piles row is
          `relative` so it paints over the ring rather than under it.

          SIZE IS A CLEARANCE, not a look: at 14rem the arrows orbit ~6.25rem out, which is 0.75rem
          clear of the discard and ~2.75rem above the cards — the gap the seats are then placed
          outside of (see the table's spacing in Board.tsx). The old 16rem ring reached further than
          the seats did, which is most of why the felt read as empty in the middle and crowded at
          the edges. */}
      <div className="relative">
        <div
          aria-hidden
          className={cx(
            'text-bw-line-strong pointer-events-none absolute top-1/2 left-1/2 size-56 -translate-x-1/2 -translate-y-1/2',
            'animate-spin [animation-duration:14s]',
            direction === -1 && '[animation-direction:reverse]'
          )}
        >
          {AT.map((at, i) => (
            <span key={at} className={cx('absolute text-2xl leading-none', at)}>
              {GLYPHS[direction][i]}
            </span>
          ))}
        </div>

        <div className="relative flex items-center gap-8">
          {/* DRAW PILE — a real stack, because "how much deck is left" is a thing players watch. */}
          <button
            type="button"
            disabled={!canDraw}
            onClick={onDraw}
            aria-label={
              pending > 0
                ? `Take the stack — ${String(pending)} cards`
                : `Draw a card — ${String(deckCount)} left in the deck`
            }
            className={cx(
              'group relative rounded-box transition',
              canDraw
                ? 'hover:-translate-y-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-secondary'
                : 'cursor-default brightness-75'
            )}
          >
            {/* The two cards UNDER the top one. They are darkened, not faded: a translucent card
              shows the felt through the sliver of it that sticks out, which reads as a smudge
              rather than a deck. Brightness keeps them opaque, so the stack reads as depth. */}
            <img
              src={unoBackSrc()}
              alt=""
              aria-hidden
              className="absolute top-1 left-1 h-28 w-auto rounded-md brightness-50"
            />
            <img
              src={unoBackSrc()}
              alt=""
              aria-hidden
              className="absolute top-0.5 left-0.5 h-28 w-auto rounded-md brightness-75"
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
            {/* WHAT THE PILE OWES YOU. The deck-count badge's own treatment mirrored to the opposite
              corner, because it is the same kind of fact about the same object — how many cards are
              coming off it. FLAT `warning` and no glow: the budget is blue=act, cyan=here,
              gold=money, and a stack is a threat rather than any of the three. It is also the one
              number on the felt that makes the dimmed fan legible — without it, a hand where only
              the +2s light up reads as a bug. */}
            {pending > 0 && (
              <span className="bg-base-100/90 border-warning text-warning absolute -top-2 -left-2 rounded-full border px-1.5 py-0.5 text-[0.7rem] font-bold tabular-nums">
                +{pending}
              </span>
            )}
          </button>

          {/* DISCARD — keyed on the card's id so a new top card MOUNTS and plays `pitch` once. */}
          <img
            key={top.id}
            src={unoCardSrc(top)}
            alt="Top of the pile"
            className="animate-pitch h-28 w-auto rounded-md"
          />
        </div>
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
