import { cardBackSrc, cardSrc } from '@/system/cards/cards';
import { cx } from '@/ui';
import type { Card } from '@/games/solitaire/logic/solitaire';

/**
 * One card on the felt — the single place a logic `Card` becomes an image. It hands the card
 * straight to `cardSrc` from `@/system/cards`: the logic model and the art model are separate types
 * (the purity rule keeps `logic/` from importing `system/`), but their suit/rank literals are
 * identical, so this assignment is what proves at compile time that they still line up. A face-down
 * card draws a real card-back, not a CSS rectangle, so the flip is a genuine turn of the same
 * object. `selected` lifts the card and rings it, the cue that it (and its run) is the lift in hand.
 */
export function CardView({
  card,
  selected = false,
  backId,
  onClick,
  onDoubleClick,
}: {
  readonly card: Card;
  readonly selected?: boolean;
  /** The player's equipped card-back id, threaded from the board (which reads the profile) so the
   *  face-down art is the one they chose. Undefined → the default back, via `cardBackSrc`. */
  readonly backId?: string;
  readonly onClick?: (() => void) | undefined;
  readonly onDoubleClick?: (() => void) | undefined;
}) {
  const interactive = onClick !== undefined || onDoubleClick !== undefined;
  return (
    <img
      src={card.faceUp ? cardSrc(card) : cardBackSrc(backId)}
      alt={card.faceUp ? `${card.rank} of ${card.suit}` : 'Face-down card'}
      width={140}
      height={190}
      draggable={false}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cx(
        'border-bw-line h-24 w-16 rounded-md border object-contain shadow-md sm:h-28 sm:w-20',
        interactive && 'cursor-pointer',
        selected && 'ring-secondary -translate-y-1 shadow-lg ring-2'
      )}
    />
  );
}

/** An empty pile slot — a dashed frame that also serves as a drop target. */
export function EmptySlot({
  label,
  onClick,
}: {
  readonly label?: string;
  readonly onClick?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={onClick === undefined}
      className={cx(
        'border-bw-line text-bw-muted flex h-24 w-16 items-center justify-center rounded-md border border-dashed text-xs sm:h-28 sm:w-20',
        onClick !== undefined && 'hover:border-bw-line-strong cursor-pointer'
      )}
    >
      {label}
    </button>
  );
}
