import type { GameManifest } from '@/games/registry';

/**
 * Blackjack — the SDK's economy test. Tic-Tac-Toe proved the OS is cheap for a no-stakes game;
 * Blackjack proves the other half: betting, the casino payout path, and `reportResult` moving real
 * money. Its `logic/` is where that lives (deck, ace-soft scoring, the settle matrix, the
 * integer-safe 3:2 natural — the exact chip v1 dropped), all unit-tested before this manifest had a
 * board to attach to.
 *
 * `pier: 'casino'` — the front of the boardwalk, where the money moves. `betting` is PRESENT (unlike
 * Tic-Tac-Toe's absent one): $5 to $500 a hand, in cents, which is what `useBet` reads to bound the
 * chip rack and what `reportResult` credits back. Money is integer cents everywhere; the field on
 * the profile is `bankrollCents` for the same reason.
 *
 * **`modes: ['ai', 'online']` — TWO ways in, and dropping the third is the point.** This game
 * declared `'solo'` for six phases: a room-less hand, no lobby, no seats, dealt behind
 * `BlackjackRepo` straight into `<GameShell>`. It was correct and it was indistinguishable from
 * `'ai'` at the one place a player meets it — the launch modal drew "Play" above "Solo / AI", two
 * buttons that both mean "blackjack by myself" and differ only in whether the other chairs hold
 * bots. `MODE_LABEL` already argues that two buttons a player cannot tell apart is a picker that
 * cannot be used; this is that argument reaching the manifest that causes it.
 *
 * What went with it is written where it is enforced (`BlackjackGame.tsx`): the board, the hook, the
 * repo and both implementations are DELETED, not left behind a mode nothing offers, and the cost —
 * no blackjack at all on the RTDB fallback, where the room-less hand used to still deal — is named
 * there rather than discovered during an outage.
 *
 * The ROOM-LESS proof was already Solitaire's before this: `modes: ['solo']` with no seats AND no
 * bankroll is the stronger claim about that seam, where Blackjack only ever made half of it. What
 * Blackjack keeps is the half that was only ever its own — the economy, the payouts, and cards it
 * does not deal itself.
 *
 * `seats: { min: 1, max: 4 }`, and this is the ONE game that may say 1 — see `dealerPlays` below.
 * Every room game needs somebody opposite, and that rule was enforced by counting CHAIRS until this
 * game showed the count and the rule are different questions: the dealer plays a hand and takes no
 * chair, so a one-chair blackjack table has an opponent where a one-chair UNO table has a person
 * alone in a room.
 *
 * **It read `{ min: 2, max: 4 }` for exactly as long as this game also declared `'solo'`, and
 * collapsing the two entrances is what turned that into a defect.** While the room-less hand
 * existed, "play alone against the dealer" had its own button and the table's minimum of two was
 * merely a second way in; deleting it left `'ai'` — labelled "Solo / AI" — as the only way in, with
 * a seat picker whose smallest rung was 2. So the entrance offered SOLO and then seated a bot next
 * to you with no way to ask it to leave. Nothing was broken by the deletion; what it removed was
 * the other half of a pair, and this manifest still described the pair. (v1's range was 1–4 and was
 * right about this by accident — it also permitted a 1-seat table at games that have no dealer.)
 *
 * `betting.perSeat` is what tells the OS this game has no TABLE stake. Every other betting game
 * charges one ante that the room stamps at create and every chair pays; here each chair names its
 * own, every round, from the board. Without the flag the lobby would draw an ante picker whose
 * value nothing charges and then print "$25 a seat · winner takes the pot" over a game with no pot
 * — a lobby that lies about money, which is what `tableBacking` already exists to prevent once.
 */
export const blackjackManifest = {
  id: 'blackjack',
  name: 'Blackjack',
  blurb: 'Beat the dealer to 21 without busting. A natural pays 3:2 — the house stands on all 17s.',
  icon: 'blackjack.png',
  pier: 'casino',
  seats: { min: 1, max: 4 },
  /**
   * The dealer is a player who takes no chair — see the header, and `GameManifest.dealerPlays` for
   * what the seat rule does with it. Blackjack is the only game in this registry that can say this
   * truthfully: UNO and Liar's Dice are dealt by the referee too, and their referee plays nothing.
   */
  dealerPlays: true,
  modes: ['ai', 'online'],
  betting: { min: 500, max: 50000, perSeat: true },
} as const satisfies GameManifest;
