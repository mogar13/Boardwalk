import type { GameManifest } from '@/games/registry';
import type { OptionValues } from '@/system/options/options';
import type { PlayerPrefSpec } from '@/system/prefs/prefs';
import { HOUSE_TABLE_LEVEL, type UnoLevel } from '@boardwalk/game-logic/games/uno';

/**
 * AUTO-DRAW, the first player PREFERENCE in this app — the third kind of thing a game can be
 * played differently under, after `options` (yours, pre-game, in the URL) and `houseRules` (the
 * table's, at create, in room state). `src/system/prefs/prefs.ts` carries the table that separates
 * them; this one binds nobody but you and takes effect the moment you flip it.
 *
 * IT PASSES THE TEST THAT DECIDES WHICH KIND SOMETHING IS, and that is worth stating, because "the
 * board plays a move for you" sounds exactly like a rule. It fires only where `mustDraw` is true —
 * the position in which `applyMove` refuses every play and accepts exactly one action, and in which
 * drawing ENDS the turn, because this rulebook has no play-what-you-drew. No decision is taken from
 * anybody: the reducer had already collapsed the legal set to one, and the table is identical
 * either way. That is what makes it yours to switch off rather than the table's to agree on.
 *
 * `default: true` is the field here that could do damage. Auto-draw has shipped ON since the day it
 * landed, so defaulting it off would silently retune a live game under every player who never opens
 * the panel — the on-by-default house rule's defect pointing the other way. `tests/player-prefs.test.ts`
 * pins every declared default against the behaviour that shipped for exactly that reason.
 *
 * The hint describes the OFF state, because that is what a reader is choosing INTO; the on-state is
 * what they already have and did not have to be told about.
 *
 * Named rather than inlined into `playerPrefs` below so the BOARD can import the spec by name.
 * `usePlayerPref` takes a spec, never an id — the default lives on the spec, so a caller holding
 * one cannot read a preference this game does not declare — and `playerPrefs[0]` would be an index
 * that silently means something else the day a second preference is added at the top.
 */
