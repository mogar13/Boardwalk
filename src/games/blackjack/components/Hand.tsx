import { cardBackSrc, cardSrc } from '@/system/cards/cards';
import { useEquippedCardBack } from '@/system/cards/useCardBack';
import { cx } from '@/ui';
import type { Card } from '@boardwalk/game-logic/games/blackjack';

/**
 * A HAND OF CARDS, pitched onto the felt.
 *
 * It hands a logic `Card` straight to `cardSrc` from `@/system/cards`: the logic model and the art
 * model are separate types (the purity rule keeps `logic/` from importing `system/`), but their
 * suit/rank literals are identical, so this assignment is what proves at compile time that they
 * still line up.
 *
 * `faceDown` is a COUNT of backs to draw after the cards, and that shape is the shape of the
 * dealt-hand seam. It used to be `hideIndex` — an index into a full dealer hand whose hole card the
 * client held and merely declined to render. Since Phase D the client does not hold it: an unsettled
 * dealer hand carries exactly one card, and the gap where the second one will be is drawn as a back
 * because there is genuinely nothing there.
 *
 * **THE CARDS ARE SIZED BY HEIGHT WITH `w-auto`, never by a fixed width/height pair.** The art is
 * 140×190 and the old board drew it into `h-28 w-20`, which is 112×80 — a ratio of 0.714 against
 * the art's 0.737, so every card on the table was very slightly squashed and `object-contain` then
 * letterboxed it inside its own border. Driving the height and letting the width follow is the same
 * correction UNO's board made when it measured its art ratio at 0.643 and found the constant saying
 * 0.54.
 */

/** The art's own aspect ratio, measured off the files: 140 × 190. Used to place the overlap. */
const CARD_RATIO = 140 / 190;

/**
 * Card height in rem, by size. `md` is a one- or two-chair table; `sm` is three or four.
 *
 * Both went UP, and both are bounded in two directions at once. WIDTH is the easy one and it is
 * arithmetic: four chairs holding three cards each at `sm` measure ~790px including the seat gaps,
 * inside the ~960px of usable cloth, so the widest ordinary table still fits on one row. HEIGHT is
 * the one that bites, and only a browser can see it — a card height lands on the felt TWICE (the
 * dealer's row and the chairs') plus once more as the empty placeholder, so a rem here is ~2.5rem
 * of table, and the table has to leave its own controls above the fold. 8rem was measured and put
 * PLACE BET on the last pixel of a 1000px viewport. That is why these are not simply as large as
 * they look good.
 */
const CARD_H_REM = { sm: 5.5, md: 7.5 } as const;

/**
 * How much of a card the next one covers, as a fraction of its width — LESS at `md`, because a
 * table with one or two chairs has the room and a fanned hand wants it.
 *
 * Blackjack hands are small (two to five cards) and every card is face up, so they overlap far less
 * than an UNO fan: enough to read as a dealt hand, little enough that every rank and suit stays
 * visible. At `sm` the value is tighter for the reason above — four chairs share one row.
 */
const OVERLAP = { sm: 0.44, md: 0.36 } as const;

/**
 * How many degrees apart consecutive cards sit in the fan.
 *
 * **THE FAN IS THE DIFFERENCE BETWEEN A HAND AND A STACK.** The cards were drawn perfectly square
 * and perfectly overlapped, which is what a dealt hand looks like face-down on a table and not what
 * one looks like when somebody is holding it. A few degrees per card is all it takes, and it costs
 * nothing at two cards (±2.5°) while making a five-card hand read instantly as five.
 *
 * **IT CANNOT GO ON THE ANIMATED ELEMENT.** `animate-deal` keyframes `transform`, so a rotation on
 * the same element is REPLACED for the length of the animation and then snaps back into place —
 * every dealt card would straighten out and then bend. That is the trap UNO's `SeatView` documents
 * and the spinning direction ring hit for real, so the rotation gets an element of its own between
 * the animated wrapper and the art.
 */
const FAN_STEP_DEG = { sm: 3.5, md: 5 } as const;

export type HandSize = keyof typeof CARD_H_REM;

