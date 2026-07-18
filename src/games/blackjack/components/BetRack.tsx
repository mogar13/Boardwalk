import { Button, Card } from '@/ui';
import { useAudio } from '@/system/audio/useAudio';
import { useBet } from '@/system/economy/useBet';
import { formatMoney } from '@boardwalk/game-logic';

/** $5 / $25 / $100 — the chips on the felt. */
const CHIPS = [500, 2500, 10000] as const;

/**
 * The chip rack: stage a wager, then send it to the dealer.
 *
 * IT STAGES AND IT NO LONGER COMMITS. `useBet()` still owns the amount, the table's min/max from
 * the manifest, and the affordability message under the chips — that is feel, and feel wants to be
 * instant and local. What it does NOT do here any more is `commit()`: the wager leaves the bankroll
 * when the referee takes it inside `/blackjack/deal`, in the same transaction that shuffles the
 * deck. Committing here too would deduct the stake twice — once optimistically, once for real.
 *
 * So this is the honest division of the two halves `useBet` always had: the rack is a control, and
 * the deduction is a consequence of a hand being dealt. `onDeal` hands the staged cents up; nothing
 * on this screen knows what happens to them next.
 */
export function BetRack({
  onDeal,
  disabled,
}: {
  readonly onDeal: (wagerCents: number) => void;
  readonly disabled: boolean;
}) {
  const bet = useBet();
  const { play } = useAudio();

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.14em] uppercase">
          Your bet
        </span>
        <span data-money className="font-display text-accent text-2xl font-bold tracking-tight">
          {formatMoney(bet.amountCents)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <Button
            key={chip}
            variant="ghost"
            size="sm"
            disabled={bet.amountCents + chip > bet.maxCents && bet.amountCents >= bet.maxCents}
            onClick={() => {
              play('chip');
              bet.add(chip);
            }}
          >
            +{formatMoney(chip)}
          </Button>
        ))}
        <Button variant="quiet" size="sm" onClick={() => bet.set(bet.maxCents)}>
          Max
        </Button>
        <Button variant="quiet" size="sm" onClick={bet.clear}>
          Clear
        </Button>
      </div>

      {!bet.check.ok && <p className="text-bw-muted text-sm">{bet.check.error}</p>}

      <Button
        variant="primary"
        disabled={!bet.canCommit || disabled}
        onClick={() => {
          play('shuffle');
          play('deal');
          onDeal(bet.amountCents);
        }}
      >
        {disabled ? 'Dealing…' : 'Deal'}
      </Button>
    </Card>
  );
}
