import { cx } from '@/ui';
import { unoBackSrc } from '@/games/uno/art';
import type { UnoSeatSide } from '@/games/uno/seatLayout';

/**
 * ONE OPPONENT AT THE TABLE — their name, their fanned face-down hand, and how many cards are in it.
 *
 * THE FAN IS THE POINT, AND IT HAS TO BE BIG ENOUGH TO READ AS ONE. A count ("6 cards") is
 * information; a fan of six backs is a table. This shipped once at 2.75rem a card inside a bordered,
 * tinted panel, and the panel is what killed it: a boxed strip of 44px thumbnails reads as a
 * SCOREBOARD ROW that happens to contain pictures, which is exactly the shape the board rebuild
 * replaced at the layout level and then reintroduced at the seat level. v1 drew opponents' cards at
 * the same size as your own with no container at all, and that is why its table looked like a table.
 * So: no box, cards at 4.5rem (~64% of your own hand — far enough away to read as across the felt,
 * near enough to count at a glance), and the name doing the work the border used to.
 *
 * WHICH MEANS THE ACTIVE CUE MOVED, and that is a gain rather than a compromise. It used to be a
 * cyan glow on the PANEL; with no panel it is the name — cyan, neon, with a star — which is v1's own
 * answer (it glowed the `<h3>`) and one fewer glowing rectangle on a board that already has a lit
 * draw pile, a lit playable card and a turn cue. The glow budget is nearly spent; spending it on a
 * name instead of a container is strictly cheaper.
 *
 * THE COUNT SURVIVED THE BOX. It is Boardwalk's addition — v1 never said how many cards anyone held
 * — and it is the one thing a fan genuinely cannot do past a few cards, so it becomes a badge pinned
 * to the fan's corner, the same treatment (and the same classes) as the draw pile's deck count in
 * `TableCentre`. Same fact, same shape, one visual language for "how many are left".
 *
 * THE DEAL ANIMATION IS FREE, and worth stating because it looks like it should need state. The
 * backs are keyed by INDEX, so growing the hand mounts new elements at the TAIL and React leaves the
 * rest alone — a mounting element runs `animate-deal` once, an existing one does not. So drawing two
 * animates exactly the two that arrived, the opening deal animates all seven, and shrinking a hand
 * (playing a card) animates nothing. No previous-count ref, no effect, nothing to get out of step
 * with the projection.
 *
 * CAPPED AT `MAX_FANNED`. A player who draws their way to twenty cards must not push the table off
 * the screen; past the cap the badge is the honest reading, and the fan stops growing.
 */

/** Beyond this many, the fan stops growing and the badge carries the rest. */
const MAX_FANNED = 8;

/**
 * THE FAN'S GEOMETRY, stated once, in rem — and the one genuinely non-obvious thing in this file.
 *
 * A rotation does NOT change an element's layout box: a card that is `CARD_W × CARD_H` still
 * OCCUPIES `CARD_W × CARD_H` after `rotate-90` while now LOOKING `CARD_H × CARD_W`. So a flank seat
 * cannot be a stack of rotated images with a negative margin — that overlaps the layout boxes and
 * not the pictures, and the first browser pass duly rendered a barcode. Each card therefore gets a
 * wrapper sized to its ROTATED footprint with the image centred inside, and the wrappers are placed
 * absolutely in a container whose size is computed from the count. The geometry is stated rather
 * than inferred from how two transforms happen to interact, and it is the same three lines for all
 * three sides.
 *
 * `ART_RATIO` IS MEASURED, NOT GUESSED, and the old value was wrong: every file in
 * `public/cards/uno/` is 164×255, so a card is **0.643** as wide as it is tall. The previous
 * constant said 0.54, which understated a card's width by half a rem — and because it was used only
 * on the TOP row's margin arithmetic, the far side of the table fanned visibly tighter than the
 * flanks while the file's own comment claimed the two were identical. Deriving the width from the
 * height is what stops that being spellable.
 *
 * THE STEP IS NOT THE SAME ON BOTH AXES, and the first draft's claim that it should be was wrong in
 * a way only a screenshot shows. Geometrically it is one figure — both fans step along a card's
 * SHORT axis — so one constant is the tidy answer, and at 36% each it renders a legible stack of
 * cards down a flank and a row of vertical STRIPES across the top. The reason is what you are
 * looking at: on a flank you see a card's long edge and read the stack as depth, while on the top
 * row you are reading 36% of a narrow card and there is nothing else to go on. v1 was not uniform
 * either — 29% down the flanks, 43% across the top — and that asymmetry is not sloppiness in the
 * original, it is the correction. These are v1's ratios, restated as fractions of the short axis so
 * changing the card size keeps them.
 */
