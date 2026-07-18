import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { TICKET_BATCH } from '@boardwalk/game-logic';
import type { Db } from '../db/db';

/**
 * SERVER-SIGNED NONCES — the bound on how much work an offline client can fabricate.
 *
 * Read `plans/OFFLINE_HARDENING.md` first; this file is the mechanism, not the argument. The short
 * version: the locked Phase-B decision is that offline wins are RANKED and sync on reconnect, which
 * means results are banked while the client is the only witness. Every mutation is already
 * idempotent on a nonce, and that collapses a retry into one effect — but it assumes the nonce was
 * minted ONCE, by an honest client, at the moment of the event. An offline queue breaks that: the
 * client decides how many nonces exist for what it claims is one game, so the server cannot tell
 * "I won three on the train" from "I minted three nonces for one hand".
 *
 * A ticket closes that by making the nonce something the client cannot make up. It is spent exactly
 * where a nonce was spent — the `nonce` field — so `EconomyIntent` does not change by one field and
 * the property that no intent has a place to put a balance, a price, an XP amount, a stat count, a
 * clock, a seed or an item survives untouched.
 *
 * WHAT THIS IS NOT. A ticket is NOT an identity and must never become one. `auth/verify.ts` opens
 * with "identity stays in Firebase Auth… do NOT hand-roll JWTs", and that rule stands. A ticket is
 * a bearer coupon that is only meaningful when presented ALONGSIDE a verified Firebase token for
 * the uid it was issued to: nothing is authenticated by a ticket, and a ticket only ever narrows
 * what an already-authenticated request may do. That is why a symmetric MAC verified by the one
 * process that issues it is the right primitive, and why a JWT here would be borrowed ceremony.
 *
 * WHAT IT DOES NOT BUY, stated so nobody later mistakes the mechanism for more than it is: it does
 * not make a self-reported outcome true. A client that is ONLINE can already spam `/settle` for
 * chess with fresh tickets, refilling its batch each time. Tickets bound the offline surface to the
 * online surface; they do not shrink the online one. Closing THAT is the server holding the match,
 * which is a much larger job (ROADMAP item 4).
 *
 * FORMAT — `v1.<kid>.<deviceId>.<seq>.<sig>`
 *
 * The uid is in the MAC input but NOT in the string: the server already knows it from `req.uid`, so
 * binding it into the signature makes a ticket issued to one account fail to verify for another,
 * without putting an account id on the wire. The device id IS in the string, because the spend has
 * to be attributed to a device without a lookup.
 */

/** One live signing key, with the id that selects it. See `ticketKeys` for why a `kid` exists. */
export interface TicketKey {
  readonly kid: string;
  readonly secret: string;
}

export interface TicketKeyring {
  /** Signs new tickets, and verifies. Absent = ticket enforcement is OFF; see `app.ts`. */
  readonly current: TicketKey | null;
  /** Verifies only, never signs — the rotation overlap window. */
  readonly previous: TicketKey | null;
}

/** A verified ticket, decomposed. `deviceId` is a namespace, NOT an authorization — see below. */
export interface VerifiedTicket {
  readonly deviceId: string;
  readonly seq: number;
}

export type TicketCheck =
  | { readonly ok: true; readonly value: VerifiedTicket }
  | { readonly ok: false; readonly error: string; readonly retired: boolean };

/**
 * The key id, DERIVED from the key rather than configured beside it.
 *
 * Rotation is then just "change the secret" — there is no second env var to keep in step and no way
 * to ship a new key under an old id, which would silently make every outstanding ticket verify
 * against the wrong secret and fail. Eight hex characters is far more than enough to tell two keys
 * apart; this is a selector, not a security boundary (the MAC is the security boundary).
 */
export function keyIdOf(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 8);
}

