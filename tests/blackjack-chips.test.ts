/**
 * THE MONEY ON THE FELT — the chip art resolves, and a wager breaks down into it correctly.
 *
 * Two halves, and they fail in completely different ways.
 *
 * `chipSrc` builds a filename from a number, so the only way it goes wrong is by naming a file
 * that is not there — and a filename typechecks however wrong it is. That is the `tests/cards.test.ts`
 * / `tests/uno-art.test.ts` / `tests/audio.test.ts` argument, and it applies with extra force here
 * because `public/chips/` sat in this repo since Phase 4 with **no reader at all**: nothing
 * imported it, so nothing could have noticed if the directory had been empty the whole time.
 *
 * `chipStack` is arithmetic on money, and it is wrong in the quiet way: a breakdown that does not
 * add up draws a stack of chips that is not the bet, next to a label that is. Nobody counts chips
 * on a screen, so it would simply look like chips forever.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHIP_TIERS_CENTS, chipSrc, chipStack, rackChips } from '@/games/blackjack/chips';
import { registry } from '@/games/registry';

const CHIP_DIR = fileURLToPath(new URL('../public/chips/', import.meta.url));

/** The path under `chips/`, independent of `BASE_URL` (`/` here, `/Boardwalk/` in prod). */
function rel(src: string): string {
  const marker = 'chips/';
  return src.slice(src.indexOf(marker) + marker.length);
}

describe('chipSrc — the art is on disk', () => {
  it('resolves every registered denomination to a file that exists', () => {
    const missing = CHIP_TIERS_CENTS.map(chipSrc)
      .map(rel)
      .filter((p) => !existsSync(CHIP_DIR + p));
    expect(missing, `unresolved chip art: ${missing.join(', ')}`).toEqual([]);
  });

  it('gives every denomination its OWN file', () => {
    // Two tiers sharing one image is a $25 chip that draws as a $100 one — the stack still looks
    // like a stack, and the felt then states a number the art contradicts. Only distinctness
    // catches it.
    const files = CHIP_TIERS_CENTS.map((c) => rel(chipSrc(c)));
    expect(new Set(files).size).toBe(CHIP_TIERS_CENTS.length);
  });

  it('names the file after the value PRINTED on the chip', () => {
    // The art has the number on its face, so the filename is the whole-dollar value and a reader
    // comparing the registry to the directory is comparing the number they can see in the picture.
    expect(rel(chipSrc(100))).toBe('chip-1.png');
    expect(rel(chipSrc(2_500))).toBe('chip-25.png');
    expect(rel(chipSrc(100_000))).toBe('chip-1000.png');
  });

  it('is base-path aware', () => {
    expect(chipSrc(500).startsWith(import.meta.env.BASE_URL)).toBe(true);
  });

  it('carries no denomination this table cannot stake', () => {
    // The asset rule: art arrives with the game that draws it. A blackjack stake caps at the
    // manifest's max, and the largest single stack reachable is a DOUBLED maximum hand — so the
    // top tier must be reachable, and nothing above it may be staged.
    const betting = registry.find((g) => g.manifest.id === 'blackjack')?.manifest.betting;
    if (betting === undefined) throw new Error('blackjack declares no betting');
    const largestStack = betting.max * 2; // a doubled maximum wager
    const top = Math.max(...CHIP_TIERS_CENTS);
    expect(top).toBeLessThanOrEqual(largestStack);
  });
});

