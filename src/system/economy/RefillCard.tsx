import { Button, Card } from '@/ui';
import { formatMoney } from '@boardwalk/game-logic';
import { useRefill } from '@/system/economy/useRefill';

/**
 * The bankrupt top-up (V1_FEATURE_GAPS.md #10) — the way back to a table when the bankroll is gone.
 *
 * IT RENDERS NOTHING WHEN THE PLAYER IS SOLVENT, which is most of the time and is the whole design
 * of the thing. v1's `↺ REFILL` sat in the HUD permanently, which made free money look like part
 * of the furniture; this appears only when it is the answer to a problem the player actually has,
 * and disappears the moment they can bet again. A hub with no card on it is a hub where nothing is
 * wrong.
 *
 * It sits beside the daily reward rather than in the top bar or on a table, because those are the
 * two places a broke player is not looking: the top bar has no room to explain itself, and by the
 * time you are at a table with $0 you have already been refused a bet. The hub is where you land.
 *
 * `ghost` AND NOT `primary`, deliberately. A broke player usually has a better move than this one
 * — the daily claim pays $500 and climbs, where a top-up pays $200 and is the floor — and the
 * daily card owns the page's one lit tube. Lighting a second would make the worse option shout
 * louder, and "which button is the action" is a question the design answers, not the user. The
 * unlit tube is not a demotion: the card only exists when the top-up is relevant, so it does not
 * need a glow to be found. (No new `warning` variant either — the glow budget is called nearly
 * spent, and a fifth colour for a button that appears twice a month is exactly how it overruns.)
 */
export function RefillCard() {
  const { available, grantCents, floorCents, refill } = useRefill();
  if (!available) return null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div className="flex flex-col gap-1">
        <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
          Out of chips
        </span>
        <p className="text-base-content text-sm">
          The house will stake you back to{' '}
          <span data-money className="text-accent font-semibold">
            {formatMoney(floorCents)}
          </span>
          . Once a day, and only when you have run out.
        </p>
      </div>

      <Button variant="ghost" onClick={refill}>
        Take {formatMoney(grantCents)}
      </Button>
    </Card>
  );
}
