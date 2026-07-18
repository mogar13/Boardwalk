import { Router, type Request, type Response, type NextFunction } from 'express';
import { TICKET_BATCH } from '@boardwalk/game-logic';
import type { Db } from '../db/db';
import { requireUid } from '../auth/middleware';
import {
  issueTickets,
  outstandingTickets,
  verifyTicket,
  wasIssued,
  type TicketKeyring,
} from '../domain/tickets';

/**
 * THE TICKET ROUTE AND THE TICKET GATE — offline hardening's two HTTP surfaces.
 *
 *   POST /tickets   {deviceId, want}   → a batch of signed nonces, capped per-UID
 *   (a gate on /settle)                → refuses a settle whose nonce is not a live ticket
 *
 * See `domain/tickets.ts` for the mechanism and `plans/OFFLINE_HARDENING.md` for the argument.
 */

const DEVICE_ID_MAX_LEN = 64;
/**
 * A device id is opaque and client-chosen, so the only things worth checking are that it is a
 * bounded string and that it cannot break the ticket's own encoding. A dot would: the format is
 * dot-separated, so a device id containing one would parse back into a different device id and
 * sequence, which is a forgery primitive rather than a cosmetic issue.
 */
const deviceIdOf = (v: unknown): string | null =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) && v.length <= DEVICE_ID_MAX_LEN
    ? v
    : null;

/**
 * Hand out tickets. Authenticated like every other route, so the uid is the server's — a client
 * cannot ask for someone else's tickets, and the uid is bound into each signature besides.
 *
 * There is no field here for a quantity the server must honour: `want` is a REQUEST, and the grant
 * is `min(want, TICKET_BATCH - outstanding)`. Asking for a million returns whatever brings the
 * account back to the cap, which is usually a handful and is sometimes zero.
 */
export function ticketsRouter(db: Db, keys: TicketKeyring, clock: () => number = Date.now): Router {
  const router = Router();

  router.post('/tickets', (req, res) => {
    const uid = requireUid(req);
    const b = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const deviceId = deviceIdOf(b.deviceId);
    if (deviceId === null) {
      res.status(400).json({ error: 'deviceId must be 8-64 chars of [A-Za-z0-9_-]' });
      return;
    }
    const rawWant = typeof b.want === 'number' && Number.isFinite(b.want) ? Math.round(b.want) : TICKET_BATCH;
    const want = Math.max(0, Math.min(rawWant, TICKET_BATCH));

    if (keys.current === null) {
      // Enforcement is off. Answer honestly rather than 404-ing: a client that gets `enabled:false`
      // knows to keep minting its own nonces and to stop asking, instead of retrying a route it
      // cannot tell apart from a broken one.
      res.json({ enabled: false, tickets: [], outstanding: 0, batch: TICKET_BATCH });
      return;
    }

    const grant = issueTickets(db, uid, deviceId, want, keys.current, clock());
    res.json({
      enabled: true,
      tickets: grant.tickets,
      outstanding: grant.outstanding,
      batch: TICKET_BATCH,
    });
  });

  return router;
}

/**
 * THE GATE. Mounted on `/settle` and nothing else.
 *
 * Scoped to one route deliberately, and the reason is not obvious enough to leave unwritten: THE
 * TICKETS ARE THE OFFLINE BANKING BUDGET. If an online action spent one, an online shopping spree
 * through `/purchase` or a run of `/pack` opens would drain the very counter that is supposed to
 * represent "results I can bank on a train". So the gate covers the only intent that is actually
 * queueable and the only one whose repetition inflates anything (XP, `played`, `won`).
 *
 * Everything else keeps client-minted nonces and is untouched by this feature: `/bet` is bounded by
 * the ledger balance, `/purchase` and `/pack` by the server's price and the server's roll, `/daily`
 * by the server's clock, and blackjack is structurally online because the server holds the cards.
 * None of them is bankable offline, so none of them needs a right-to-bank.
 *
 * ORDER OF CHECKS MATTERS. Everything here happens BEFORE the mutation's transaction, so every
 * refusal below leaves the ticket unspent — which is what makes the client's re-stamp-on-retired
 * path sound.
 */
export function ticketGate(db: Db, keys: TicketKeyring) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (keys.current === null && keys.previous === null) {
      next(); // Enforcement off — the documented fallback. See `config.ts`.
      return;
    }
    const uid = req.uid;
    if (uid === undefined) {
      next();
      return;
    }
    const b = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const nonce = typeof b.nonce === 'string' ? b.nonce : '';
    if (nonce === '') {
      next(); // A missing nonce is the route's own 400 to report, in its own words.
      return;
    }

    const checked = verifyTicket(keys, uid, nonce);
    if (!checked.ok) {
      // 409 rather than 400/401: the request is well-formed and the caller is authenticated: this
      // particular coupon is simply not spendable. `retired` is the one refusal the CLIENT may act
      // on by re-stamping, so it rides along as a flag rather than as a string to parse.
      res.status(409).json({ error: checked.error, ticket: checked.retired ? 'retired' : 'invalid' });
      return;
    }

    // A sequence the server never issued. Unreachable without the signing key — a client cannot
    // sign a ticket from the future — so this is the blast-radius bound if a key ever leaks: a
    // thief is confined to sequence space already handed out rather than minting forward forever.
    if (!wasIssued(db, uid, checked.value.deviceId, checked.value.seq)) {
      res.status(409).json({ error: 'that ticket was never issued', ticket: 'invalid' });
      return;
    }

    // NOTE what is deliberately NOT checked: that this seq follows the last one seen. Gaps are
    // accepted and never block. A player closes a tab mid-game, a ticket gets stamped onto an
    // intent that is then discarded, a retired ticket is re-stamped and its original is abandoned —
    // all routine, all leave a hole. Rejecting on a gap would wedge the queue behind a sequence
    // number that is never coming, and holding-and-reordering buys ordering that no mutation here
    // depends on (a settle is bounded by an open wager, not by its predecessor). The gap stays
    // VISIBLE — it is `issued_seq - spent_count` in `ticket_devices` — which is the honest amount
    // of machinery for one player: derivable state, not an alerting pipeline nobody reads.
    next();
  };
}

/** Exported for `/health`, so the switch's state is readable from the artifact. */
export const ticketsEnabled = (keys: TicketKeyring): boolean => keys.current !== null;

export { outstandingTickets };
