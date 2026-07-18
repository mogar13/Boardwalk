import type { GameManifest } from '@/games/registry';

/**
 * Solitaire — the fifth and last game of Phase 6, and the proof that a game can opt OUT of the room
 * system entirely. Blackjack was the first caller of the room-less seam (its coverage was the
 * economy); Solitaire confirms the same seam carries a game with no economy either — it is one
 * player against the shuffle, touching neither seats nor the bankroll.
 *
 * `modes: ['solo']` and `seats: { min: 1, max: 1 }` — no lobby, no seat array, no room
 * subscription. The play route mounts its board straight into `<GameShell>` and it drives a local
 * `useReducer`, exactly as Blackjack does. `betting` is ABSENT (unlike Blackjack's): Solitaire does
 * not touch the bankroll, so it reports only `{ outcome }` on a win — XP and the win stat, no
 * payout — the same shape Chess uses. Absence is the signal, not a `betting: false`.
 *
 * `pier: 'arcade'` — quick hits, one player, one screen, one more round. That is the arcade's whole
 * tagline, and Solitaire is the game that most literally is it.
 *
 * No `icon` — its art is not curated in yet, so the hub draws its neutral placeholder rather than
 * naming a file that is not on disk (the same honest state Chess and UNO register in; the rule is
 * "bring the asset with its reader", and there is no reader for a solitaire icon staged yet).
 */
export const solitaireManifest = {
  id: 'solitaire',
  name: 'Solitaire',
  blurb: 'Klondike. Build the four suits from Ace to King. Just you, the shuffle, and one more deal.',
  pier: 'arcade',
  seats: { min: 1, max: 1 },
  modes: ['solo'],
} as const satisfies GameManifest;
