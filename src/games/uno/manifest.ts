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
 * The model WAS host-as-dealer and is now THE REFEREE. Declaring `betting` below is what moved it:
 * a 4-seat $25 table pays 4× a player's stake where the generic ceiling is 3×, and a host who can
 * see every hand and also moves the money is a player who cannot lose. So the gateway holds the
 * complete game (every hand plus the draw pile), runs the pure rulebook, projects a public view
 * (top card, counts, whose turn, the pot — never a hidden card) to room state, and deals each hand
 * to its owner's private node. Every seated human, the host included, sends a move and reads the
 * result off the same subscription. The deck never touches the wire at all — strictly more private
 * than v1, whose deck was public — and now neither does any other player's hand.
 *
 * `as const satisfies GameManifest` freezes `id` to `'uno'`, so the registry key, the stats key, the
 * room path `rooms/uno/…`, the hand path `hands/uno/…` and the `/play/uno` route are all one string.
 *
 * `pier: 'tables'`. `betting` IS PRESENT, and the board does NOT call `reportResult` — the referee
 * banks the stat, the XP and the badges inside the settle transaction, so a report would be a client
 * claiming a result the server already recorded. `seats { min: 2, max: 7 }`. `modes: ['ai', 'online']`
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
   * THE POT (plans/UNO_POT.md). Every human seat antes at the deal and the winner takes the whole
   * thing — v1's ante, and the first half of v1's pot; raise/call/fold is a second slice.
   *
   * The range is the LADDER the lobby offers, not a stake this file picks: `anteChoices` filters the
   * one shared rung list to it, so UNO's control reads NONE / $25 / $100 / $500 / $1K — exactly what
   * v1 asked. The host chooses at CREATE, it is stamped on the room, and every joiner sees the price
   * before taking a chair; the referee reads it from there, so `unoStart` carries no stake at all.
   *
   * DECLARING `betting` IS WHAT MOVED THE DEAL TO THE REFEREE. A 4-seat $25 table pays 4× a player's
   * stake and a 7-seat one pays 7×, where the generic `/settle` ceiling is 3× — and the host held
   * every hand. Both had to go, together; see `domain/uno.ts`.
   */
  betting: { min: 2_500, max: 100_000 },
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
  /**
   * HOUSE RULES (plans/UNO_HOUSE_RULES.md) — the ways a TABLE agrees to play differently, as
   * opposed to `options` above, which is how one client does. The ids are the keys
   * `resolveHouseRules` reads, asserted as a bijection in `tests/uno-house-rules.test.ts`.
   *
   * EVERY ONE DEFAULTS OFF, and none of them is enforced yet: this slice is the SEAM — the type,
   * the resolver, the create-time room parameter, the toggles — and the rulebook changes land on
   * top of it. Shipping the toggles now with the rules off is deliberate and not a stub: the seam
   * is independently useful, independently green, and the thing most likely to be got wrong (a
   * rule a guest reads differently from the referee) is exactly what it exists to make impossible.
   * A table nobody configures is the table that already exists.
   */
  houseRules: [
    {
      id: 'stack',
      label: 'Stacking',
      hint: 'Answer a +2 with a +2, a +4 with a +4 — the debt runs until somebody takes it.',
    },
    {
      id: 'crossStack',
      label: 'Cross-stacking',
      hint: '…and a +4 answers a +2.',
      // Meaningless on its own — there is no stack to cross. The lobby will not offer it until
      // stacking is on, and `resolveHouseRules` normalises it away if it arrives set anyway.
      requires: 'stack',
    },
    {
      id: 'playToLast',
      label: 'Play for places',
      hint: 'Keep playing after 1st: 2nd, then 3rd. Last player standing is last.',
    },
  ],
} as const satisfies GameManifest;

/** The chosen `bots` option as the level the pure chooser takes. See `ticTacToeHouseLevel`. */
export function unoBotLevel(values: OptionValues): UnoLevel {
  return values.bots === 'casual' ? 'casual' : 'sharp';
}
