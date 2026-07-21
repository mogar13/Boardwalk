import { NavLink } from 'react-router-dom';
import { Button, cx } from '@/ui';
import { useAuth } from '@/system/auth/useAuth';
import { useAudio } from '@/system/audio/useAudio';
import { formatMoney, useProfile } from '@/system/profile/useProfile';
import { rankForLevel, xpProgress } from '@boardwalk/game-logic';
import { Wordmark } from '@/shell/Wordmark';
import { Avatar } from '@/system/profile/Avatar';
import { useEquippedFrame } from '@/system/frame/useEquippedFrame';

/**
 * The pier's top bar. v1's HUD, but injected ONCE by the shell instead of by each of 31
 * games calling `SystemUI.init()` — and it is where level/XP finally show, which v1 could
 * not: v1 defined `#xp-bar-fill` in `system_ui.css`, a stylesheet the hub did not link, so
 * XP was invisible in-game and re-declared in `hub-style.css`. Here there is one bar, in
 * one place, reading one store.
 *
 * DOG FOOD, like every file outside `src/ui`: both Phase 1 lint rules apply in full. No raw
 * DaisyUI class, no colour — the kit and semantic tokens only. `data-money` (from the
 * theme) gives the bankroll tabular figures so it does not reflow as it ticks.
 */

/** Cyan = "here". The active route glows the way the focus ring does — one meaning, one colour. */
const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    'font-display text-sm font-semibold tracking-[0.14em] uppercase transition-colors duration-200 ease-strike',
    isActive ? 'text-secondary' : 'text-bw-muted hover:text-base-content'
  );

/**
 * The mute toggle. Always shown — audio is a page-global concern, not a signed-in one — and the
 * one non-money glyph in the bar. Unmuting plays a `click` for immediate feedback (the toggle
 * itself is the gesture that unlocks the browser's audio); muting is silent, because a sound
 * confirming "sounds off" is a contradiction. `aria-pressed` makes it a real toggle to a screen
 * reader rather than a mystery button.
 */
function MuteToggle() {
  const { muted, toggleMute, play } = useAudio();
  return (
    <Button
      variant="quiet"
      size="sm"
      aria-pressed={muted}
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      title={muted ? 'Sound off' : 'Sound on'}
      onClick={() => {
        const willUnmute = muted;
        toggleMute();
        if (willUnmute) play('click');
      }}
    >
      <span aria-hidden className="text-base">
        {muted ? '🔇' : '🔊'}
      </span>
    </Button>
  );
}

/**
 * The compact level badge + XP sliver. The profile page draws the full meter; this is the glance.
 *
 * The RANK rides in the tooltip rather than the bar, and that is a space decision, not a shrug:
 * "Casino Legend" is 13 characters next to a bankroll, a name and four nav links, and the bar's
 * job here is to say "you are making progress" in one glance. The profile card is where the rank
 * is spelled out — it has the room, and it is where somebody goes to look at themselves.
 */
function LevelPip({ xp }: { xp: number }) {
  const { level, pct } = xpProgress(xp);
  return (
    <div
      className="flex items-center gap-2"
      title={`${rankForLevel(level).name} — level ${String(level)}`}
    >
      <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.14em] uppercase">
        Lv {level}
      </span>
      <div
        className="bg-base-300 border-bw-line inset-shadow-well h-1.5 w-16 overflow-hidden rounded-full border"
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
  );
}

export function TopBar() {
  const { signOut } = useAuth();
  const profile = useProfile();
  const frame = useEquippedFrame();

  return (
    <header className="border-bw-line bg-base-100/80 sticky top-0 z-20 border-b backdrop-blur">
      <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:px-10">
        {/* The sign, home. `end` so only the exact "/" is the active route, not every path. */}
        <NavLink to="/" className="shrink-0">
          <Wordmark size="sm" />
        </NavLink>

        <nav className="flex items-center gap-5">
          <NavLink to="/" end className={navLinkClass}>
            Hub
          </NavLink>
          <NavLink to="/store" className={navLinkClass}>
            Store
          </NavLink>
          <NavLink to="/leaderboard" className={navLinkClass}>
            Leaderboard
          </NavLink>
        </nav>

        {/* Everything the player owns, pushed to the right. */}
        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* Global, so it sits outside the signed-in block — a signed-out visitor can still mute. */}
          <MuteToggle />

          {profile !== null && (
            <>
              <LevelPip xp={profile.xp} />

              {/* Gold, once. It is money — the whole rule. */}
              <span
                data-money
                className="font-display text-accent text-lg font-bold tracking-tight"
              >
                {formatMoney(profile.bankrollCents)}
              </span>

              {/* Name + avatar → the profile route. A link, so it is reachable by keyboard,
                  unlike v1's div-with-onclick HUD chips. */}
              <NavLink
                to="/profile"
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-2 transition-colors duration-200 ease-strike',
                    isActive ? 'text-secondary' : 'text-base-content hover:text-secondary'
                  )
                }
              >
                <Avatar emoji={profile.avatar} size="sm" frame={frame} />
                <span className="font-display max-w-32 truncate text-sm font-semibold tracking-[0.06em]">
                  {profile.name}
                </span>
              </NavLink>

              <Button
                variant="quiet"
                size="sm"
                onClick={() => {
                  void signOut();
                }}
              >
                Sign out
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
