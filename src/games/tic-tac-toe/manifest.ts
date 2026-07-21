import type { GameManifest } from '@/games/registry';
import type { OptionValues } from '@/system/options/options';
import type { TicTacToeLevel } from '@boardwalk/game-logic/games/tic-tac-toe';

/**
 * Tic-Tac-Toe — the SDK's smoke test. ARCHITECTURE.md: "If this isn't ~150 lines, the SDK is
 * wrong. Better to find the SDK is wrong on a 150-line game than on Blackjack." So this game
 * exists to PROVE the OS carries the weight, not to be interesting: it declares a manifest, draws
 * a board against tested pure logic, and reaches for the room/seats/economy hooks — and if any of
 * that turns out to cost a game more than a few lines, that is a finding about the SDK.
 *
 * `as const satisfies GameManifest` is the load-bearing bit: `as const` freezes `id` to the
 * literal `'tic-tac-toe'` so the registry keys on that exact string, and `satisfies` checks the
 * shape without widening it. This is where the "no id drift" guarantee is paid for — the stats
 * key, the room path (`rooms/tic-tac-toe/...`) and the `/play/tic-tac-toe` route are all this one
 * string, and there is nowhere for a second spelling (v1's `texas_holdem` → `"poker"`) to live.
 *
 * `pier: 'tables'` — skill, no stakes. `betting` is ABSENT, not `false`: the manifest's optional
 * `betting` says money is not on the table at all, which is a different fact from "the minimum bet
 * is zero", and `useBet` throws if a game with no `betting` ever renders a chip rack. `seats`
 * `{ min: 1, max: 2 }`: two chairs, and `min: 1` human because vs-AI seats one person opposite a
 * bot. `modes` offers `ai` and `online`; hot-seat (one screen, two humans) is Chess's assigned
 * coverage, and folding it in here would test the same `sharedScreen` path twice while leaving
 * this game's point — "is the SDK cheap?" — no better answered.
 */
export const ticTacToeManifest = {
  id: 'tic-tac-toe',
  name: 'Tic-Tac-Toe',
  blurb: 'Three in a row. The oldest table on the boardwalk — play a friend or the house.',
  icon: 'tic-tac-toe.png',
  pier: 'tables',
  seats: { min: 1, max: 2 },
  modes: ['ai', 'online'],
  /**
   * AI difficulty (V1_FEATURE_GAPS #1) as what it always was: an OPTION, not a second mechanism.
   * The seam is the one Solitaire's draw count already uses — declared data the OS renders, read
   * back with `useGameOptions()` — and the only thing this file adds is the vocabulary. What each
   * level MEANS is in the pure rulebook next to the reducer it drives
   * (`chooseAiMove` in `@boardwalk/game-logic/games/tic-tac-toe`), so the house's difficulty is a
   * value a unit test can pin rather than engine code in a component. That is the half v1 got
   * wrong: its depth→tier maps were the right instinct, wired into a HUD dropdown where nothing
   * could test them.
   *
   * `perfect` is the default because it is what this table has always dealt — an unbeatable house
   * is Tic-Tac-Toe's whole character, and a new option must not quietly change a shipped game.
   */
  options: [
    {
      id: 'house',
      label: 'House',
      type: 'select',
      default: 'perfect',
      choices: [
        { value: 'casual', label: 'Casual' },
        { value: 'sharp', label: 'Sharp' },
        { value: 'perfect', label: 'Perfect' },
      ],
    },
  ],
} as const satisfies GameManifest;

/**
 * The chosen `house` option as the level the pure chooser takes — the same shape as Solitaire's
 * `solitaireDrawCount`, and for the same reason: an option's meaning belongs to the game. `values`
 * is complete and valid by construction (`resolveOptionValues`), so the fallback is unreachable and
 * lands on the manifest's own default rather than inventing a fourth answer.
 */
export function ticTacToeHouseLevel(values: OptionValues): TicTacToeLevel {
  return values.house === 'casual' ? 'casual' : values.house === 'sharp' ? 'sharp' : 'perfect';
}