const CARD_H_REM = 4.5;
/** 164 × 255 — the real dimensions of every file in `public/cards/uno/`. */
const ART_RATIO = 0.643;
const CARD_W_REM = CARD_H_REM * ART_RATIO;
/** Fraction of a card's short axis the next one leaves showing. v1's, and see the note above. */
const STEP_REM: Record<UnoSeatSide, number> = {
  left: CARD_W_REM * 0.36,
  right: CARD_W_REM * 0.36,
  top: CARD_W_REM * 0.44,
};

const ROTATION: Record<UnoSeatSide, string> = {
  top: 'rotate-180', // sitting opposite you, so their cards face away
  left: 'rotate-90',
  right: '-rotate-90',
};

const rem = (n: number): string => `${String(Number(n.toFixed(3)))}rem`;

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
  const shown = Math.min(Math.max(count, 0), MAX_FANNED);
  const vertical = side !== 'top';
  const step = STEP_REM[side];

  // The fan's own box: one card across its short axis, plus a step for each card after the first.
  const span = CARD_W_REM + Math.max(shown - 1, 0) * step;
  const fanW = vertical ? CARD_H_REM : span;
  const fanH = vertical ? span : CARD_H_REM;

  /**
   * THE BADGE, and why the empty hand is its own branch. A seat with no cards is a seat that has
   * WON, and pinning the count to the corner of a fan that is not there leaves a glowing pill
   * floating over bare felt with the player's name above it — which is what the first browser pass
   * caught, and it read as a rendering fault rather than a victory. So an empty hand drops the box
   * and puts the badge in normal flow, under the name, where it looks deliberate.
   *
   * It says UNO! at EXACTLY one card and only once they have called it. The first draft keyed on
   * `calledUno` alone, and `calledUno` survives the winning play — so the seat that had just gone
   * out was still shouting UNO with nothing in its hand.
   */
  const shouting = count === 1 && calledUno;
  const badge = (
    <span
      className={cx(
        'z-20 rounded-full border px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums',
        count === 1
          ? 'border-warning bg-base-100 text-warning'
          : 'border-bw-line bg-base-100/90 text-bw-muted',
        shouting && 'shadow-glow-uno animate-lastcard',
        shown > 0 && 'absolute -right-2 -bottom-2'
      )}
    >
      {shouting ? 'UNO!' : count}
    </span>
  );

  return (
    <div className="flex flex-col items-center gap-1.5">
      <span
        className={cx(
          'font-display flex max-w-28 items-center gap-1 truncate text-xs font-semibold tracking-[0.12em] uppercase transition',
          // Bright, not muted, and that is what the deleted panel used to buy. v1 set these names in
          // gold and they anchored each seat; gold is money here, so the anchoring has to come from
          // weight and case instead, and a `bw-muted` name left the fans floating on bare felt.
          active ? 'text-secondary text-shadow-neon-cyan' : 'text-base-content'
        )}
      >
        {active && <span aria-hidden>★</span>}
        <span className="truncate">{name}</span>
      </span>

      <div
        className="relative flex items-center justify-center"
        style={shown > 0 ? { width: rem(fanW), height: rem(fanH) } : undefined}
        aria-label={`${name} holds ${String(count)} card${count === 1 ? '' : 's'}`}
      >
        {Array.from({ length: shown }).map((_, i) => (
          // The wrapper is the card's ROTATED footprint and carries the placement and the deal
          // animation; the image inside carries the rotation. Two elements, two transforms — on one
          // element `animate-deal`'s keyframed `transform` would replace the rotation for the length
          // of the animation, so a card on a flank would deal face-up-portrait and then snap round.
          <div
            key={i}
            className="animate-deal absolute"
            style={{
              width: rem(vertical ? CARD_H_REM : CARD_W_REM),
              height: rem(vertical ? CARD_W_REM : CARD_H_REM),
              left: vertical ? 0 : rem(i * step),
              top: vertical ? rem(i * step) : 0,
              // Later cards sit on top, so a flank reads downward and the top row left-to-right.
              zIndex: i,
              // A short stagger, so a deal reads as cards arriving rather than appearing at once.
              animationDelay: `${String(i * 45)}ms`,
            }}
          >
            <img
              src={unoBackSrc()}
              alt=""
              aria-hidden
              className={cx(
                'shadow-lift absolute top-1/2 left-1/2 w-auto -translate-x-1/2 -translate-y-1/2 rounded-sm',
                ROTATION[side]
              )}
              style={{ height: rem(CARD_H_REM) }}
            />
          </div>
        ))}

        {/* THE COUNT — the draw pile's badge, on a hand instead of a deck. Amber at one card,
            because "somebody is one card out" is the loudest public fact in UNO, and it shouts only
            once they have actually called it: going to one QUIETLY is the thing the +2 exists to
            punish, so a table that announced it for them would be playing the game for you. */}
        {badge}
      </div>
    </div>
  );
}