describe('chipStack — the breakdown adds up', () => {
  it('reconstructs any whole-dollar amount EXACTLY', () => {
    for (let dollars = 1; dollars <= 2_000; dollars += 1) {
      const cents = dollars * 100;
      const sum = chipStack(cents).reduce((t, r) => t + r.denomCents * r.count, 0);
      expect(sum, `$${String(dollars)}`).toBe(cents);
    }
  });

  it('reconstructs every wager this table can actually take, doubled and insured', () => {
    // The reachable set, not a sample: the chip rack adds in $5 steps up to the manifest max, a
    // double doubles it, and insurance is floor(w/2).
    const betting = registry.find((g) => g.manifest.id === 'blackjack')?.manifest.betting;
    if (betting === undefined) throw new Error('blackjack declares no betting');
    for (let wager = betting.min; wager <= betting.max; wager += 500) {
      for (const amount of [wager, wager * 2, Math.floor(wager / 2)]) {
        const sum = chipStack(amount).reduce((t, r) => t + r.denomCents * r.count, 0);
        // Equal to the amount less whatever is below the smallest chip — see the next case.
        expect(amount - sum, `${String(amount)}c`).toBeLessThan(100);
        expect(amount - sum).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('drops the sub-dollar remainder, which is why the caller must print the figure', () => {
    // $12.50 is a REACHABLE amount — insurance on a $25 hand — and the smallest chip is $1, so
    // fifty cents has no chip to be. Stated as a test rather than left as a surprise: `<ChipStack>`
    // takes the amount as a required prop and renders it as text beside the stack.
    const runs = chipStack(1_250);
    expect(runs.reduce((t, r) => t + r.denomCents * r.count, 0)).toBe(1_200);
  });

  it('uses the FEWEST chips — greedy, largest first', () => {
    // $175 is one $100, two $25s: three chips, not seven $25s and not thirty-five $5s.
    expect(chipStack(17_500)).toEqual([
      { denomCents: 10_000, count: 1 },
      { denomCents: 2_500, count: 3 },
    ]);
  });

  it('emits runs in descending denomination and never a run of zero', () => {
    for (const amount of [100, 650, 3_700, 17_500, 100_000, 123_456]) {
      const runs = chipStack(amount);
      for (const run of runs) expect(run.count, String(amount)).toBeGreaterThan(0);
      const denoms = runs.map((r) => r.denomCents);
      expect(denoms, String(amount)).toEqual([...denoms].sort((a, b) => b - a));
    }
  });

  it('stacks more of the top chip above the ladder rather than failing', () => {
    // The degradation that matters if `betting.max` is ever raised: no missing image, just a
    // taller stack.
    const runs = chipStack(500_000);
    expect(runs[0]).toEqual({ denomCents: 100_000, count: 5 });
  });

  it('draws nothing for an amount that is not one', () => {
    for (const bad of [0, -1, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(chipStack(bad), String(bad)).toEqual([]);
    }
  });

  it('floors a fractional amount rather than emitting a fractional count', () => {
    const runs = chipStack(550.9);
    expect(runs).toEqual([{ denomCents: 500, count: 1 }]);
    for (const run of runs) expect(Number.isInteger(run.count)).toBe(true);
  });
});

describe('rackChips — the chips a player may pick UP', () => {
  /** The blackjack manifest, read rather than restated: this is a claim about the shipped game. */
  const betting = registry.find((g) => g.manifest.id === 'blackjack')?.manifest.betting;

  it('offers only chips this table can actually stake', () => {
    // The `tableSizeChoices` rule in chip form: `clampBet` snaps an over-max stake straight back,
    // so a rack button above `betting.max` is a control that cannot change the outcome. Read off
    // the REAL manifest, so raising the table maximum grows the rack and nothing else has to move.
    expect(betting).toBeDefined();
    const rack = rackChips(betting?.max ?? 0);
    expect(rack.length).toBeGreaterThan(0);
    for (const chip of rack) expect(chip, String(chip)).toBeLessThanOrEqual(betting?.max ?? 0);
  });

  it('offers a chip the table minimum can be reached with', () => {
    // A rack whose smallest chip exceeds the minimum bet is one a player cannot open the smallest
    // hand with — every click overshoots. `useBet` opens AT the minimum, so this is about whether
    // the fine adjustment above it exists at all.
    const rack = rackChips(betting?.max ?? 0);
    expect(Math.min(...rack)).toBeLessThanOrEqual(betting?.min ?? 0);
  });

  it('runs low to high, distinct, and each one is art on disk', () => {
    // ASCENDING is the opposite of `chipStack`'s order and that is deliberate — a tray runs
    // low-to-high left-to-right, where a breakdown is greedy-largest-first. Asserting it here is
    // what stops somebody "tidying" the two lists into one and silently reversing the rack.
    const rack = rackChips(50_000);
    expect(rack).toEqual([...rack].sort((a, b) => a - b));
    expect(new Set(rack).size).toBe(rack.length);
    const missing = rack.map((c) => rel(chipSrc(c))).filter((p) => !existsSync(CHIP_DIR + p));
    expect(missing, `unresolved rack art: ${missing.join(', ')}`).toEqual([]);
  });

  it('is a SUBSET of the breakdown tiers, so every rack click draws the chip it staged', () => {
    // The rack and the betting circle are the same objects on purpose: click a $25, see a $25 in
    // the circle. A rack tier the breakdown does not know would be staged as a click and then
    // drawn as something else entirely — two smaller chips — which reads as the table changing
    // your bet.
    for (const chip of rackChips(50_000)) {
      expect(CHIP_TIERS_CENTS, String(chip)).toContain(chip);
      expect(chipStack(chip), String(chip)).toEqual([{ denomCents: chip, count: 1 }]);
    }
  });

  it('shrinks with the ceiling rather than offering a button that snaps back', () => {
    expect(rackChips(500)).toEqual([100, 500]);
    expect(rackChips(2_499)).toEqual([100, 500]);
    expect(rackChips(2_500)).toEqual([100, 500, 2_500]);
  });

  it('draws an empty rack for a nonsense ceiling rather than throwing', () => {
    // Reachable only from a manifest that is already wrong, and a board that renders no chips is
    // recoverable where one that throws takes the whole table down.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rackChips(bad), String(bad)).toEqual([]);
    }
  });
});
