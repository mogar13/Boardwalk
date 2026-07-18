/**
 * How an equipped FRAME becomes a ring — the P5 sibling of `@/system/felt/felts`, and the same
 * split: this module owns the id→tone mapping and knows nothing of the profile; the reader
 * (`useEquippedFrame`) knows about the player; `<Avatar>` turns a tone into pixels.
 *
 * A FRAME HAS NO ART, and that is not a shortcut — it is why the kind could ship. The asset sweep
 * (PROGRESSION_PLAN.md §6.1) found essentially no ring art in the trove, and the plan's answer was
 * theme tokens rather than sourcing. The tokens it draws from are the RARITY ladder P2 already
 * cleared against the glow budget, so `frame` adds zero hues to a budget CLAUDE.md calls nearly
 * spent — and a frame's colour then IS its rarity, a status signal for free.
 *
 * THE MAP IS THEREFORE A TONE, NOT A COLOUR. Naming an oklch here would put a colour outside
 * `packages/theme/theme.css` (the one file allowed to spell one, enforced by
 * `@boardwalk/no-raw-palette`). Naming a Tailwind class here would be workable but would scatter
 * the class in a second place; `RARITY_RING` in `@/system/store/rarity` already owns
 * rarity→border-class and is shared with the store cards, so the two cannot drift.
 *
 * `tests/frames.test.ts` proves every `frame` cosmetic in `CATALOG` appears here, that no id here
 * is unknown to the catalogue, and — the one that would actually rot — that each frame's tone
 * EQUALS its catalogue rarity, so a re-priced frame cannot keep a ring colour that lies about it.
 */
import type { Rarity } from '@boardwalk/game-logic';

/**
 * Frame cosmetic id → the tone its ring is drawn in. Ids match `CATALOG`; the tone matches that
 * entry's `rarity`, which the test enforces rather than trusting.
 */
export const FRAMES: Readonly<Record<string, Rarity>> = {
  fr_steel: 'common',
  fr_azure: 'rare',
  fr_violet: 'epic',
  fr_ember: 'legendary',
};

/** Every frame id the registry knows, for iteration (the guard test walks these). */
export const FRAME_IDS = Object.keys(FRAMES);

/**
 * The tone for an equipped frame id, or `null` for "draw no ring" — both the signed-out case and
 * the nothing-equipped case, which is the default and a permanent, legitimate state: a bare avatar
 * is exactly what every account has rendered since Phase 4.
 *
 * An UNKNOWN id also resolves to `null`, so a retired frame still sitting in someone's `equipped`
 * degrades to no ring rather than an unstyled border. Same fallback shape as `feltSrc`.
 */
export function frameTone(frameId: string | undefined): Rarity | null {
  if (frameId === undefined) return null;
  return FRAMES[frameId] ?? null;
}
