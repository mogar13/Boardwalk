import type { GameManifest } from '@/games/registry';

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
  pier: 'tables',
  seats: { min: 1, max: 2 },
  modes: ['ai', 'online'],
} as const satisfies GameManifest;
