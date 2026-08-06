import { Card, cx } from '@/ui';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_COUNT,
  completionPct,
  type Achievement,
  type ChainRef,
} from '@boardwalk/game-logic';
import { useProfile } from '@/system/profile/useProfile';
import { medalSrc } from '@/system/progress/medals';

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

/**
 * The medal shown for each tier — metallic, not neon, so it stays inside the glow budget.
 *
 * REAL ART, not the `🥉🥈🥇🏆` emoji this used to be. A tier is the one thing on this shelf that
 * must read as an ORDERED ladder at a glance, and emoji are rendered by whatever font the OS
 * supplies — so the four came out as four unrelated pictures on some platforms and four flat
 * blobs on others. `medalSrc` resolves one curated set, so bronze→platinum is visibly one family
 * climbing. See `@/system/progress/medals` for why this is art and not a cosmetic kind.
 */

/**
 * The chains in first-appearance order — the render order for the sections.
 *
 * The heading comes off the catalogue (`chain.label`), not a map kept here. It used to be a
 * `Record<chainId, string>` in this file with a `?? chain` fallback, which meant adding a chain
 * and forgetting the row rendered "liars-dice" as a heading and nothing went red. The label now
 * arrives welded to the id it labels.
 */
function chainOrder(): readonly ChainRef[] {
  const seen: ChainRef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (a.chain !== undefined && !seen.some((c) => c.id === a.chain?.id)) seen.push(a.chain);
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
          const rungs = ACHIEVEMENTS.filter((a) => a.chain?.id === chain.id);
          const done = rungs.filter((a) => a.id in profile.achievements).length;
          return (
            <section key={chain.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-base-content text-xs font-semibold tracking-[0.08em] uppercase">
                  {chain.label}
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
                      {/* OPACITY ALONE on a locked tier — NOT `grayscale`, which is what the emoji
                          version used and what this first copied. With real art that was actively
                          wrong: a fresh account has every rung locked, and full desaturation made
                          bronze, silver, gold and platinum four identical grey discs. That erases
                          the exact property the art was brought in for — the ladder has to read as
                          ORDERED at a glance, and its order is carried by the metal. Dimming says
                          "not yet" while leaving the rung legible; desaturating says "not yet" by
                          deleting which rung it is. Caught by looking at the shelf, which no test
                          here can do. */}
                      <img
                        src={medalSrc(a.tier ?? 'bronze')}
                        alt=""
                        aria-hidden
                        className={cx('h-8 w-auto', !unlocked && 'opacity-40')}
                      />
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
