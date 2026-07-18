import { Router, type Response } from 'express';
import type { Db } from '../db/db';
import { requireUid } from '../auth/middleware';
import { dealHand, playMove, type BlackjackResult, type Move } from '../domain/blackjack';

/**
 * THE BLACKJACK TABLE. Phase D's user-visible deliverable, and the reason the one game that can
 * win money no longer tells the server how much it won.
 *
 *   POST /blackjack/deal   {nonce, wagerCents}        → take the stake, SHUFFLE HERE, deal, answer
 *   POST /blackjack/move   {nonce, handId, move}      → hit | stand | double against a live hand
 *
 * READ THE BODIES AGAIN, because they are the design. Between them they carry a bet amount, a hand
 * id, a move name and two nonces. There is no `payoutCents`, no `outcome`, no `result`, no card and
 * no deck — not validated away, ABSENT. A hostile client cannot express the attack Phase B could
 * only bound with a ceiling ("blackjack, pay me 2.5×"), because there is nowhere on either request
 * to write it down. That is the meta-rule — make the wrong thing unspellable rather than documenting
 * "don't" — applied to the last money surface the client still owned.
 *
 * The response is `{profile, hand, replayed}`: the whole authoritative profile (so the client's
 * next render is the truth, not an optimistic guess reconciled later) plus the hand projected to
 * what the player may see. `hand.dealer` holds ONE card until the hand settles, and the deck is not
 * a field. See `domain/blackjack.ts`.
 *
 * 409-for-refusal / 400-for-unparseable is the economy routes' discipline and it is the same here:
 * "insufficient funds for that double" is ordinary game state, not a client bug.
 */

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

const NONCE_MAX_LEN = 128;
const nonceOf = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' && v.length <= NONCE_MAX_LEN ? v : null;

const intOf = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : Number.NaN;

const MOVES: readonly Move[] = ['hit', 'stand', 'double'];
const moveOf = (v: unknown): Move | null =>
  typeof v === 'string' && (MOVES as readonly string[]).includes(v) ? (v as Move) : null;

function reply(res: Response, result: BlackjackResult): void {
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({
    profile: result.value.profile,
    hand: result.value.hand,
    replayed: result.value.replayed,
  });
}

export function blackjackRouter(db: Db, clock: () => number = Date.now): Router {
  const router = Router();

  router.post('/blackjack/deal', (req, res) => {
    // The uid comes from the verified token and NEVER from the body — the same rule chat's
    // `uid === auth.uid` pins in `database.rules.json`, for the same reason: an author a request
    // can assert is an author a request can forge, and here it would be a stranger's bankroll.
    const uid = requireUid(req);
    const b = obj(req.body);
    const nonce = nonceOf(b.nonce);
    const wagerCents = intOf(b.wagerCents);
    if (nonce === null || !Number.isFinite(wagerCents)) {
      res.status(400).json({ error: 'nonce and wagerCents are required' });
      return;
    }
    // Only those two fields are read. Anything else on the body — a `payoutCents` from a hostile
    // client or a stale one — is never looked at, which is why it can do nothing.
    reply(res, dealHand(db, uid, { nonce, wagerCents }, clock()));
  });

  router.post('/blackjack/move', (req, res) => {
    const uid = requireUid(req);
    const b = obj(req.body);
    const nonce = nonceOf(b.nonce);
    const handId = intOf(b.handId);
    const move = moveOf(b.move);
    if (nonce === null || !Number.isFinite(handId) || move === null) {
      res.status(400).json({ error: 'nonce, handId and a valid move are required' });
      return;
    }
    // The hand is authorised in the domain, by uid, not here — see `loadHand`. A hand id belonging
    // to another account is a refusal, so this route never has to be the thing that remembers.
    reply(res, playMove(db, uid, { nonce, handId, move }, clock()));
  });

  return router;
}
