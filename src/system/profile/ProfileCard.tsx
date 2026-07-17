import { Button, Card } from '@/ui';
import { useAuth, useIsAdmin } from '@/system/auth/useAuth';
import { formatMoney, useProfile } from '@/system/profile/useProfile';

/**
 * The signed-in player. Phase 2's other half of the proof: the record came back from RTDB,
 * through `ProfileRepo`, into the store, and the bankroll below is real.
 *
 * The top bar in Phase 3 renders roughly this. It is a card here because there is no top
 * bar yet, and inventing one now would be Phase 3's decision made in the wrong phase.
 */
export function ProfileCard() {
  const { session, signOut } = useAuth();
  const profile = useProfile();
  const isAdmin = useIsAdmin();

  if (session === null || profile === null) return null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-6 px-6 py-5">
      <div className="flex items-center gap-4">
        <span className="text-4xl" aria-hidden>
          {profile.avatar}
        </span>
        <div className="flex flex-col gap-1">
          <span className="font-display text-base-content text-lg font-semibold tracking-[0.08em]">
            {profile.name}
          </span>
          <span className="text-bw-muted text-xs">
            Level {profile.level} · {profile.xp} XP
            {/* Hiding a badge is cosmetic. `admins/<uid>` and database.rules.json are what
                actually stop a non-admin's writes — this only renders a fact the server
                already decided. v1 shipped two backdoors by getting that backwards. */}
            {isAdmin && ' · admin'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex flex-col gap-1">
          <span className="font-display text-bw-muted text-[0.65rem] font-semibold tracking-[0.2em] uppercase">
            Bankroll
          </span>
          {/* Gold, once, and only here. It is money — that is the whole rule. `data-money`
              gives tabular figures from the theme, so a ticking balance does not reflow on
              every digit the way v1's HUD does. */}
          <span data-money className="font-display text-accent text-3xl font-bold tracking-tight">
            {formatMoney(profile.bankrollCents)}
          </span>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </Button>
      </div>
    </Card>
  );
}
