import { ProfileCard } from '@/system/profile/ProfileCard';
import { AchievementShelf } from '@/system/progress/AchievementShelf';
import { StatsPanel } from '@/system/progress/StatsPanel';

/**
 * The profile route. `ProfileCard` is the identity — name (now editable), avatar, bankroll and
 * the full XP meter; `StatsPanel` is the play record; `AchievementShelf` is the badges. The top
 * bar shows a compact version of the identity; this is where it, and everything Phase 4 added to
 * track, get room to breathe.
 *
 * Phase 4 made it more than a display: renaming goes through `useProfileEditor` and the avatar is
 * equipped in the store, both writing through the one `mutateProfile` path. The name and avatar
 * are the two identity edits; the rest of the page reads progress the economy writes.
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
      <StatsPanel />
      <AchievementShelf />
    </div>
  );
}
