import { cardBackSrc, cardSrc } from '@/system/cards/cards';
import { cx } from '@/ui';
import type { Card } from '@/games/blackjack/logic/blackjack';

/**
 * A row of cards — the one place a logic `Card` becomes an image. It hands the card straight to
 * `cardSrc` from `@/system/cards`: the logic model and the art model are separate types (the
 * purity rule keeps `logic/` from importing `system/`), but their suit/rank literals are identical,
 * so this assignment is what proves at compile time that they still line up. A `hideIndex` card is
 * drawn face-down (the dealer's hole card) with a real card-back, not a CSS rectangle, so the
 * reveal is a genuine flip of the same object.
 */
export function Hand({
  cards,
  hideIndex = -1,
  label,
}: {
  readonly cards: readonly Card[];
  /** Index to render face-down (the hole card); `-1` (the default) shows every card. A sentinel,
   *  not an optional-undefined, to sit right with `exactOptionalPropertyTypes`. */
  readonly hideIndex?: number;
  readonly label: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.14em] uppercase">
        {label}
      </span>
      <div className="flex min-h-[7.5rem] items-end">
        {cards.length === 0 && <div className="border-bw-line h-28 w-20 rounded-lg border border-dashed" />}
        {cards.map((card, i) => {
          const faceDown = i === hideIndex;
          return (
            <img
              key={i}
              src={faceDown ? cardBackSrc('red') : cardSrc(card)}
              alt={faceDown ? 'Face-down card' : `${card.rank} of ${card.suit}`}
              width={140}
              height={190}
              className={cx(
                'border-bw-line h-28 w-20 rounded-lg border object-contain shadow-md',
                i > 0 && '-ml-10'
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
