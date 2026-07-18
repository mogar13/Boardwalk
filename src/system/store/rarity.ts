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

/** Every tier, best-last — the order the odds table and any tier ladder walk. */
export const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];
