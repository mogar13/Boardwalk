import type { Tier } from '@boardwalk/game-logic';

/**
 * Tier medal art — the id→file map for the Bronze→Platinum ladder, and it knows nothing about a
 * profile. Same split as `cards.ts` / `felts.ts` / `chessSets.ts`.
 *
 * WHAT THIS REPLACES, AND WHY IT IS NOT A COSMETIC. The shelf drew `🥉🥈🥇🏆` — four emoji, which
 * render at the mercy of whatever font the OS supplies, so the ladder looked like four unrelated
 * pictures on Linux and four flat blobs on some Androids. A tier is the one thing on that shelf
 * that has to read as an ORDERED ladder at a glance, and emoji cannot promise that across
 * platforms. These are one curated set, so bronze→platinum is visibly one family climbing.
 *
 * It is NOT a `CosmeticKind`: nobody buys or equips a tier, and there is nothing to choose. The
 * bar for a cosmetic kind is a reader AND a choice; this has a reader and no choice, which makes
 * it art, like a card face. Adding it to the store would be the `loadout.color` mistake pointed
 * the other way — a purchase with no decision behind it.
 *
 * A TIER ALWAYS RESOLVES. `Tier` is a closed union (`TIER_ORDER`), so this record is exhaustive by
 * the type and there is no unknown-id case to fall back from — unlike a cosmetic, whose id comes
 * off a profile and can name something retired. If a fifth tier is ever added, this is a compile
 * error at the one place that must supply its art.
 */
const MEDAL_FILE: Record<Tier, string> = {
  bronze: 'bronze.png',
  silver: 'silver.png',
  gold: 'gold.png',
  platinum: 'platinum.png',
};

/**
 * The image for a tier's medal. Base-path aware (`import.meta.env.BASE_URL`) like every other art
 * resolver here — Pages serves this app from `/Boardwalk/`, so a root-relative path 404s in
 * production and only in production.
 */
export function medalSrc(tier: Tier): string {
  return `${import.meta.env.BASE_URL}medals/${MEDAL_FILE[tier]}`;
}
