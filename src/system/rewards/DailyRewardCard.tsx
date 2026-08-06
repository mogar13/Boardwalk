import { Button, Card } from '@/ui';
import { formatMoney } from '@boardwalk/game-logic';
import { useDailyReward } from '@/system/rewards/useDailyReward';

/**
 * The daily-reward card — the hub's greeting. Claim today's payout, watch the streak climb.
 *
 * It lives on the hub, not the store, because it is the first thing a returning player should
 * see, and the money it grants is what the store then spends — the reward opens the day, the
 * store closes it. The claim button is `primary` (blue = act) because on a fresh day it is
 * the one thing to do here; once claimed, the card goes quiet and says come back tomorrow, so
 * the lit primary is never competing with a pier for attention.
 *
 * ONE ROW, NOT TWO. The label and the line used to stack, which cost the hub a whole row of
 * vertical space for a sentence that is usually "come back tomorrow" — dead weight on every
 * day but the one where it matters, on the page that has the least room to spare. Baseline
 * alignment keeps the small-caps label sitting on the same line as the prose, and the wrap is
 * ordinary flex behaviour: it stacks again when the row is genuinely too narrow.
 */
export function DailyRewardCard() {
  const { status, claim } = useDailyReward();
  if (status === null) return null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
          Daily reward
        </span>
        {status.claimable ? (
          <p className="text-base-content text-sm">
            {status.streakBroken && 'Streak reset. '}
            Day {status.nextStreak} — claim{' '}
            <span data-money className="text-accent font-semibold">
              {formatMoney(status.rewardCents)}
            </span>
            .
          </p>
        ) : (
          <p className="text-bw-muted text-sm">
            Claimed today — {status.streak}-day streak. Come back tomorrow to keep it going.
          </p>
        )}
      </div>

      {status.claimable && (
        <Button variant="primary" onClick={claim}>
          Claim {formatMoney(status.rewardCents)}
        </Button>
      )}
    </Card>
  );
}
