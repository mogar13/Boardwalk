import { cx } from '@/ui';
import { unoBackSrc } from '@/games/uno/art';
import type { UnoSeatSide } from '@/games/uno/seatLayout';

/**
 * ONE OPPONENT AT THE TABLE — their name, their fanned face-down hand, and how many cards are in it.
 *
 * THE FAN IS THE POINT. A count ("6 cards") is information; a fan of six backs is a table, and it is
 * the difference between reading a scoreboard and sitting at a game. It is also load-bearing
 * information in a hidden-hand game: how close everyone is to going out is the ONLY thing you can
 * read off another player, so it should be the thing your eye lands on, not a number in small text.
 *
 * THE DEAL ANIMATION IS FREE, and worth stating because it looks like it should need state. The
 * backs are keyed by INDEX, so growing the hand mounts new elements at the TAIL and React leaves the
 * rest alone — a mounting element runs `animate-deal` once, an existing one does not. So drawing two
 * animates exactly the two that arrived, the opening deal animates all seven, and shrinking a hand
 * (playing a card) animates nothing. No previous-count ref, no effect, nothing to get out of step
 * with the projection.
 *
 * CAPPED AT `MAX_FANNED`. A player who draws their way to twenty cards must not push the table off
 * the screen; past the cap the count text is the honest reading, and the pile stops growing.
 */

/** Beyond this many, the fan stops growing and the count carries the rest. */
const MAX_FANNED = 8;

/**
 * THE FAN'S GEOMETRY, stated once — and the one genuinely non-obvious thing in this file.
 *
 * A `rotate-90` does NOT change an element's layout box. A card that is `CARD_W × CARD_H` still
 * occupies `CARD_W × CARD_H` after rotating, while now LOOKING `CARD_H × CARD_W`. So the flank
 * seats cannot be a stack of rotated images with a negative margin: that overlaps the layout boxes
 * and not the pictures, and the first browser pass duly rendered a barcode. Each rotated card gets
 * a wrapper sized to its ROTATED footprint instead (`CARD_H` wide, one `STEP` tall) with the image
 * centred inside — so the wrapper heights ARE the fan, and the geometry is stated rather than
 * inferred from how two transforms happen to interact.
 *
 * `STEP` is how much of each card the next one leaves showing, and it is deliberately the same on
 * both axes so the flanks and the far side of the table fan identically. The ratio below is the
 * art's real one, measured in the browser rather than guessed — the first pass assumed 0.62 and
 * every fan came out tighter than intended.
 */
const CARD_H = '2.75rem';
const CARD_W = '1.5rem'; // 0.54 × CARD_H, measured
const STEP = '0.9rem';
/** Half a card hangs outside the fan's box at each end; this stops the two end cards being clipped. */
const SIDE_PAD = '0.5rem';

const SIDE_STYLE: Record<UnoSeatSide, { readonly rotate: string }> = {
  top: { rotate: 'rotate-180' }, // sitting opposite you, so their cards face away
  left: { rotate: 'rotate-90' },
  right: { rotate: '-rotate-90' },
};

export interface SeatViewProps {
  readonly name: string;
  readonly side: UnoSeatSide;
  readonly count: number;
  /** Whose turn it is — the cyan "you are here" cue, the same signal the board uses for your hand. */
  readonly active: boolean;
  /** They are on one card AND declared it. An undeclared one card is not announced — that is the game. */
  readonly calledUno: boolean;
}

export function SeatView({ name, side, count, active, calledUno }: SeatViewProps) {
  const geom = SIDE_STYLE[side];
  const shown = Math.min(count, MAX_FANNED);
  const vertical = side !== 'top';

  return (
    <div
      className={cx(
        'flex flex-col items-center gap-1 rounded-box border px-2 py-1.5 transition',
        active
          ? 'border-secondary/70 bg-base-300 shadow-glow-secondary'
          : 'border-bw-line bg-base-200/70'
      )}
    >
      <span
        className={cx(
          'font-display flex max-w-28 items-center gap-1 truncate text-xs font-semibold tracking-wide',
          active ? 'text-secondary text-shadow-neon-cyan' : 'text-base-content'
        )}
      >
        {active && <span aria-hidden>★</span>}
        <span className="truncate">{name}</span>
      </span>

      <div
        className={cx('flex items-center justify-center', vertical ? 'flex-col' : 'flex-row')}
        style={vertical ? { paddingBlock: SIDE_PAD } : undefined}
        aria-label={`${name} holds ${String(count)} cards`}
      >
        {Array.from({ length: shown }).map((_, i) =>
          vertical ? (
            // A rotation does not move the LAYOUT box, so the images cannot simply be stacked with
            // a negative margin — each gets a wrapper sized to the rotated footprint (a card's
            // height wide, one STEP tall) with the image centred inside it. The wrapper heights
            // ARE the fan; the container's padding absorbs the half-card hanging off each end.
            <div key={i} className="relative" style={{ width: CARD_H, height: STEP, zIndex: i }}>
              <img
                src={unoBackSrc()}
                alt=""
                aria-hidden
                className={cx(
                  'animate-deal absolute top-1/2 left-1/2 w-auto -translate-x-1/2 -translate-y-1/2 rounded-sm',
                  geom.rotate
                )}
                style={{ height: CARD_H, animationDelay: `${String(i * 45)}ms` }}
              />
            </div>
          ) : (
            <img
              key={i}
              src={unoBackSrc()}
              alt=""
              aria-hidden
              className={cx('animate-deal w-auto rounded-sm', geom.rotate)}
              style={{
                height: CARD_H,
                // The same fraction of a card shows as on the flanks — here on the inline axis,
                // where a card is only `CARD_W` wide to begin with.
                marginLeft: i === 0 ? 0 : `calc(${STEP} - ${CARD_W})`,
                // A short stagger so a deal reads as cards being dealt rather than appearing at once.
                animationDelay: `${String(i * 45)}ms`,
                zIndex: i,
              }}
            />
          )
        )}
      </div>

      <span
        className={cx(
          'text-[0.65rem] tabular-nums',
          count === 1 ? 'text-warning font-bold' : 'text-bw-muted'
        )}
      >
        {count === 1 && calledUno ? 'UNO!' : `${String(count)} card${count === 1 ? '' : 's'}`}
      </span>
    </div>
  );
}
