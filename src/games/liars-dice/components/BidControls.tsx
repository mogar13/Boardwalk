import { useState } from 'react';
import { Button, cx } from '@/ui';
import type { Bid, Face, LiarsDicePublic } from '@boardwalk/game-logic/games/liars-dice';
import { useEquippedDice } from '@/system/dice/useEquippedDice';
import { diceSrc } from '@/system/dice/dice';

const FACES: readonly Face[] = [2, 3, 4, 5, 6, 1];

/**
 * The three things you can do on your turn.
 *
 * The steppers are bounded by the DICE ON THE TABLE, not by an arbitrary cap — v1's went to a
 * hardcoded 40 regardless of how many dice existed, so you could stage a bid of forty on a table
 * of ten. Here the maximum is `state.total` and the minimum is one.
 *
 * Legality is checked as you stage, through the SAME `isLegalRaise` the referee runs (handed in as
 * `canRaise` so this component imports no rules of its own). An illegal combination disables the
 * bid button rather than erroring after the fact — the wild conversion in particular is unguessable
 * from the UI otherwise, since switching to 1s legitimately HALVES the quantity and switching away
 * doubles it, and a player who cannot see that rule will read it as a bug.
 */
export function BidControls({
  state,
  busy,
  canRaise,
  onBid,
  onChallenge,
  onSpotOn,
}: {
  state: LiarsDicePublic;
  busy: boolean;
  canRaise: (bid: Bid) => boolean;
  onBid: (quantity: number, face: Face) => void;
  onChallenge: () => void;
  onSpotOn: () => void;
}) {
  const diceId = useEquippedDice();
  const palifico = state.palificoSeat >= 0;
  const locked = palifico && state.lockedFace > 0 ? (state.lockedFace as Face) : null;

  /**
   * The staged bid is LOCAL UI state, initialised one rung above whatever is standing.
   *
   * Re-staging when someone else raises is done by REMOUNTING — the board keys this component on
   * the standing bid — rather than by syncing in an effect. `react-hooks/set-state-in-effect`
   * refuses the effect version, and it is right to: a setState in an effect body is a second render
   * pass to reach a value the first render already knew, and a `key` says "this is a different
   * staging session" declaratively instead.
   */
  const [quantity, setQuantity] = useState(Math.max(1, (state.bid?.quantity ?? 0) + 1));
  const [face, setFace] = useState<Face>(locked ?? state.bid?.face ?? 2);

  const legal = canRaise({ quantity, face });
  const hasBid = state.bid !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* quantity */}
      <div className="flex items-center justify-center gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            setQuantity((q) => Math.max(1, q - 1));
          }}
          disabled={quantity <= 1}
          aria-label="fewer dice"
        >
          −
        </Button>
        <span className="font-display w-14 text-center text-3xl tabular-nums">{quantity}</span>
        <Button
          variant="ghost"
          onClick={() => {
            setQuantity((q) => Math.min(state.total, q + 1));
          }}
          disabled={quantity >= state.total}
          aria-label="more dice"
        >
          +
        </Button>
      </div>

      {/* face */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {FACES.map((f) => {
          const disabled = locked !== null && f !== locked;
          return (
            <button
              key={f}
              type="button"
              disabled={disabled}
              onClick={() => {
                setFace(f);
              }}
              aria-label={`face ${String(f)}`}
              aria-pressed={face === f}
              className={cx(
                'rounded-box border-2 p-1 transition',
                face === f ? 'border-primary shadow-glow-primary' : 'border-transparent',
                disabled && 'opacity-30'
              )}
            >
              <img src={diceSrc(diceId, f)} alt="" className="size-9" />
              {f === 1 && !palifico && (
                <span className="text-base-content/60 block text-[10px] leading-none">wild</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="primary"
          disabled={busy || !legal}
          onClick={() => {
            onBid(quantity, face);
          }}
        >
          Bid {quantity} × {face}
        </Button>
        <Button variant="ghost" disabled={busy || !hasBid} onClick={onChallenge}>
          Liar!
        </Button>
        <Button variant="ghost" disabled={busy || !hasBid} onClick={onSpotOn}>
          Spot on
        </Button>
      </div>

      {!legal && (
        <p className="text-base-content/60 text-center text-xs">
          {face === 1 && !palifico
            ? `Switching to wilds needs at least ${String(Math.ceil((state.bid?.quantity ?? 1) / 2))}.`
            : state.bid?.face === 1 && !palifico
              ? `Leaving wilds needs at least ${String((state.bid.quantity ?? 0) * 2 + 1)}.`
              : 'Raise the count, or keep it and pick a higher face.'}
        </p>
      )}
    </div>
  );
}
