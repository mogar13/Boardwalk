import { cx } from '@/ui';
import { unoCardSrc } from '@/games/uno/art';
import { handOverlapRem } from '@/games/uno/seatLayout';
import type { Card } from '@boardwalk/game-logic/games/uno';

/**
 * YOUR HAND — a fan you play out of, which is the half of v1's board that a row of separate cards
 * cannot reproduce. Three things do the work, and all three came from playing the old one:
 *
 *   1. THE FAN. Cards overlap, so a hand reads as a hand and its width barely grows. `handOverlapRem`
 *      tightens it as the hand grows (see there); `overflow-x-auto` is the backstop past that.
 *   2. THE LIFT. Hovering raises a card clear of its neighbours AND above them (`z-index`), so you
 *      can see the card you are about to play. Without the z-index the card lifts BEHIND the next
 *      one, which looks broken and was v1's `z-index: 100 !important`.
 *   3. PLAYABILITY AT A GLANCE. A card you can legally play is lit; one you cannot is dimmed and
 *      not liftable. In a game whose whole skill is "what can I put on this", making the player
 *      re-derive the match rule for every card is the interface doing nothing.
 *
 * The lit ring is PRIMARY (blue = act), not secondary. The board's cyan is "here" — whose turn it
 * is, where you are sitting — and a playable card is a verb, not a location. The previous board used
 * cyan for both, which spent the distinction the glow budget exists to keep.
 */

export interface HandViewProps {
  readonly cards: readonly Card[];
  readonly myTurn: boolean;
  /** Which cards the rules allow right now — computed by the board, which owns `canPlay`. */
  readonly isPlayable: (card: Card) => boolean;
  readonly onPlay: (card: Card) => void;
  /** The card whose colour is being chosen — held up out of the fan while the picker is open. */
  readonly pendingId: string | null;
}

export function HandView({ cards, myTurn, isPlayable, onPlay, pendingId }: HandViewProps) {
  const overlap = handOverlapRem(cards.length);

  return (
    <div className="flex w-full justify-center overflow-x-auto px-4 pt-8 pb-2">
      <div className="flex shrink-0 items-end">
        {cards.map((card, i) => {
          const playable = myTurn && isPlayable(card);
          const held = card.id === pendingId;
          return (
            <button
              key={card.id}
              type="button"
              disabled={!myTurn}
              onClick={() => {
                onPlay(card);
              }}
              aria-label={cardName(card)}
              className={cx(
                'relative shrink-0 rounded-md transition duration-150',
                'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-secondary',
                // Unplayable cards recede on OPACITY ALONE. Desaturating them too (the first pass
                // did) drains the one thing that tells four overlapping cards apart in a game
                // about colour, and a fan of them read as a single grey blob rather than a hand.
                playable
                  ? 'hover:z-30 hover:-translate-y-5 cursor-pointer'
                  : 'cursor-default opacity-70',
                held && '-translate-y-5 z-30'
              )}
              style={{
                marginLeft: i === 0 ? 0 : `-${String(overlap)}rem`,
                // Later cards sit on top, so the fan reads left-to-right like a held hand. Hover
                // and the held card override this with a higher z-index above.
                zIndex: i,
              }}
            >
              <img
                src={unoCardSrc(card)}
                alt=""
                aria-hidden
                className={cx(
                  'h-28 w-auto rounded-md sm:h-32',
                  playable && 'ring-primary shadow-glow-primary ring-2'
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A card as its accessible name — the fan is images, so this is the only thing a reader gets. */
function cardName(card: Card): string {
  if (card.kind === 'wild') return 'Wild';
  if (card.kind === 'wild4') return 'Wild draw four';
  const face =
    card.kind === 'number'
      ? String(card.value)
      : card.kind === 'skip'
        ? 'skip'
        : card.kind === 'reverse'
          ? 'reverse'
          : 'draw two';
  return `${card.color} ${face}`;
}
