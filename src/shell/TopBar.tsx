import { NavLink } from 'react-router-dom';
import { Button, cx } from '@/ui';
import { useAuth } from '@/system/auth/useAuth';
import { useAudio } from '@/system/audio/useAudio';
import { formatMoney, useProfile } from '@/system/profile/useProfile';
import { Wordmark } from '@/shell/Wordmark';
import { Avatar } from '@/system/profile/Avatar';
import { useEquippedFrame } from '@/system/frame/useEquippedFrame';

/**
 * The pier's top bar. v1's HUD, but injected ONCE by the shell instead of by each of 31
 * games calling `SystemUI.init()`.
 *
 * WHAT IT CARRIES, AND WHAT IT DELIBERATELY STOPPED CARRYING. The bar holds what you SPEND — the
 * bankroll — plus who you are and how to leave. It used to hold a level badge and an XP sliver as
 * well (`LevelPip`, deleted), and that was the wrong home for a reason only visible once the hub
 * grew a header of its own: the hub was printing "THE BOARDWALK" under a bar already carrying the
 * wordmark, and anything it said about the player would have printed the level under a bar already
 * carrying the level. The same duplication twice.
 *
 * The fix is not to pick one of the two. Money and XP are different kinds of fact. A bankroll has
 * to be readable AT THE TABLE, because that is where it is being spent and a wager you cannot
 * afford is a decision made with that number in view. XP is never spent — it is only ever
 * reviewed, and the place you review it is the place you decide what to play next. So progression
 * moved to `Hub.tsx`'s header, where it has room for the rank name and the next rung (the pip's
 * own comment conceded it had room for neither), and the bar got its horizontal budget back.
 *
 * v1 could not have made that choice, because it could not reliably draw the bar at all: it
 * defined `#xp-bar-fill` in `system_ui.css`, a stylesheet the hub did not link, so XP was
 * invisible in-game and re-declared in `hub-style.css`. Two bars, two stylesheets, one number.
 * There is still exactly one here, reading one store; what changed is which page it is on.
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

              {/* An ICON link, not another word in the nav row. The left-hand nav names
                  destinations you go to in order to do something (a game, the store, the board);
                  settings is somewhere you go once and forget, so it sits with the account
                  controls it belongs to and spends no horizontal budget. `aria-label` carries the
                  name the glyph cannot — an emoji is decoration to a screen reader. */}
              <NavLink
                to="/settings"
                aria-label="Settings"
                title="Settings"
                className={({ isActive }) =>
                  cx(
                    'rounded-field px-1.5 py-1 text-base transition-colors duration-200 ease-strike',
                    isActive ? 'text-secondary' : 'text-bw-muted hover:text-base-content'
                  )
                }
              >
                <span aria-hidden>⚙</span>
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
