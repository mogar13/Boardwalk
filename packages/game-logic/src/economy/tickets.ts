/**
 * THE OFFLINE BANKING BUDGET — the one ticket rule both sides have to agree about.
 *
 * A ticket is a server-signed nonce: the client spends one per banked `settle`, and it cannot mint
 * more than it was issued. That is what bounds how much work a client can fabricate while it is
 * the only witness. See `plans/done/OFFLINE_HARDENING.md` for the whole design; what lives HERE is only
 * the numbers, because they are the part the referee enforces and the client plays.
 *
 * WHY THESE TWO CONSTANTS ARE SHARED AND THE CRYPTO IS NOT. The server caps a uid's outstanding
 * tickets at `TICKET_BATCH` and the client tops up TO `TICKET_BATCH`; if those two numbers ever
 * disagreed, the client would either loop asking for tickets it can never be granted, or quietly
 * run a smaller offline budget than the bound it thinks it has. That is precisely the class of
 * drift `packages/game-logic` exists to make impossible — one number, both readers.
 *
 * Signing and verifying are NOT here and must not come here: they need the secret and `node:crypto`,
 * neither of which a browser may hold. A ticket is opaque to the client — it stores the string and
 * spends it, and never looks inside. So the format lives with the only code that reads it,
 * `boardwalk-api/src/domain/tickets.ts`.
 *
 * THE HONEST NAME FOR THIS BOUND. Offline *duration* is unbounded — a ticket has no expiry, so a
 * device offline for a year reconnects and banks what it holds. Offline *volume* is bounded, at
 * exactly `TICKET_BATCH`, and it inherently must be: any scheme where the server issues the right
 * to bank issues a finite number of them in advance. Do not describe this as "unbounded offline
 * play" without the qualifier — the two axes are different and only one of them is unbounded.
 */

/**
 * The most unspent tickets one account may hold at once, summed across EVERY device it has
 * registered — not per device. Nothing stops a client claiming to be a hundred devices (the device
 * id is a random string it makes up, and there is no attestation anywhere in this design), so a
 * per-device cap would multiply with fabricated devices instead of bounding anything. Per-uid, a
 * client that invents devices is dividing its own 64 rather than multiplying it.
 *
 * 64 finished games is a long train ride and a short flight: far past any real session, far short
 * of a number that makes leaderboard inflation interesting. It is also the client outbox cap, and
 * deliberately the same number — a full outbox and an empty ticket store are the same condition,
 * and two constants would let them disagree.
 */
export const TICKET_BATCH = 64;

/**
 * Top up when fewer than this many remain. A margin rather than a trickle: refilling at 16 means
 * the request happens well before the store is empty, so a top-up is never on the critical path of
 * a player finishing a game, and a device that drops offline mid-session still leaves with a
 * near-full budget.
 */
export const TICKET_LOW = 16;
