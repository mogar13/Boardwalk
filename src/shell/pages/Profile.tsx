import { ProfileCard } from '@/system/profile/ProfileCard';

/**
 * The profile route. `ProfileCard` (in `src/system/profile`) is the real content — the
 * player's name, avatar, bankroll and the full XP meter, all from the Phase 2 store. The
 * top bar shows a compact version of the same facts; this is where they get room to
 * breathe, and where the XP bar the top bar only hints at is drawn in full.
 *
 * Editing the name and avatar lands here in a later phase, with the profile writer that
 * makes it more than a display. For now it is the display, and it is honest about that.
 */
export function Profile() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-base-content text-3xl font-bold tracking-[0.08em] uppercase">
          Your profile
        </h1>
        <p className="text-bw-muted max-w-2xl text-sm">
          Everything the boardwalk knows about you — and the only place, besides the top bar, that
          your bankroll appears.
        </p>
      </header>
      <ProfileCard />
    </div>
  );
}
