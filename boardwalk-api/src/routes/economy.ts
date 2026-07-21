import { Router, type Response } from 'express';
import type { Db } from '../db/db';
import { requireUid } from '../auth/middleware';
import {
  applyBet,
  applyDaily,
  applyPack,
  applyPurchase,
  applyRefill,
  applySettle,
  type MutationResult,
} from '../domain/mutations';
import type { Outcome } from '../domain/economy';

/**
 * THE MONEY ROUTES. Phase B's user-visible deliverable, and the reason a devtools console stops
 * being an ATM.
 *
 *   POST /bet       {nonce, gameId, amountCents}                   → deduct a legal, affordable wager
 *   POST /settle    {nonce, gameId, outcome, payoutCents, …}       → credit a BOUNDED payout, bump stats/XP
 *   POST /purchase  {nonce, itemId}                                 → buy at the SERVER'S price
 *   POST /daily     {nonce}                                         → claim against the SERVER'S clock
 *   POST /refill    {nonce}                                         → top a BROKE bankroll up to the floor
 *   POST /pack      {nonce, packId}                                 → roll a pull HERE, at the published odds
 *
 * Every one answers with the whole authoritative profile, so the client's next render is the
 * truth rather than its own optimistic guess reconciled later by a separate read. One round trip,
 * one answer — and because that answer includes the balance, there is no response shape in which
 * a client learns money moved without learning the new total.
 *
 * WHAT THE BODIES DO NOT CONTAIN, which is the design:
 *   • no balance, anywhere. The server derives it from the ledger and nothing overrides it.
 *   • no price. `/purchase` names an item; the price is looked up here.
 *   • no timestamp. `/daily` gets the server's clock; a wound-back device buys nothing.
 *   • no stat counts and no xp. `/settle` sends an OUTCOME and the counters move by one, here.
 *   • no seed and no item. `/pack` names a PACK; the roll happens here, so a client cannot pick
 *     its own legendary. It is told what it got — and on a retry, told the same thing again.
 *
 *   • no amount, on `/refill` either. It names nothing at all. How much is `refillGrantFor` over
 *     the LEDGER'S balance, and whether you may is counted off the ledger's own rows.
 *
 * `nonce` is required on all six and is what makes a retry safe — see `mutations.ts`.
 */

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

const NONCE_MAX_LEN = 128;
/** A nonce is opaque; we only care that it is a bounded, non-empty string we can key on. */
const nonceOf = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' && v.length <= NONCE_MAX_LEN ? v : null;

const ID_MAX_LEN = 64;
const idOf = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' && v.length <= ID_MAX_LEN ? v : null;

const intOf = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : Number.NaN;

const OUTCOMES: readonly Outcome[] = ['win', 'loss', 'push'];
const outcomeOf = (v: unknown): Outcome | null =>
  typeof v === 'string' && (OUTCOMES as readonly string[]).includes(v) ? (v as Outcome) : null;

const stringList = (v: unknown): readonly string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * Map a domain decision onto HTTP. A refusal is **409**, not 400: the request was well-formed and
 * the server understood it — it simply is not true right now ("insufficient funds", "already
 * claimed today"). 400 would say the client sent nonsense, which sends the frontend down a
 * "you have a bug" path for what is ordinary game state. Malformed bodies DO get 400, above.
 */
function reply(res: Response, result: MutationResult): void {
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }
  const { profile, replayed, pull } = result.value;
  // `pull` rides along only for `/pack` — the other four have no outcome the client cannot
  // derive, and an always-present null would invite a reader to think they might.
  res.json(pull === undefined ? { profile, replayed } : { profile, replayed, pull });
}

export function economyRouter(db: Db, clock: () => number = Date.now): Router {
  const router = Router();

  router.post('/bet', (req, res) => {
    const uid = requireUid(req);
    const b = obj(req.body);
    const nonce = nonceOf(b.nonce);
    const gameId = idOf(b.gameId);
    const amountCents = intOf(b.amountCents);
    if (nonce === null || gameId === null || !Number.isFinite(amountCents)) {
      res.status(400).json({ error: 'nonce, gameId and amountCents are required' });
      return;
    }
    reply(res, applyBet(db, uid, { nonce, gameId, amountCents }, clock()));
  });

  router.post('/settle', (req, res) => {
    const uid = requireUid(req);
    const b = obj(req.body);
    const nonce = nonceOf(b.nonce);
    const gameId = idOf(b.gameId);
    const outcome = outcomeOf(b.outcome);
    // A missing payout is 0, not an error: the non-betting games (chess, solitaire) report an
    // outcome and nothing else, and `checkSettle` already refuses a non-zero payout with no stake.
    const payoutCents = b.payoutCents === undefined ? 0 : intOf(b.payoutCents);
    if (nonce === null || gameId === null || outcome === null || !Number.isFinite(payoutCents)) {
      res.status(400).json({ error: 'nonce, gameId and a valid outcome are required' });
      return;
    }
    reply(
      res,
      applySettle(
        db,
        uid,
        {
          nonce,
          gameId,
          outcome,
          payoutCents,
          // Feats only. `unlockedAchievementIds` and `grantedItemIds` used to be read here and
          // are deliberately NOT read any more — the server recomputes both from its own state
          // (Phase D). A client still sending them is ignored rather than refused: the fields are
          // harmless noise on a body, and 400-ing a stale client mid-hand would cost a player
          // their result to punish a request that can no longer do anything.
          feats: stringList(b.feats),
        },
        clock()
      )
    );
  });

  router.post('/purchase', (req, res) => {
    const uid = requireUid(req);
    const b = obj(req.body);
    const nonce = nonceOf(b.nonce);
    const itemId = idOf(b.itemId);
    if (nonce === null || itemId === null) {
      res.status(400).json({ error: 'nonce and itemId are required' });
      return;
    }
    reply(res, applyPurchase(db, uid, { nonce, itemId }, clock()));
  });

  router.post('/daily', (req, res) => {
    const uid = requireUid(req);
    const nonce = nonceOf(obj(req.body).nonce);
    if (nonce === null) {
      res.status(400).json({ error: 'nonce is required' });
      return;
    }
    reply(res, applyDaily(db, uid, { nonce }, clock()));
  });

  /**
   * The bankrupt refill. Body-for-body identical to `/daily` — a nonce, and nothing else — which is
   * the whole security argument in one line: there is no amount to inflate and no clock to wind.
   */
  router.post('/refill', (req, res) => {
    const uid = requireUid(req);
    const nonce = nonceOf(obj(req.body).nonce);
    if (nonce === null) {
      res.status(400).json({ error: 'nonce is required' });
      return;
    }
    reply(res, applyRefill(db, uid, { nonce }, clock()));
  });

  router.post('/pack', (req, res) => {
    const uid = requireUid(req);
    const b = obj(req.body);
    const nonce = nonceOf(b.nonce);
    const packId = idOf(b.packId);
    if (nonce === null || packId === null) {
      res.status(400).json({ error: 'nonce and packId are required' });
      return;
    }
    // An UNKNOWN packId is a 409, not a 400 — the body is well-formed and the server understood
    // it perfectly; "no such pack" is state, the same way "insufficient funds" is. `checkPack`
    // makes that call, not this parser, which only rejects a body it cannot read at all.
    reply(res, applyPack(db, uid, { nonce, packId }, clock()));
  });

  return router;
}
