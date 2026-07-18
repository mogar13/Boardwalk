/**
 * The thing itself — an emoji, the card-back art, a felt swatch, a frame ring, or the title text
 * set in the display face.
 *
 * Lifted out of the store page in P4 so the PACK REVEAL shows a pull exactly the way the shelf
 * shows the same item for sale. Two renderers for one cosmetic is how "the crown I pulled" ends up
 * looking like a different item from "the crown on the shelf".
 *
 * IT IS AN EXHAUSTIVE SWITCH, and P5 made it one. It used to be a chain of `if`s that FELL THROUGH
 * to the title renderer, so a new cosmetic kind did not fail to compile — it silently rendered its
 * name as a title, on the shelf and in the reveal, looking deliberate. That is the store-shaped
 * version of the bug this repo keeps naming: the wrong thing was spellable and nothing went red.
 * The `never` arm below means the next kind is a type error at exactly the place that must decide
 * how it looks.
 */
import { cardBackSrc } from '@/system/cards/cards';
import type { Cosmetic } from '@boardwalk/game-logic';
import { feltSrc } from '@/system/felt/felts';
import { frameTone } from '@/system/frame/frames';
import { RARITY_RING } from '@/system/store/rarity';
import { cx } from '@/ui';

export function CosmeticPreview({ item, large = false }: { item: Cosmetic; large?: boolean }) {
  switch (item.kind) {
    case 'avatar':
      return (
        <span className={large ? 'text-7xl' : 'text-5xl'} aria-hidden>
          {item.emoji}
        </span>
      );

    case 'cardback':
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

    case 'felt': {
      // A swatch of the real file, not a colour chip — what you buy is the image the table gets,
      // so previewing anything else would be a mock-up of your own product.
      const src = feltSrc(item.id);
      return src === null ? null : (
        <img
          src={src}
          alt={`${item.name} felt`}
          width={140}
          height={190}
          className={cx(
            'border-bw-line rounded-md border object-cover shadow-md',
            large ? 'h-36 w-36' : 'h-24 w-24'
          )}
        />
      );
    }

    case 'frame': {
      // The ring around a neutral placeholder glyph, drawn through the SAME `RARITY_RING` map
      // `<Avatar>` uses — so the shelf cannot show one colour and your top bar another.
      const tone = frameTone(item.id);
      return (
        <span
          className={cx(
            'inline-flex items-center justify-center rounded-full border-2 leading-none',
            large ? 'h-28 w-28 p-4 text-6xl' : 'h-20 w-20 p-3 text-4xl',
            tone !== null && RARITY_RING[tone]
          )}
          aria-hidden
        >
          🙂
        </span>
      );
    }

    case 'title':
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
}
