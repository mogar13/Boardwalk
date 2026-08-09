/**
 * A WAGER, DRAWN AS CHIPS — the money on the felt rather than a number beside it.
 *
 * NOT in `logic/` on purpose, and for `src/games/uno/art.ts`'s exact reason: `chipSrc` reads
 * `import.meta.env.BASE_URL` to build a base-path-aware URL (so the art resolves under
 * `/Boardwalk/`), which is browser coupling that `@boardwalk/no-impure-logic` keeps out of a
 * rulebook. `chipStack` could live in `logic/` — it is integer arithmetic — but it answers a
 * question about PIXELS ("how do I draw $37") and not one about the game, and splitting the two
 * halves across two packages so that one of them could be pure would be a filing decision dressed
 * up as an architectural one.
 *
 * `public/chips/` was staged in Phase 4 and had **no reader at all** until this file: eighteen
 * 16×16 pixel chips that nothing imported, which is the `loadout.color` failure this repo names —
 * an asset with no reader. They are retired here rather than kept beside the set that does get
 * drawn, because one curated directory holding a used set and a dead set is how the next person
 * picks the wrong one.
 */

/**
 * The chips this table stacks with, DESCENDING — the order `chipStack` breaks an amount down in,
 * and the reason it is descending is that a greedy pass over a descending list is what gives the
 * fewest chips, which is what a real dealer pushes across.
 *
 * In CENTS, like every other number in this repo that is money. The top of the ladder is $1,000
 * and stops there deliberately: the manifest caps a blackjack stake at `50000` cents ($500), so a
 * DOUBLED maximum hand is exactly $1,000 and nothing at this table can stack higher. A $5,000 chip
 * exists in the same art pack and is not curated in, on the rule this repo states about assets —
 * one arrives with the game that draws it, and no hand here can draw that one.
 *
 * Above the top tier the breakdown does not fail, it simply stacks more $1,000 chips, so raising
 * `betting.max` later degrades into a taller stack rather than a missing image.
 */
export const CHIP_TIERS_CENTS = [100_000, 50_000, 10_000, 2_500, 1_000, 500, 100] as const;

/**
 * THE CHIPS IN THE RACK — what a player may pick UP, as opposed to what a wager breaks DOWN into.
 *
 * Two different questions, and conflating them is why this is a second list rather than a reuse of
 * `CHIP_TIERS_CENTS`. The breakdown list must cover every amount the table can hold, including
 * denominations nobody picks ($10 exists so that $35 draws as a $25 and a $10 rather than as eleven
 * chips). The rack is a row of BUTTONS, and a button for every tier is a row of nine that a player
 * has to read before betting $25 — v1 offered six and it was already the widest control on its
 * screen.
 *
 * ASCENDING, unlike the breakdown, because a chip tray runs low-to-high left-to-right and a player
 * reaching for "the small one" reaches left. The breakdown is descending because greedy-largest-
 * first is what gives the fewest chips; neither order is a preference, both are the job.
 */
const RACK_TIERS_CENTS = [100, 500, 2_500, 10_000, 50_000] as const;

/**
 * The chips this table's rack offers, ascending — every rack tier the table can actually stake.
 *
 * Bounded by the game's own `betting.max` rather than by a hardcoded list, which is the asset rule
 * as arithmetic: a rack button for a chip that exceeds the table maximum is a control that cannot
 * change the outcome (`clampBet` would snap it straight back), and this repo's position on those is
 * that they are worse than none. `tests/blackjack-chips.test.ts` asserts it against the REAL
 * manifest in both directions, so raising the table maximum grows the rack and nothing else.
 *
 * A nonsense maximum yields an empty rack rather than throwing — reachable only from a manifest
 * that is already wrong, and a board that draws no chips is recoverable where one that throws takes
 * the table down.
 */
export function rackChips(maxCents: number): number[] {
  if (!Number.isFinite(maxCents) || maxCents <= 0) return [];
  return RACK_TIERS_CENTS.filter((c) => c <= maxCents);
}

/** One denomination in a broken-down wager, and how many of it. */
export interface ChipRun {
  /** The chip's face value in cents — what `chipSrc` needs, and what the art prints on the face. */
  readonly denomCents: number;
  /** How many of this chip the amount contains. Always at least 1; a run of 0 is never emitted. */
  readonly count: number;
}

const ROOT = `${import.meta.env.BASE_URL}chips/`;

/**
 * The image for one denomination. The filename is the chip's value in WHOLE DOLLARS, because that
 * is what is printed on the art — `chip-25.png` has "25" on its face — so a reader comparing the
 * registry to the directory is comparing the same number they can see in the picture.
 */
export function chipSrc(denomCents: number): string {
  return `${ROOT}chip-${String(Math.round(denomCents / 100))}.png`;
}

/**
 * Break an amount into the chips a dealer would push across: greedy, largest first.
 *
 * **SUB-DOLLAR REMAINDERS ARE NOT DRAWN, and that is why every caller also prints the figure.**
 * The smallest chip is $1, so $12.50 draws as $10 + $1 + $1 and the last fifty cents has no chip
 * to be. That amount is reachable rather than theoretical — insurance is `floor(wager/2)`, so a
 * $25 hand offers a $12.50 side bet — and the honest answer is that the chips ILLUSTRATE and the
 * label STATES. `<ChipStack>` renders the amount as text beside the stack for exactly this reason
 * and takes it as a required prop so a caller cannot drop it.
 *
 * Total: a negative or fractional amount yields no runs rather than throwing. A stake is validated
 * long before it reaches a renderer, so anything odd arriving here means something upstream is
 * already wrong, and a board that throws takes the table down while a board that draws nothing
 * merely draws nothing.
 */
export function chipStack(cents: number): ChipRun[] {
  if (!Number.isFinite(cents) || cents <= 0) return [];
  let remaining = Math.floor(cents);
  const runs: ChipRun[] = [];
  for (const denomCents of CHIP_TIERS_CENTS) {
    const count = Math.floor(remaining / denomCents);
    if (count > 0) {
      runs.push({ denomCents, count });
      remaining -= count * denomCents;
    }
  }
  return runs;
}
