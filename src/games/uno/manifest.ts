import type { GameManifest } from '@/games/registry';
import type { OptionValues } from '@/system/options/options';
import type { UnoLevel } from '@boardwalk/game-logic/games/uno';

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
  blurb:
    'Match colour or number, stack the action cards, and yell UNO. Two to seven, or fill with bots.',
  icon: 'uno.png',
  pier: 'tables',
  seats: { min: 2, max: 7 },
  modes: ['ai', 'online'],
  /**
   * The SECOND caller of AI difficulty, and the reason it was built at all: V1_FEATURE_GAPS #1 says
   * not to abstract a tier system until a second AI game exists, because one driver is not enough
   * evidence — the same rule that kept us from a generic board engine. UNO is that second driver,
   * and the evidence it produced is that there was nothing to abstract: a tier is a `select`
   * option, and its meaning is a level argument to the game's own pure `chooseAiMove`. Note the
   * vocabulary differs from Tic-Tac-Toe's on purpose — `perfect` is meaningless in a game of
   * hidden hands, and a shared enum would have had to lie about one of the two.
   *
   * `sharp` is the default: it is what the bots have always played, and the host drives every AI
   * seat, so a default change would silently retune every existing table.
   */
  options: [
    {
      id: 'bots',
      label: 'Bots',
      type: 'select',
      default: 'sharp',
      choices: [
        { value: 'casual', label: 'Casual' },
        { value: 'sharp', label: 'Sharp' },
      ],
    },
  ],
} as const satisfies GameManifest;

/** The chosen `bots` option as the level the pure chooser takes. See `ticTacToeHouseLevel`. */
export function unoBotLevel(values: OptionValues): UnoLevel {
  return values.bots === 'casual' ? 'casual' : 'sharp';
}