export function Hand({
  cards,
  faceDown = 0,
  size = 'md',
  className,
}: {
  readonly cards: readonly Card[];
  /** How many face-down backs to draw after the cards — the dealer's undealt-to-us hole card. */
  readonly faceDown?: number;
  readonly size?: HandSize;
  /** Layout only. */
  readonly className?: string;
}) {
  // The player's equipped card back — the hole card is drawn with the one they chose in the store,
  // not a hardcoded colour. The game passes the id; `cardBackSrc` owns the art.
  const back = useEquippedCardBack();

  const heightRem = CARD_H_REM[size];
  const widthRem = heightRem * CARD_RATIO;
  const overlapRem = widthRem * OVERLAP[size];
  const total = cards.length + faceDown;

  /**
   * The fan angle for card `i`, centred on the hand: a two-card hand splays ±half a step, a
   * five-card hand ±two. Zero for a single card, which is what a lone up-card should look like.
   */
  const angleDeg = (i: number): number =>
    total <= 1 ? 0 : (i - (total - 1) / 2) * FAN_STEP_DEG[size];

  /**
   * A SHORT STAGGER ON THE OPENING TWO CARDS ONLY.
   *
   * `animate-deal` runs when an element MOUNTS, so a new card animates and the ones already on the
   * table do not — which is what makes a hit look like one card arriving. Staggering by index would
   * therefore be wrong for every card after the deal: a hit is the third card, so it would sit
   * invisible for 180ms before appearing, and at a real table a hit is the fastest thing that
   * happens. The opening sweep is the only moment several cards mount at once, so it is the only
   * moment that gets a stagger.
   */
  const delayMs = (i: number): number => (i < 2 ? i * 90 : 0);

  const face = (src: string, alt: string, i: number) => (
    <div
      key={`${alt}-${String(i)}`}
      // Two elements, two concerns: the wrapper carries the placement and the deal animation, the
      // image carries the art. `animate-deal` keyframes `transform`, so anything transformed on the
      // SAME element would be replaced for the length of the animation — the trap UNO's SeatView
      // documents. The overlap here is a margin rather than a translate for that reason.
      className="animate-deal shrink-0"
      style={{
        marginLeft: i === 0 ? undefined : `${String(-overlapRem)}rem`,
        animationDelay: `${String(delayMs(i))}ms`,
        zIndex: i,
      }}
    >
      {/* THE ROTATOR — its own element, and that is not tidiness. See `FAN_STEP_DEG`: sharing an
          element with `animate-deal` would have the keyframe overwrite the fan mid-deal. Pivoting
          at the BOTTOM keeps the cards' lower edges together and splays the tops, which is how a
          hand held in a hand actually opens. */}
      <div
        style={{
          transform: `rotate(${String(angleDeg(i))}deg)`,
          transformOrigin: 'bottom center',
        }}
      >
        <img
          src={src}
          alt={alt}
          width={140}
          height={190}
          className="border-bw-line/70 shadow-lift w-auto rounded-md border"
          style={{ height: `${String(heightRem)}rem` }}
        />
      </div>
    </div>
  );

  return (
    <div
      className={cx('flex items-end', className)}
      // A hair over one card: the fan pivots at the bottom, so the outermost cards lift their far
      // corners above the flat height. Without the margin the tops clip whatever sits above.
      style={{ minHeight: `${String(heightRem * 1.06)}rem` }}
    >
      {total === 0 && (
        // The empty box is where cards will land — a chair with nothing dealt is still a place at
        // the table, and a row that collapses to zero height makes the whole arc jump on the deal.
        <div
          className="border-bw-line/40 rounded-md border border-dashed"
          style={{ height: `${String(heightRem)}rem`, width: `${String(widthRem)}rem` }}
        />
      )}
      {cards.map((card, i) => face(cardSrc(card), `${card.rank} of ${card.suit}`, i))}
      {Array.from({ length: faceDown }, (_, i) =>
        face(cardBackSrc(back), 'Face-down card', cards.length + i)
      )}
    </div>
  );
}
