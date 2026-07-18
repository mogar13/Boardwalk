import type { GameManifest } from '@/games/registry';

/**
 * UNO — the SDK's proof of the hard multiplayer half: HIDDEN HANDS (each player sees only their own
 * cards, a data-layout-and-rule guarantee, not a UI trick), seq-ordered writes (v1's clock-skew bug,
 * fixed for everyone by the OS's `patchState`), AI-AS-OCCUPANT (a leaving player's hand is driven on
 * by the host so the table never stalls), and a table that seats up to SEVEN. It is the first and
 * only consumer of the private `hands/` channel Phase 5 shipped with no caller, and of the two hooks
 * that wrap it (`useRoom().writeHand`, `useHand`).
 *
 * The model is HOST-AS-DEALER: the host holds the complete game (every hand plus the draw pile) in
 * memory, runs the pure `logic/uno.ts` reducer, projects a public view (top card, counts, whose
 * turn — never a hidden card) to `state/data`, and deals each hand to its owner's private node.
 * Non-hosts render the projection plus their own hand and submit a move as an intent the host acks.
 * So the deck never touches the wire at all — strictly more private than v1, whose deck was public.
 *
 * `as const satisfies GameManifest` freezes `id` to `'uno'`, so the registry key, the stats key, the
 * room path `rooms/uno/…`, the hand path `hands/uno/…` and the `/play/uno` route are all one string.
 *
 * `pier: 'tables'` — a skill/party game, no stakes. `betting` is ABSENT (like Chess): `reportResult`
 * moves XP and a stat but never the bankroll. `seats { min: 2, max: 7 }`. `modes: ['ai', 'online']`
 * — NOT hot-seat: hidden hands and one shared screen are contradictory (a screen everyone sees cannot
 * hide a hand from anyone), which is the honest reason UNO omits the mode Chess exists to prove.
 */
export const unoManifest = {
  id: 'uno',
  name: 'UNO',
  blurb: 'Match colour or number, stack the action cards, and yell UNO. Two to seven, or fill with bots.',
  icon: 'uno.png',
  pier: 'tables',
  seats: { min: 2, max: 7 },
  modes: ['ai', 'online'],
} as const satisfies GameManifest;
