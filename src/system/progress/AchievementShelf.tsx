import { Card, cx } from '@/ui';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_COUNT,
  completionPct,
  type Achievement,
  type Tier,
} from '@/system/progress/achievements';
import { useProfile } from '@/system/profile/useProfile';

/**
 * The badge shelf — every achievement, earned or not, now grouped into the P3 chains. A chain is a
 * Bronze→Platinum ladder rendered as a row of four tiers, so the next tier is always visibly just
 * out of reach; the standalone milestones and the feats sit below. A completion % rides the header,
 * for the people who 100% for the number.
 *
 * No glow. An achievement is a moment, not a sign, and the glow budget is blue/cyan/gold — so
 * earned-vs-locked is carried by colour-vs-grayscale and a faint border, never by lighting a badge
 * up, and the tier is carried by a medal emoji, never a new neon. The theme keeps the room dark;
 * the furniture does not shine.
 *
 * HIDDEN achievements render as "???" until earned — the goal is withheld on purpose, so the first
 * time one fires it is a discovery. Only its earned state reveals its name and face.
 */

/** The medal shown for each tier — metallic, not neon, so it stays inside the glow budget. */
const TIER_MEDAL: Record<Tier, string> = { bronze: '🥉', silver: '🥈', gold: '🥇', platinum: '🏆' };

/** A chain id → its section title. Derived copy, kept next to the shelf that renders it. */
const CHAIN_TITLE: Record<string, string> = {
  wins: 'Wins',
  level: 'Level',
  bankroll: 'Bankroll',
  chess: 'Chess Mastery',
  blackjack: 'Blackjack Mastery',
};

/** Chain ids in first-appearance order — the render order for the chain sections. */
function chainOrder(): readonly string[] {
  const seen: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (a.chain !== undefined && !seen.includes(a.chain)) seen.push(a.chain);
  }
  return seen;
}

export function AchievementShelf() {
  const profile = useProfile();
  if (profile === null) return null;

  const earnedAt = (a: Achievement): number | undefined => profile.achievements[a.id];
  const earnedCount = ACHIEVEMENTS.filter((a) => a.id in profile.achievements).length;
  const pct = completionPct(earnedCount);

  const chains = chainOrder();
  // Everything not in a chain — the standalone milestones and the feats — in catalogue order.
  const looseBadges = ACHIEVEMENTS.filter((a) => a.chain === undefined);

  return (
    <Card className="flex flex-col gap-6 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-base-content text-sm font-semibold tracking-[0.2em] uppercase">
          Achievements
        </h2>
        <span className="text-bw-muted font-display text-xs font-semibold tabular-nums">
          {earnedCount} / {ACHIEVEMENT_COUNT} · {pct}%
        </span>
      </div>

      {/* Chains — each a Bronze→Platinum row */}
      <div className="flex flex-col gap-5">
        {chains.map((chain) => {
          const rungs = ACHIEVEMENTS.filter((a) => a.chain === chain);
          const done = rungs.filter((a) => a.id in profile.achievements).length;
          return (
            <section key={chain} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-base-content text-xs font-semibold tracking-[0.08em] uppercase">
                  {CHAIN_TITLE[chain] ?? chain}
                </h3>
                <span className="text-bw-muted text-[0.7rem] font-semibold tabular-nums">
                  {done} / {rungs.length}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {rungs.map((a) => {
                  const unlockedAt = earnedAt(a);
                  const unlocked = unlockedAt !== undefined;
                  return (
                    <div
                      key={a.id}
                      className={cx(
                        'rounded-box flex flex-col items-center gap-1 border p-3 text-center',
                        unlocked ? 'border-bw-line-strong bg-base-300' : 'border-bw-line'
                      )}
                    >
                      <span
                        className={cx('text-2xl', !unlocked && 'opacity-40 grayscale')}
                        aria-hidden
                      >
                        {TIER_MEDAL[a.tier ?? 'bronze']}
                      </span>
                      <span
                        className={cx(
                          'font-display text-[0.7rem] font-semibold tracking-[0.04em]',
                          unlocked ? 'text-base-content' : 'text-bw-muted'
                        )}
                      >
                        {a.name}
                      </span>
                      <span className="text-bw-muted text-[0.65rem] leading-tight">
                        {unlocked ? new Date(unlockedAt).toLocaleDateString() : a.description}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* Standalone milestones + feats (one hidden until earned) */}
      <section className="flex flex-col gap-2">
        <h3 className="text-base-content text-xs font-semibold tracking-[0.08em] uppercase">
          Feats &amp; Milestones
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {looseBadges.map((a) => {
            const unlockedAt = earnedAt(a);
            const unlocked = unlockedAt !== undefined;
            // Hidden and not yet earned: withhold the name, face and goal — a locked mystery.
            const concealed = a.hidden === true && !unlocked;
            return (
              <div
                key={a.id}
                className={cx(
                  'rounded-box flex flex-col items-center gap-1.5 border p-4 text-center',
                  unlocked ? 'border-bw-line-strong bg-base-300' : 'border-bw-line'
                )}
              >
                <span className={cx('text-3xl', !unlocked && 'opacity-40 grayscale')} aria-hidden>
                  {concealed ? '❓' : a.emoji}
                </span>
                <span
                  className={cx(
                    'font-display text-xs font-semibold tracking-[0.06em]',
                    unlocked ? 'text-base-content' : 'text-bw-muted'
                  )}
                >
                  {concealed ? '???' : a.name}
                </span>
                <span className="text-bw-muted text-[0.7rem] leading-tight">
                  {unlocked
                    ? new Date(unlockedAt).toLocaleDateString()
                    : concealed
                      ? 'Hidden — discover it in play.'
                      : a.description}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </Card>
  );
}
