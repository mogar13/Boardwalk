import { Button, Card } from '@/ui';
import { useAuth, useIsAdmin } from '@/system/auth/useAuth';
import { formatMoney, useProfile } from '@/system/profile/useProfile';
import { xpProgress } from '@/system/profile/xp';

/**
 * The signed-in player, in full. The top bar (`src/shell/TopBar`) shows a compact version
 * of the same facts; this is the profile route's expanded card, with the XP meter the top
 * bar has no room for.
 *
 * Phase 2's proof still holds here: the record came back from RTDB, through `ProfileRepo`,
 * into the store, and the bankroll below is real. What Phase 3 changed is `level` — it is
 * no longer a stored field, it is `xpProgress(profile.xp).level`, computed the same way
 * everywhere it appears so the badge and the bar can never disagree.
 */
export function ProfileCard() {
  const { session, signOut } = useAuth();
  const profile = useProfile();
  const isAdmin = useIsAdmin();

  if (session === null || profile === null) return null;

  const { level, into, needed, pct } = xpProgress(profile.xp);

  return (
    <Card className="flex flex-col gap-6 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <span className="text-4xl" aria-hidden>
            {profile.avatar}
          </span>
          <div className="flex flex-col gap-1">
            <span className="font-display text-base-content text-lg font-semibold tracking-[0.08em]">
              {profile.name}
            </span>
            <span className="text-bw-muted text-xs">
              Level {level}
              {/* Hiding a badge is cosmetic. `admins/<uid>` and database.rules.json are
                  what actually stop a non-admin's writes — this only renders a fact the
                  server already decided. v1 shipped two backdoors by getting that
                  backwards. */}
              {isAdmin && ' · admin'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-1">
            <span className="font-display text-bw-muted text-[0.65rem] font-semibold tracking-[0.2em] uppercase">
              Bankroll
            </span>
            {/* Gold, once, and only here on this card. It is money — that is the whole
                rule. `data-money` gives tabular figures from the theme, so a ticking
                balance does not reflow on every digit the way v1's HUD does. */}
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
      </div>

      {/* The XP meter. Cyan, not gold — progress is "here", not money — and it does not
          glow: the room stays dark, and a filling bar is furniture, not a sign. `into` and
          `needed` come from the same `xpProgress` call as `level`, so there is one source
          for the badge and the bar both. */}
      <div className="flex flex-col gap-1.5">
        <div className="text-bw-muted flex items-center justify-between text-xs">
          <span className="font-display font-semibold tracking-[0.2em] uppercase">
            Level {level}
          </span>
          <span data-money>
            {into.toLocaleString('en-US')} / {needed.toLocaleString('en-US')} XP
          </span>
        </div>
        <div
          className="bg-base-300 border-bw-line inset-shadow-well h-2 w-full overflow-hidden rounded-full border"
          role="progressbar"
          aria-valuenow={Math.round(pct * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Level ${String(level)} progress`}
        >
          <div
            className="bg-secondary h-full rounded-full transition-[width] duration-500 ease-strike"
            style={{ width: `${String(Math.round(pct * 100))}%` }}
          />
        </div>
      </div>
    </Card>
  );
}