/** Build the keyring from raw secrets. A blank/absent secret is `null`, not an empty-string key. */
export function ticketKeys(current?: string, previous?: string): TicketKeyring {
  const key = (s?: string): TicketKey | null => {
    const secret = s?.trim() ?? '';
    return secret === '' ? null : { kid: keyIdOf(secret), secret };
  };
  return { current: key(current), previous: key(previous) };
}

const SIG_LEN = 22; // base64url of a 128-bit prefix — plenty for a MAC nobody can grind offline.

function sign(secret: string, uid: string, deviceId: string, seq: number, kid: string): string {
  return createHmac('sha256', secret)
    .update(`v1.${kid}.${uid}.${deviceId}.${String(seq)}`, 'utf8')
    .digest('base64url')
    .slice(0, SIG_LEN);
}

function mint(key: TicketKey, uid: string, deviceId: string, seq: number): string {
  return `v1.${key.kid}.${deviceId}.${String(seq)}.${sign(key.secret, uid, deviceId, seq, key.kid)}`;
}

/**
 * Pull the device id out of a ticket-shaped string WITHOUT verifying it.
 *
 * Used by `claimNonce` to attribute a spend, and safe there for two reasons: by that point the
 * middleware has already verified the signature, and when enforcement is OFF a client-minted nonce
 * that happens to look like a ticket updates a `ticket_devices` row that does not exist — zero rows
 * changed, no effect. Parsing a shape is not trusting it.
 */
export function deviceOfTicket(nonce: string): string | null {
  const parts = nonce.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const deviceId = parts[2];
  return deviceId === undefined || deviceId === '' ? null : deviceId;
}

/**
 * Verify a ticket's signature and its binding to this uid. Does NOT check that the sequence was
 * ever issued — that needs the database and lives in the middleware, alongside the spend.
 *
 * `retired` distinguishes the one refusal that is the SERVER'S fault rather than the player's: a
 * ticket signed under a key that has been rotated all the way out. The client is allowed to
 * re-stamp that queued result with a fresh ticket and re-send, which is sound only because a
 * refused ticket is provably UNSPENT — refusal happens here, before the `mutations` insert. A
 * ticket that was ACCEPTED is never re-stamped; that would be the double-pay bug this whole design
 * exists to prevent.
 */
export function verifyTicket(keys: TicketKeyring, uid: string, nonce: string): TicketCheck {
  const refuse = (error: string, retired = false): TicketCheck => ({ ok: false, error, retired });

  const parts = nonce.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return refuse('not a ticket');
  const [, kid, deviceId, rawSeq, sig] = parts;
  // Explicit rather than a `!`: `noUncheckedIndexedAccess` is right that a length check does not
  // narrow a destructure, and this is the one function in the system that reads an attacker-supplied
  // string — the place to spell the check out rather than assert it away.
  if (kid === undefined || deviceId === undefined || rawSeq === undefined || sig === undefined) {
    return refuse('malformed ticket');
  }
  if (deviceId === '' || sig === '') return refuse('malformed ticket');

  const seq = Number.parseInt(rawSeq, 10);
  // `String(seq) !== rawSeq` is the canonical-form check: '01' and '1e0' both parse to 1, and two
  // spellings of one sequence number would otherwise be two spendable nonces for one ticket.
  if (!Number.isSafeInteger(seq) || seq <= 0 || String(seq) !== rawSeq) {
    return refuse('malformed ticket');
  }

  // Select the key by id rather than trying both: trying both is how a key you meant to retire
  // quietly stays live, and it is the failure mode nobody notices because everything keeps working.
  const key =
    keys.current?.kid === kid ? keys.current : keys.previous?.kid === kid ? keys.previous : null;
  if (key === null) {
    return refuse('this ticket was signed with a key that is no longer in use', true);
  }

  const expected = Buffer.from(sign(key.secret, uid, deviceId, seq, kid), 'utf8');
  const actual = Buffer.from(sig, 'utf8');
  // Length check first — `timingSafeEqual` THROWS on a length mismatch rather than returning false,
  // so a forged ticket with a short signature would be a 500 instead of a refusal.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return refuse('invalid ticket');
  }

  return { ok: true, value: { deviceId, seq } };
}

