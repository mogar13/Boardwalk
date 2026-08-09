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

/** Card height in rem, by size. `md` is your own hand and the solo table; `sm` is a neighbour. */
const CARD_H_REM = { sm: 5.25, md: 7 } as const;

/**
 * How much of a card the next one covers, as a fraction of its width. Blackjack hands are small
 * (two to five cards) and every card is face up, so they overlap far less than an UNO fan — enough
 * to read as a dealt hand, little enough that every rank and suit stays visible.
 */
const OVERLAP = 0.46;

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
  const overlapRem = widthRem * OVERLAP;
  const total = cards.length + faceDown;

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
      <img
        src={src}
        alt={alt}
        width={140}
        height={190}
        className="border-bw-line/70 shadow-lift w-auto rounded-md border"
        style={{ height: `${String(heightRem)}rem` }}
      />
    </div>
  );

  return (
    <div
      className={cx('flex items-end', className)}
      style={{ minHeight: `${String(heightRem)}rem` }}
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