export const AUTO_DRAW_PREF: PlayerPrefSpec = {
  id: 'autoDraw',
  label: 'Draw for me when I am stuck',
  hint: 'On, the table draws for you after a beat when nothing in your hand can be played — the only move you had. Off, you press the deck yourself.',
  default: true,
};

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
   * THE POT (plans/done/UNO_POT.md). Every human seat antes at the deal and the winner takes the whole
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
  betting: {
    min: 2_500,
    max: 100_000,
    /**
     * THE HOUSE WILL BANK A LONE PLAYER (plans/done/UNO_HOUSE_RULES.md §4). One human against bots
     * antes like anybody else, and a win pays `ante × seats × HOUSE_RETURN` out of the house's
     * own money — Blackjack's model, not v1's, and the distinction is the whole feature: v1
     * covered each bot's ante so the pot matched fair odds, which at 4 seats is a $75 grant on a
     * coin flip.
     *
     * It is declared here rather than assumed by the lobby because it is the GAME that earned it.
     * A house pot is only safe once somebody has measured what a player wins against that game's
     * own bots, and `tests/uno-house-odds.test.ts` did: 2,000 seeded rounds a cell at every table
     * size and under both rule sets, an attentive-human proxy lifting at worst 1.230 against a
     * break-even of 1.50. A game that has not run that measurement must not get this by default.
     */
    house: true,
  },
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
      /*
        The hints say what the BOT DOES, not how hard it is: "Casual" and "Sharp" already say how
        hard it is and say nothing a player can act on. Both are read off `chooseAiMove`'s two
        branches rather than written from an impression of them — `casual` picks uniformly among
        its playable cards and names a random colour on a wild, `sharp` sorts by
        `number → action → wild` and takes the first, so it leads with plain numbers and keeps its
        skips, draws and wilds back, and its wild colour is `bestColor`, the one it holds most of.
        Getting that backwards is easy and invisible (the first draft of this line said "leads with
        skips and draws", which is the exact opposite of the sort order), and a hint that describes
        a policy the rulebook does not play is worse than no hint.
      */
      choices: [
        {
          value: 'casual',
          label: 'Casual',
          hint: 'Plays whatever it legally can, at random — it will burn a wild on the first turn.',
        },
        {
          value: 'sharp',
          label: 'Sharp',
          hint: 'Leads with plain numbers, keeps its skips, draws and wilds back for later, and switches to the colour it holds most of.',
        },
      ],
      /**
       * PINNED WHEN THE HOUSE IS PAYING. `HOUSE_RETURN` was measured against `sharp` and nothing
       * else, so a player choosing `casual` at a `sharp` price is not an exploit to be found
       * later — it is the feature paying out on demand. The referee pins it inside the
       * transaction that takes the ante; this is what stops the control offering a choice the
       * deal will not honour.
       */
      pinnedForMoney: {
        value: HOUSE_TABLE_LEVEL,
        why: 'Playing the house, the bots play their best — the odds are priced against it.',
      },
    },
  ],
  /**
   * HOUSE RULES (plans/done/UNO_HOUSE_RULES.md) — the ways a TABLE agrees to play differently, as
   * opposed to `options` above, which is how one client does. The ids are the keys
   * `resolveHouseRules` reads, asserted as a bijection in `tests/uno-house-rules.test.ts`.
   *
   * EVERY ONE DEFAULTS OFF, and that is load-bearing rather than tidy: all-false IS the game as it
   * already plays, so a table nobody configures is exactly the table that existed before the
   * control did. All three are enforced by the reducer now — stacking in slice 2, places in slice
   * 3 — and none of them is spelled anywhere in `src/system/room`, which carries the bag and never
   * learns what a rule means.
   *
   * A HINT IS WHERE A GAME EXPLAINS ITS OWN MONEY. The lobby's ante line is OS copy and says "the
   * winner takes the pot", which stops being the whole truth under `playToLast` — so the correction
   * rides in the manifest, where a game may say game things, rather than teaching the lobby a rule
   * id it must never know.
   */
  houseRules: [
    {
      id: 'stack',
      label: 'Stacking',
      hint: 'Hit with a +2 and the next player can answer with a +2 of their own instead of drawing — passing the debt on and adding to it. Whoever cannot answer draws the whole pile.',
    },
    {
      id: 'crossStack',
      label: 'Cross-stacking',
      // IT SAID "…and a +4 answers a +2." — five words that only parse if you have just read the
      // line above and already know what "stacking" means, and this is the toggle people actually
      // asked about. The rule is not common knowledge and the panel is the only place it is ever
      // explained, so it says the whole thing, including the ASYMMETRY — which is a real rule and
      // not a quirk: a +2 answering a +4 is the version that does not terminate, since a table
      // holding enough +2s could keep one +4 alive forever (`tests/uno-stacking.test.ts`).
      hint: 'Lets a +4 answer a +2 as well, so the pile can escalate. Never the other way round — a +2 cannot answer a +4, or a stack could run forever.',
      // Meaningless on its own — there is no stack to cross. The lobby will not offer it until
      // stacking is on, and `resolveHouseRules` normalises it away if it arrives set anyway.
      requires: 'stack',
    },
    {
      id: 'playToLast',
      label: 'Play for places',
      hint: 'The round carries on after someone goes out, ranking 2nd, 3rd and so on down to the last player left holding cards. For money, the top half of the finishers split the pot instead of the winner taking all of it.',
    },
  ],
  /** The player's own toggles — see `AUTO_DRAW_PREF` above for what this kind is and why. */
  playerPrefs: [AUTO_DRAW_PREF],
} as const satisfies GameManifest;

/** The chosen `bots` option as the level the pure chooser takes. See `ticTacToeHouseLevel`. */
export function unoBotLevel(values: OptionValues): UnoLevel {
  return values.bots === 'casual' ? 'casual' : 'sharp';
}
