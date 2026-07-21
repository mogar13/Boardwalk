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
  type ChainRef,
} from '@boardwalk/game-logic';
import { registry } from '@/games/registry';
import { applyResult } from '@boardwalk/game-logic';
import { cosmeticById, isEarnOnly } from '@boardwalk/game-logic';
import { defaultProfile } from '@/system/profile/defaults';
import { xpThresholdForLevel } from '@boardwalk/game-logic';
import type { GameStat, Profile } from '@boardwalk/game-logic';

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

/**
 * The chains that ladder a CROSS-GAME total rather than one game's wins. Named explicitly because
 * everything else in the catalogue is a per-game mastery chain whose id IS a `manifest.id` — which
 * is what lets the registry cross-check below be a set equality instead of a hand-kept list.
 */
const PROGRESSION_CHAINS: readonly string[] = ['wins', 'level', 'bankroll'];

/** Every chain in the catalogue, de-duplicated, in first-appearance order. */
function chains(): readonly ChainRef[] {
  const seen: ChainRef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (a.chain !== undefined && !seen.some((c) => c.id === a.chain?.id)) seen.push(a.chain);
  }
  return seen;
}

/** The per-game mastery chains — everything that is not a progression chain. Each id is a game id. */
function masteryChainIds(): readonly string[] {
  return chains()
    .map((c) => c.id)
    .filter((id) => !PROGRESSION_CHAINS.includes(id));
}

/** The mastery ladder, as tier ids — the thresholds `GAME_MASTERY` sets, asserted from outside. */
const MASTERY_LADDER: readonly (readonly [number, string])[] = [
  [1, 'bronze'],
  [10, 'silver'],
  [50, 'gold'],
  [100, 'platinum'],
];

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

  /**
   * THE ONE THAT MAKES IT A RULE INSTEAD OF A LIST. P3 gave chess and blackjack mastery chains
   * because they were the two games that existed; four games later that had become an arbitrary
   * distinction nobody would notice. A set equality against the REAL registry closes it in both
   * directions at once: ship a seventh game without a chain and this goes red, and delete a game
   * whose chain outlives it and it goes red too.
   *
   * It works only because a mastery chain's id IS the game id it counts (`masteryChain` takes one
   * argument for both), so there is no second string to keep in step.
   */
  it('every registered game has a mastery chain, and every mastery chain is a registered game', () => {
    const gameIds = registry.map((g) => g.manifest.id);
    // Guard the guard: an empty registry would make the equality below vacuously true.
    expect(gameIds.length).toBeGreaterThan(1);
    expect(new Set(masteryChainIds())).toEqual(new Set(gameIds));
  });

  it('EVERY mastery chain fires at 1 / 10 / 50 / 100 wins of its own game and not one below', () => {
    for (const gameId of masteryChainIds()) {
      for (const [at, tier] of MASTERY_LADDER) {
        const id = `${gameId}_${tier}`;
        expect(satisfiedAchievements(view({ winsByGame: { [gameId]: at } })), id).toContain(id);
        expect(
          satisfiedAchievements(view({ winsByGame: { [gameId]: at - 1 } })),
          `${id} fired at ${String(at - 1)} wins`
        ).not.toContain(id);
      }
    }
  });

  it('no mastery chain is cross-wired — 100 wins of one game earns nothing on another', () => {
    const all = masteryChainIds();
    for (const gameId of all) {
      const ids = satisfiedAchievements(view({ winsByGame: { [gameId]: 100 } }));
      const foreign = all
        .filter((other) => other !== gameId)
        .flatMap((other) => MASTERY_LADDER.map(([, tier]) => `${other}_${tier}`))
        .filter((id) => ids.includes(id));
      expect(foreign, `${gameId} wins leaked onto: ${foreign.join(', ')}`).toEqual([]);
    }
  });
});

describe('the earn-only grant (the P2 → P3 link)', () => {
  /** A profile that has already climbed a chain to just below its top tier. */
  function nearPlatinum(gameId: string, wins: number, earned: string[]): Profile {
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

  /**
   * The same path for a chain added in this slice, driven through `applyResult` rather than the
   * predicate alone. The predicate tests above prove the chain FIRES; this proves the rest of the
   * pipeline — the diff, the grant, the inventory write — treats a new chain exactly like the two
   * that shipped in P3, with nothing keyed to a game id anywhere along it.
   */
  it('grants the Patience title when a chain added after P3 completes (Solitaire)', () => {
    const p = nearPlatinum('solitaire', 99, [
      'solitaire_bronze',
      'solitaire_silver',
      'solitaire_gold',
    ]);
    const out = applyResult(p, 'solitaire', { outcome: 'win' }, NOW);
    expect(out.unlocked.map((a) => a.id)).toContain('solitaire_platinum');
    expect(out.profile.inventory.ttl_patience).toBe(true);
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
    const ids = chains().map((c) => c.id);
    expect(new Set(ids)).toEqual(
      new Set([...PROGRESSION_CHAINS, ...registry.map((g) => g.manifest.id)])
    );
    for (const id of ids) {
      const rungs = ACHIEVEMENTS.filter((a) => a.chain?.id === id);
      expect(
        rungs.map((r) => r.tier),
        id
      ).toEqual(TIER_ORDER);
      for (const r of rungs) {
        if (r.grants !== undefined) expect(r.tier, r.id).toBe('platinum');
      }
    }
  });

  /**
   * Was "exactly the two mastery chains carry a grant", pinned to a literal pair. That is the
   * assertion a sixth game quietly outgrows, so it is now the RULE the pair was an instance of:
   * a grant belongs to a mastery chain's Platinum, one per game, and no two chains hand out the
   * same title. `ttl_thehouse` on two chains would typecheck, pass the earn-only check, and make
   * one of the two titles unreachable-by-its-own-chain forever.
   */
  it('every mastery chain grants exactly one distinct title, and only mastery chains grant', () => {
    const granting = ACHIEVEMENTS.filter((a) => a.grants !== undefined);
    expect(new Set(granting.map((a) => a.chain?.id))).toEqual(new Set(masteryChainIds()));
    expect(granting).toHaveLength(masteryChainIds().length);
    const grants = granting.map((a) => a.grants);
    expect(new Set(grants).size, `duplicate grants: ${grants.join(', ')}`).toBe(grants.length);
  });

  it('every chain carries a heading, and no two chains share one', () => {
    const cs = chains();
    for (const c of cs) expect(c.label.trim(), c.id).not.toBe('');
    const labels = cs.map((c) => c.label);
    expect(new Set(labels).size, `duplicate headings: ${labels.join(', ')}`).toBe(labels.length);
  });

  it('every non-feat achievement has a test; every feat has none', () => {
    for (const a of ACHIEVEMENTS) {
      if (a.feat) expect(a.test).toBeUndefined();
      else expect(a.test).toBeInstanceOf(Function);
    }
  });
});
