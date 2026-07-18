/**
 * The thing itself — an emoji, the card-back art, or the title text set in the display face.
 *
 * Lifted out of the store page in P4 so the PACK REVEAL shows a pull exactly the way the shelf
 * shows the same item for sale. Two renderers for one cosmetic is how "the crown I pulled" ends up
 * looking like a different item from "the crown on the shelf".
 */
import { cardBackSrc } from '@/system/cards/cards';
import type { Cosmetic } from '@boardwalk/game-logic';
import { cx } from '@/ui';

export function CosmeticPreview({ item, large = false }: { item: Cosmetic; large?: boolean }) {
  if (item.kind === 'avatar') {
    return (
      <span className={large ? 'text-7xl' : 'text-5xl'} aria-hidden>
        {item.emoji}
      </span>
    );
  }
  if (item.kind === 'cardback') {
    return (
      <img
        src={cardBackSrc(item.id)}
        alt={`${item.name} card back`}
        width={140}
        height={190}
        className={cx(
          'border-bw-line rounded-md border object-contain shadow-md',
          large ? 'h-36 w-24' : 'h-24 w-16'
        )}
      />
    );
  }
  // title
  return (
    <span
      className={cx(
        'font-display text-base-content flex items-center font-bold tracking-[0.12em] uppercase',
        large ? 'h-36 text-2xl' : 'h-24 text-lg'
      )}
    >
      {item.name}
    </span>
  );
}
