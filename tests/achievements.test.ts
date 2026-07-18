/**
 * Achievements 2.0 (P3) — the tiered chains, the feats event-flag path, the earn-only grant, and
 * the derived completion %. Pure, so every threshold, every chain boundary, and the once-only
 * grant are asserted in milliseconds — the discipline the whole OS is built on (extract logic →
 * test logic → then UI).
 *
 * What this file is guarding against, concretely:
 *   • a chain tier that fires a rung early or late (off-by-one at 10/50/100/500, $10k…$1M, …),
 *   • a per-game chain reading the wrong game's wins,
 *   • the earn-only grant NOT landing in inventory, landing early, or landing twice,
 *   • a game forging a chain badge (and its granted title) through the feats channel,
 *   • a feat leaking into the state-predicate path or vice versa.
 */
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_COUNT,
  FEAT_IDS,
  TIER_ORDER,
  achievementById,
  completionPct,
  recordedFeats,
  satisfiedAchievements,
  type AchievementView,
} from '@/system/progress/achievements';
import { applyResult } from '@/system/economy/result';
import { cosmeticById, isEarnOnly } from '@/system/store/catalog';
import { defaultProfile } from '@/system/profile/defaults';
import { xpThresholdForLevel } from '@/system/profile/xp';
import type { GameStat, Profile } from '@/system/profile/types';

const NOW = 1_700_000_000_000;

/** A zeroed view with overrides — the same shape `applyResult` assembles, built by hand here. */
function view(over: Partial<AchievementView> = {}): AchievementView {
  return {
    totalPlayed: 0,
    totalWins: 0,
    bankrollCents: 0,
    xp: 0,
    lastWagerCents: 0,
    lastNetCents: 0,
    winsByGame: {},
    ...over,
  };
}

/** A GameStat with a given win count (played ≥ won so the record is coherent). */
function wonStat(won: number): GameStat {
  return { played: won, won, lost: 0, pushed: 0 };
}

describe('tiered chains — exact thresholds', () => {
  it('wins chain fires each tier at its boundary and not one win below', () => {
    const cases: readonly [number, string][] = [
      [10, 'wins_bronze'],
      [50, 'wins_silver'],
      [100, 'wins_gold'],
      [500, 'wins_platinum'],
    ];
    for (const [at, id] of cases) {
      expect(satisfiedAchievements(view({ totalWins: at }))).toContain(id);
      expect(satisfiedAchievements(view({ totalWins: at - 1 }))).not.toContain(id);
    }
  });

  it('wins chain is cumulative — 100 wins holds bronze, silver and gold too', () => {
    const ids = satisfiedAchievements(view({ totalWins: 100 }));
    expect(ids).toEqual(expect.arrayContaining(['wins_bronze', 'wins_silver', 'wins_gold']));
    expect(ids).not.toContain('wins_platinum'); // 100 < 500
  });

  it('bankroll chain fires at $10k / $50k / $250k / $1M and not a cent below', () => {
    const cases: readonly [number, string][] = [
      [1_000_000, 'bankroll_bronze'],
      [5_000_000, 'bankroll_silver'],
      [25_000_000, 'bankroll_gold'],
      [100_000_000, 'bankroll_platinum'],
    ];
    for (const [at, id] of cases) {
      expect(satisfiedAchievements(view({ bankrollCents: at }))).toContain(id);
      expect(satisfiedAchievements(view({ bankrollCents: at - 1 }))).not.toContain(id);
    }
  });

  it('level chain fires exactly at the XP threshold for levels 5 / 10 / 25 / 50', () => {
    const cases: readonly [number, string][] = [
      [5, 'level_bronze'],
      [10, 'level_silver'],
      [25, 'level_gold'],
      [50, 'level_platinum'],
    ];
    for (const [lvl, id] of cases) {
      const at = xpThresholdForLevel(lvl);
      expect(satisfiedAchievements(view({ xp: at }))).toContain(id);
      expect(satisfiedAchievements(view({ xp: at - 1 }))).not.toContain(id);
    }
  });
});

