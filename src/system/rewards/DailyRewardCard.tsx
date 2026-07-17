import { Button, Card } from '@/ui';
import { formatMoney } from '@/system/profile/money';
import { useDailyReward } from '@/system/rewards/useDailyReward';

/**
 * The daily-reward card — the hub's greeting. Claim today's payout, watch the streak climb.
 *
 * It lives on the hub, not the store, because it is the first thing a returning player should
 * see, and the money it grants is what the store then spends — the reward opens the day, the
 * store closes it. The claim button is `primary` (blue = act) because on a fresh day it is
 * the one thing to do here; once claimed, the card goes quiet and says come back tomorrow, so
 * the lit primary is never competing with a pier for attention.
 */
export function DailyRewardCard() {
  const { status, claim } = useDailyReward();
  if (status === null) return null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div className="flex flex-col gap-1">
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