/* ------------------------------------------------------------------ issuance */

interface DeviceRow {
  issued_seq: number;
  spent_count: number;
}

/**
 * How many unspent tickets this uid holds, across EVERY device.
 *
 * PER-UID, AND THAT IS THE WHOLE POINT. The device id is a random string the client generates and
 * persists; there is no attestation, and a client can clear storage or simply lie and be a new
 * device whenever it likes. Pretending otherwise would be v1's forgeable `isDev` in a new costume —
 * a field that grants nothing but that the next feature believes. So the cap refuses to make the
 * device a trust boundary: registering a hundred devices yields zero extra tickets, because a
 * client that fabricates devices is dividing its own `TICKET_BATCH` rather than multiplying it.
 *
 * The device id is a SEQUENCE NAMESPACE (each device numbers its own tickets without cross-device
 * coordination, and a gap is attributable to one device) and a diagnostic. It is never an
 * authorization, and no check anywhere may treat it as one.
 */
export function outstandingTickets(db: Db, uid: string): number {
  const row = db
    .prepare(
      'SELECT COALESCE(SUM(issued_seq - spent_count), 0) AS n FROM ticket_devices WHERE uid = ?'
    )
    .get(uid) as { n: number };
  return row.n;
}

export interface TicketGrant {
  readonly tickets: readonly string[];
  /** What the uid holds after this grant — the client renders it as its offline budget. */
  readonly outstanding: number;
}

/**
 * Issue up to `want` tickets, capped so the uid never holds more than `TICKET_BATCH` unspent.
 *
 * Returns an EMPTY list rather than refusing when the cap is already reached: "you have all the
 * tickets you are allowed" is a normal state a client tops up into, not an error worth a 409. The
 * client learns where it stands from `outstanding`.
 */
export function issueTickets(
  db: Db,
  uid: string,
  deviceId: string,
  want: number,
  key: TicketKey,
  now: number
): TicketGrant {
  const tx = db.transaction((): TicketGrant => {
    db.prepare(
      `INSERT INTO ticket_devices (uid, device_id, issued_seq, spent_count, created_at, last_seen_at)
       VALUES (?, ?, 0, 0, ?, ?)
       ON CONFLICT(uid, device_id) DO UPDATE SET last_seen_at = ?`
    ).run(uid, deviceId, now, now, now);

    const outstanding = outstandingTickets(db, uid);
    const grant = Math.max(0, Math.min(want, TICKET_BATCH - outstanding));
    if (grant === 0) return { tickets: [], outstanding };

    const row = db
      .prepare('SELECT issued_seq, spent_count FROM ticket_devices WHERE uid = ? AND device_id = ?')
      .get(uid, deviceId) as DeviceRow;

    const tickets: string[] = [];
    for (let i = 1; i <= grant; i += 1) {
      tickets.push(mint(key, uid, deviceId, row.issued_seq + i));
    }
    db.prepare('UPDATE ticket_devices SET issued_seq = ? WHERE uid = ? AND device_id = ?').run(
      row.issued_seq + grant,
      uid,
      deviceId
    );

    return { tickets, outstanding: outstanding + grant };
  });
  return tx();
}

/**
 * Was this sequence number ever issued to this device? A client cannot present a ticket from the
 * future — it could not sign one — but this bounds the damage if a key ever leaks: a thief is
 * confined to sequence space the server has already handed out, rather than being able to mint
 * forward forever.
 */
export function wasIssued(db: Db, uid: string, deviceId: string, seq: number): boolean {
  const row = db
    .prepare('SELECT issued_seq FROM ticket_devices WHERE uid = ? AND device_id = ?')
    .get(uid, deviceId) as { issued_seq: number } | undefined;
  return row !== undefined && seq <= row.issued_seq;
}