describe('per-game mastery chains read the right game', () => {
  it('chess chain fires at 1 / 10 / 50 / 100 chess wins', () => {
    const cases: readonly [number, string][] = [
      [1, 'chess_bronze'],
      [10, 'chess_silver'],
      [50, 'chess_gold'],
      [100, 'chess_platinum'],
    ];
    for (const [at, id] of cases) {
      expect(satisfiedAchievements(view({ winsByGame: { chess: at } }))).toContain(id);
      expect(satisfiedAchievements(view({ winsByGame: { chess: at - 1 } }))).not.toContain(id);
    }
  });

  it('blackjack chain fires at 1 / 10 / 50 / 100 blackjack wins', () => {
    expect(satisfiedAchievements(view({ winsByGame: { blackjack: 1 } }))).toContain(
      'blackjack_bronze'
    );
    expect(satisfiedAchievements(view({ winsByGame: { blackjack: 100 } }))).toContain(
      'blackjack_platinum'
    );
  });

  it('does not cross the wires — 100 chess wins earns nothing on the blackjack chain', () => {
    const ids = satisfiedAchievements(view({ winsByGame: { chess: 100 } }));
    expect(ids).toContain('chess_platinum');
    expect(ids.filter((id) => id.startsWith('blackjack_'))).toEqual([]);
  });

  it('an unplayed game reads as zero wins, not a crash', () => {
    expect(satisfiedAchievements(view({ winsByGame: {} }))).not.toContain('chess_bronze');
  });
});

describe('the earn-only grant (the P2 → P3 link)', () => {
  /** A profile that has already climbed a chain to just below its top tier. */
  function nearPlatinum(gameId: 'chess' | 'blackjack', wins: number, earned: string[]): Profile {
    return {
      ...defaultProfile('t'),
      stats: { [gameId]: wonStat(wins) },
      achievements: Object.fromEntries(earned.map((id) => [id, NOW - 1])),
    };
  }

  it('grants the Grandmaster title into inventory the moment the chess chain completes', () => {
    const p = nearPlatinum('chess', 99, ['chess_bronze', 'chess_silver', 'chess_gold']);
    const out = applyResult(p, 'chess', { outcome: 'win' }, NOW); // 99 → 100
    expect(out.unlocked.map((a) => a.id)).toContain('chess_platinum');
    expect(out.profile.inventory.ttl_grandmaster).toBe(true);
  });

  it('grants The House title when the blackjack chain completes', () => {
    const p = nearPlatinum('blackjack', 99, [
      'blackjack_bronze',
      'blackjack_silver',
      'blackjack_gold',
    ]);
    const out = applyResult(p, 'blackjack', { outcome: 'win' }, NOW);
    expect(out.profile.inventory.ttl_thehouse).toBe(true);
  });

  it('does NOT grant before the top tier — 51 chess wins is Gold, not Grandmaster', () => {
    const p = nearPlatinum('chess', 50, ['chess_bronze', 'chess_silver']);
    const out = applyResult(p, 'chess', { outcome: 'win' }, NOW); // 50 → 51, gold at 50
    expect(out.unlocked.map((a) => a.id)).toContain('chess_gold');
    expect(out.profile.inventory.ttl_grandmaster).toBeUndefined();
  });

  it('grants exactly once — a further chess win after Platinum does not re-grant', () => {
    const p: Profile = {
      ...defaultProfile('t'),
      stats: { chess: wonStat(100) },
      achievements: {
        chess_bronze: NOW - 3,
        chess_silver: NOW - 2,
        chess_gold: NOW - 1,
        chess_platinum: NOW,
      },
      inventory: { ttl_grandmaster: true },
    };
    const out = applyResult(p, 'chess', { outcome: 'win' }, NOW + 1); // 100 → 101
    expect(out.unlocked.map((a) => a.id)).not.toContain('chess_platinum');
    expect(out.profile.inventory).toEqual({ ttl_grandmaster: true }); // unchanged, not duplicated
  });

  it('every grant names a real, earn-only cosmetic (no typo grants a nothing)', () => {
    for (const a of ACHIEVEMENTS) {
      if (a.grants === undefined) continue;
      const cosmetic = cosmeticById(a.grants);
      expect(cosmetic, `${a.id} grants unknown cosmetic ${a.grants}`).toBeDefined();
      if (cosmetic === undefined) continue;
      expect(isEarnOnly(cosmetic)).toBe(true);
    }
  });
});

