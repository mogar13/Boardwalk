import type { GameManifest } from '@/games/registry';
import type { OptionValues } from '@/system/options/options';

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
  blurb:
    'Klondike. Build the four suits from Ace to King. Just you, the shuffle, and one more deal.',
  icon: 'solitaire.png',
  pier: 'arcade',
  seats: { min: 1, max: 1 },
  modes: ['solo'],
  /**
   * The first caller of the options seam (V1_FEATURE_GAPS #2). Draw-1 vs draw-3 was ALREADY in the
   * pure engine — `deal` has taken a `drawCount` since Phase 6 — and the picker for it was two
   * hand-rolled buttons and a `useState` in `SolitaireGame`. That is the v1 shape this seam exists
   * to delete: the option is now data the OS renders, and the game's only job is turning the
   * chosen string into the number its reducer already accepted.
   *
   * v1 called this Solitaire's "difficulty", along with a guaranteed-winnable deal variant. Only
   * the half the engine implements is offered — an option whose value the rules cannot honour is
   * worse than no option.
   */
  options: [
    {
      id: 'draw',
      label: 'Draw',
      type: 'select',
      default: '1',
      choices: [
        { value: '1', label: 'Draw 1' },
        { value: '3', label: 'Draw 3' },
      ],
    },
  ],
} as const satisfies GameManifest;

/**
 * The chosen `draw` option as the number the pure reducer takes. This is where an option's MEANING
 * lives — with the game, next to the rules it feeds, never in the OS. `values` is complete and
 * valid by construction (`resolveOptionValues`), so the only case to handle is the two the
 * manifest offers; anything else is unreachable and takes the default the manifest declares.
 */
export function solitaireDrawCount(values: OptionValues): 1 | 3 {
  return values.draw === '3' ? 3 : 1;
}
