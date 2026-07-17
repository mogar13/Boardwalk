import { Card, cx } from '@/ui';
import { ACHIEVEMENTS } from '@/system/progress/achievements';
import { useProfile } from '@/system/profile/useProfile';

/**
 * The badge shelf — every achievement, earned or not. Locked ones show their goal in grey; earned
 * ones show in full colour with the date they fired. `big_win` sits here with a real unlock path
 * for the first time in this project's lineage.
 *
 * No glow. An achievement is a moment, not a sign, and the glow budget is blue/cyan/gold — so
 * earned-vs-locked is carried by colour-vs-grayscale and a faint border, never by lighting a badge
 * up. The theme keeps the room dark; the furniture does not shine.
 */
export function AchievementShelf() {
  const profile = useProfile();
  if (profile === null) return null;

  const earned = ACHIEVEMENTS.filter((a) => a.id in profile.achievements).length;

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-base-content text-sm font-semibold tracking-[0.2em] uppercase">
          Achievements
        </h2>
        <span className="text-bw-muted font-display text-xs font-semibold tabular-nums">
          {earned} / {ACHIEVEMENTS.length}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ACHIEVEMENTS.map((a) => {
          const unlockedAt = profile.achievements[a.id];
          const unlocked = unlockedAt !== undefined;
          return (
            <div
              key={a.id}
              className={cx(
                'rounded-box flex flex-col items-center gap-1.5 border p-4 text-center',
                unlocked ? 'border-bw-line-strong bg-base-300' : 'border-bw-line'
              )}
            >
              <span className={cx('text-3xl', !unlocked && 'opacity-40 grayscale')} aria-hidden>
                {a.emoji}
              </span>
              <span
                className={cx(
                  'font-display text-xs font-semibold tracking-[0.06em]',
                  unlocked ? 'text-base-content' : 'text-bw-muted'
                )}
              >
                {a.name}
              </span>
              <span className="text-bw-muted text-[0.7rem] leading-tight">
                {unlocked ? new Date(unlockedAt).toLocaleDateString() : a.description}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