describe('feats — the event-flag path', () => {
  it('recordedFeats keeps only real feat ids, de-duplicated', () => {
    expect(recordedFeats(undefined)).toEqual([]);
    expect(recordedFeats(['feat_natural', 'feat_natural'])).toEqual(['feat_natural']);
    // A chain id and a typo are both dropped — the allow-list is the security boundary.
    expect(recordedFeats(['feat_natural', 'chess_platinum', 'bogus'])).toEqual(['feat_natural']);
  });

  it('applyResult records a reported feat and stamps its unlock time', () => {
    const p = defaultProfile('t');
    const out = applyResult(p, 'blackjack', { outcome: 'win', feats: ['feat_natural'] }, NOW);
    expect(out.unlocked.map((a) => a.id)).toContain('feat_natural');
    expect(out.profile.achievements.feat_natural).toBe(NOW);
  });

  it('a game CANNOT forge a chain badge through feats — no grant leaks out', () => {
    const p = defaultProfile('t');
    const out = applyResult(p, 'chess', { outcome: 'win', feats: ['chess_platinum'] }, NOW);
    expect(out.unlocked.map((a) => a.id)).not.toContain('chess_platinum');
    expect(out.profile.achievements.chess_platinum).toBeUndefined();
    expect(out.profile.inventory.ttl_grandmaster).toBeUndefined();
  });

  it('a feat fires once — reporting it again does not re-fire', () => {
    const p = defaultProfile('t');
    const first = applyResult(p, 'solitaire', { outcome: 'win', feats: ['feat_cleansheet'] }, NOW);
    expect(first.unlocked.map((a) => a.id)).toContain('feat_cleansheet');
    const second = applyResult(
      first.profile,
      'solitaire',
      { outcome: 'win', feats: ['feat_cleansheet'] },
      NOW + 1
    );
    expect(second.unlocked.map((a) => a.id)).not.toContain('feat_cleansheet');
    expect(second.profile.achievements.feat_cleansheet).toBe(NOW); // original time preserved
  });

  it('FEAT_IDS is exactly the reportable set, and feats carry no state predicate', () => {
    expect(FEAT_IDS).toEqual(new Set(['feat_natural', 'feat_cleansheet', 'feat_speedrun']));
    for (const id of FEAT_IDS) {
      expect(achievementById.get(id)?.test).toBeUndefined();
    }
    // ...and satisfiedAchievements never returns a feat, whatever the view.
    const everything = view({ totalWins: 999, bankrollCents: 999_000_000, xp: 9_999_999 });
    for (const id of satisfiedAchievements(everything)) {
      expect(FEAT_IDS.has(id)).toBe(false);
    }
  });
});

describe('hidden achievements + completion %', () => {
  it('marks the Blitz speedrun feat hidden and nothing else', () => {
    const hidden = ACHIEVEMENTS.filter((a) => a.hidden).map((a) => a.id);
    expect(hidden).toEqual(['feat_speedrun']);
  });

  it('completionPct is a pure earned/total derivation', () => {
    expect(completionPct(0)).toBe(0);
    expect(completionPct(ACHIEVEMENT_COUNT)).toBe(100);
    expect(completionPct(ACHIEVEMENT_COUNT / 2)).toBe(50);
  });
});

describe('catalogue integrity', () => {
  it('has unique ids', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every chain has exactly the four tiers in order, and only Platinum grants', () => {
    const chains = new Set(
      ACHIEVEMENTS.map((a) => a.chain).filter((c): c is string => c !== undefined)
    );
    expect(chains).toEqual(new Set(['wins', 'level', 'bankroll', 'chess', 'blackjack']));
    for (const chain of chains) {
      const rungs = ACHIEVEMENTS.filter((a) => a.chain === chain);
      expect(rungs.map((r) => r.tier)).toEqual(TIER_ORDER);
      for (const r of rungs) {
        if (r.grants !== undefined) expect(r.tier).toBe('platinum');
      }
    }
  });

  it('exactly the two mastery chains carry a grant', () => {
    const granting = ACHIEVEMENTS.filter((a) => a.grants !== undefined).map((a) => a.id);
    expect(granting).toEqual(['chess_platinum', 'blackjack_platinum']);
  });

  it('every non-feat achievement has a test; every feat has none', () => {
    for (const a of ACHIEVEMENTS) {
      if (a.feat) expect(a.test).toBeUndefined();
      else expect(a.test).toBeInstanceOf(Function);
    }
  });
});
