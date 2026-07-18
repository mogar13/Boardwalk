/**
 * Rarity → its flat label colour token. Shared by the store's item cards and the pack shelf's
 * odds table + reveal, because those three MUST agree: a legendary that reads gold on a card and
 * something else in the reveal is the tier signal quietly contradicting itself.
 *
 * Literal strings, not a template, so Tailwind's scanner sees each class and generates it. Flat
 * tokens on purpose — rarity is status, and the glow budget (blue=act, cyan=here, gold=money) is
 * fixed and already nearly spent. A legendary does not glow; it is just gold-lettered.
 */
import type { Rarity } from '@boardwalk/game-logic';

export const RARITY_TEXT: Record<Rarity, string> = {
  common: 'text-rarity-common',
  rare: 'text-rarity-rare',
  epic: 'text-rarity-epic',
  legendary: 'text-rarity-legendary',
};

/**
 * Rarity → its flat BORDER token, for the P5 `frame` cosmetic (the ring around your avatar).
 *
 * A frame is drawn in the rarity ladder's colours rather than a palette of its own, and that is
 * the whole reason `frame` could ship at all. CLAUDE.md calls the glow budget fixed and nearly
 * spent; PROGRESSION_PLAN.md §3.1 says outright that if frames threaten the budget, frames get
 * cut. Reusing these four already-cleared, already-flat hues means the kind adds ZERO new hues —
 * and it buys a real signal for free, because a frame's colour then IS its rarity, legible to
 * anyone who has looked at a store card.
 *
 * Literal strings, not a template, for the same reason as `RARITY_TEXT`: Tailwind's scanner has
 * to see each class or it never generates it, and a class that is never generated fails silently
 * as an unstyled element rather than loudly as an error.
 */
export const RARITY_RING: Record<Rarity, string> = {
  common: 'border-rarity-common',
  rare: 'border-rarity-rare',
  epic: 'border-rarity-epic',
  legendary: 'border-rarity-legendary',
};

/** Every tier, best-last — the order the odds table and any tier ladder walk. */
export const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];
