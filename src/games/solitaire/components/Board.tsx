import { useState } from 'react';
import { cx } from '@/ui';
import { useEquippedCardBack } from '@/system/cards/useCardBack';
import type { SoundName } from '@/system/audio/sounds';
import { CardView, EmptySlot } from '@/games/solitaire/components/CardView';
import {
  type Action,
  type Card,
  type Pile,
  type SolitaireState,
  liftable,
} from '@/games/solitaire/logic/solitaire';

/**
 * The play surface — the only part of Solitaire that is not tested pure logic. It draws the state
 * and turns clicks into the reducer's `Pile`-typed moves; every rule (what stacks, what lifts, what
 * wins) is imported from `logic/`, so this component only decides which pure action to dispatch and
 * when to make a sound.
 *
 * INTERACTION: click-to-move, not drag. Clicking a face-up card with nothing selected picks it up
 * (and its run); clicking again drops it — onto a card, its whole pile is the target; onto an empty
 * slot, that slot. A double-click sends the top card straight to its foundation, the one shortcut
 * worth having. The stock draws (and recycles when empty) on a single click. Selection is local UI
 * state and never leaves this component — the reducer is handed only completed moves.
 */

function samePile(a: Pile, b: Pile): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'tableau' && b.kind === 'tableau') return a.col === b.col;
  if (a.kind === 'foundation' && b.kind === 'foundation') return a.index === b.index;
  return true;
}

export function Board({
  state,
  dispatch,
  play,
}: {
  readonly state: SolitaireState;
  readonly dispatch: (action: Action) => void;
  readonly play: (name: SoundName) => void;
}) {
  const [sel, setSel] = useState<{ from: Pile; index: number } | null>(null);
  // The player's equipped card back — read once here (the board is where the profile is touched)
  // and threaded to every CardView, so the face-down stock and tableau cards draw the chosen art.
  const backId = useEquippedCardBack();

  const drawStock = () => {
    setSel(null);
    play('deal');
    dispatch({ type: 'draw' });
  };

  const moveTo = (to: Pile, from: Pile, index: number) => {
    dispatch({ type: 'move', from, fromIndex: index, to });
    play('place');
    setSel(null);
  };

  /** A click on a card: complete a pending move, toggle a selection off, or pick a new source up. */
  const clickCard = (pile: Pile, index: number, card: Card) => {
    if (sel !== null) {
      if (samePile(sel.from, pile) && sel.index === index) {
        setSel(null); // clicking the held card puts it back down
        return;
      }
      moveTo(pile, sel.from, sel.index);
      return;
    }
    if (card.faceUp && liftable(state, pile, index) !== null) {
      play('deal');
      setSel({ from: pile, index });
    }
  };

  /** A double-click sends a top card to its foundation. */
  const autoCard = (pile: Pile) => {
    setSel(null);
    play('place');
    dispatch({ type: 'auto', from: pile });
  };

  /** A click on an empty slot only matters when a card is in hand. */
  const clickEmpty = (to: Pile) => {
    if (sel !== null) moveTo(to, sel.from, sel.index);
  };

  const isSelected = (pile: Pile, index: number): boolean =>
    sel !== null && samePile(sel.from, pile) && index >= sel.index;

  const wasteTop = state.waste[state.waste.length - 1];

  return (
    <div className="flex flex-col gap-6">
      {/* Top row: stock + waste on the left, the four foundations on the right. */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-2">
          {state.stock.length > 0 ? (
            <CardView
              card={state.stock[state.stock.length - 1] as Card}
              backId={backId}
              onClick={drawStock}
            />
          ) : (
            <EmptySlot label="↻" onClick={drawStock} />
          )}
          {wasteTop !== undefined ? (
            <CardView
              card={wasteTop}
              backId={backId}
              selected={isSelected({ kind: 'waste' }, state.waste.length - 1)}
              onClick={() => clickCard({ kind: 'waste' }, state.waste.length - 1, wasteTop)}
              onDoubleClick={() => autoCard({ kind: 'waste' })}
            />
          ) : (
            <EmptySlot />
          )}
        </div>

        <div className="flex gap-2">
          {state.foundations.map((pile, index) => {
            const top = pile[pile.length - 1];
            const to: Pile = { kind: 'foundation', index };
            return top !== undefined ? (
              <CardView
                key={index}
                card={top}
                backId={backId}
                selected={isSelected(to, pile.length - 1)}
                onClick={() => clickCard(to, pile.length - 1, top)}
              />
            ) : (
              <EmptySlot key={index} onClick={sel !== null ? () => clickEmpty(to) : undefined} />
            );
          })}
        </div>
      </div>

      {/* The seven tableau columns. */}
      <div className="grid grid-cols-7 gap-2 sm:gap-3">
        {state.tableau.map((col, colIndex) => {
          const to: Pile = { kind: 'tableau', col: colIndex };
          return (
            <div key={colIndex} className="flex flex-col items-center">
              {col.length === 0 ? (
                <EmptySlot onClick={sel !== null ? () => clickEmpty(to) : undefined} />
              ) : (
                col.map((card, cardIndex) => (
                  <div
                    key={cardIndex}
                    style={{ marginTop: cardIndex === 0 ? 0 : card.faceUp ? '-3.6rem' : '-4.4rem' }}
                    className={cx(cardIndex > 0 && 'relative')}
                  >
                    <CardView
                      card={card}
                      backId={backId}
                      selected={isSelected(to, cardIndex)}
                      onClick={() => clickCard(to, cardIndex, card)}
                      onDoubleClick={
                        cardIndex === col.length - 1 ? () => autoCard(to) : undefined
                      }
                    />
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
