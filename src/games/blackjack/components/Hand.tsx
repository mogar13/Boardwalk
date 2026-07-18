import { cardBackSrc, cardSrc } from '@/system/cards/cards';
import { useEquippedCardBack } from '@/system/cards/useCardBack';
import { cx } from '@/ui';
import type { Card } from '@boardwalk/game-logic/games/blackjack';

/**
 * A row of cards — the one place a logic `Card` becomes an image. It hands the card straight to
 * `cardSrc` from `@/system/cards`: the logic model and the art model are separate types (the
 * purity rule keeps `logic/` from importing `system/`), but their suit/rank literals are identical,
 * so this assignment is what proves at compile time that they still line up.
 *
 * `faceDown` is a COUNT of backs to draw after the cards, and that shape is the shape of the
 * dealt-hand seam. It used to be `hideIndex` — an index into a full dealer hand whose hole card the
 * client held and merely declined to render. Since Phase D the client does not hold it: an unsettled
 * `HandView.dealer` carries exactly one card, and the gap where the second one will be is drawn as
 * a back because there is genuinely nothing there. The prop changed so the component could not keep
 * expressing "I have this card and am hiding it", which is the claim that stopped being true.
 */
export function Hand({
  cards,
  faceDown = 0,
  label,
}: {
  readonly cards: readonly Card[];
  /** How many face-down backs to draw after the cards — the dealer's undealt-to-us hole card. */
  readonly faceDown?: number;
  readonly label: string;
}) {
  // The player's equipped card back — the hole card is drawn with the one they chose in the store,
  // not a hardcoded colour. The game passes the id; `cardBackSrc` owns the art. See useEquippedCardBack.
  const back = useEquippedCardBack();
  return (
    <div className="flex flex-col gap-2">
      <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.14em] uppercase">
        {label}
      </span>
      <div className="flex min-h-[7.5rem] items-end">
        {cards.length === 0 && faceDown === 0 && (
          <div className="border-bw-line h-28 w-20 rounded-lg border border-dashed" />
        )}
        {cards.map((card, i) => (
          <img
            key={`up-${String(i)}`}
            src={cardSrc(card)}
            alt={`${card.rank} of ${card.suit}`}
            width={140}
            height={190}
            className={cx(
              'border-bw-line h-28 w-20 rounded-lg border object-contain shadow-md',
              i > 0 && '-ml-10'
            )}
          />
        ))}
        {Array.from({ length: faceDown }, (_, i) => (
          <img
            key={`down-${String(i)}`}
            src={cardBackSrc(back)}
            alt="Face-down card"
            width={140}
            height={190}
            className={cx(
              'border-bw-line h-28 w-20 rounded-lg border object-contain shadow-md',
              (cards.length > 0 || i > 0) && '-ml-10'
            )}
          />
        ))}
      </div>
    </div>
  );
}
