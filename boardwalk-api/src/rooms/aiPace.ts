/**
 * HOW LONG A BOT WAITS BEFORE IT ACTS — one number, for every game the referee deals.
 *
 * WHY IT MOVED. It was 900ms in UNO, 900ms in blackjack and 1,100ms in Liar's Dice: three literals
 * for one decision, which is three chances to drift and no place to change your mind. And the
 * decision itself was wrong — at 900ms a 4-seat UNO table plays a full rotation of bots in 2.7
 * seconds, so a hand of cards goes past faster than the move log can be read and the table
 * "goes crazy fast", which is exactly what it was reported as. A bot's pause is not latency to be
 * minimised; it is the beat that makes a table legible.
 *
 * WHY THIS NUMBER. A player has to read one line of commentary ("CPU 3 played Red 8", or the four
 * lines a draw-four expands into) before the next thing happens, and they have to be able to look
 * at the felt rather than at the log. 1.5s is comfortably past a glance and short of a wait: three
 * bots take 4.5 seconds between your turns, which is about as long as anyone will sit still for at
 * a card table.
 *
 * WHY ONE NUMBER AND NOT THREE. The pause is a property of "a bot is taking a turn while a person
 * watches", which is the same event in all three games. Liar's Dice's 1,100 was the only one that
 * had ever been reasoned about (a bid is more to read than a card), and it is inside the noise of
 * this value — so the honest version of that reasoning is that they should all be at the higher
 * number, not that each should keep its own. If a game ever genuinely needs its own beat, give it
 * one *here*, next to this argument, rather than in its dealer where nobody will find it.
 *
 * NOTE FOR THE DEPLOY: this is server-side, so it changes nothing until the Pi carries it. An old
 * referee simply keeps the old pace — the safest possible deploy-order failure, since there is no
 * wire field, no client that reads it and nothing that can lie about it.
 */
export const AI_DELAY_MS = 1_500;
