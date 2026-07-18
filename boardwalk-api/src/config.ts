/**
 * Read the referee's configuration from the environment. Pure — no I/O, so it is
 * unit-testable and both the server and the tests build a config the same way.
 *
 * The web app's Firebase config is NOT a secret (see the frontend's repo/firebase/config.ts).
 * The referee's is different: it holds a service-account key that CAN sign tokens, so
 * `GOOGLE_APPLICATION_CREDENTIALS` points at a file that is git-ignored. That asymmetry is the
 * whole reason this service exists — the server is a thing a browser is not allowed to be.
 */

export type AuthMode = 'firebase' | 'insecure-dev';

export interface ApiConfig {
  readonly port: number;
  /** SQLite file path, or ':memory:' for tests. On the Pi this is on the mounted stick. */
  readonly dbPath: string;
  /** Firebase project id — the audience the Admin SDK checks ID tokens against. */
  readonly firebaseProjectId: string;
  /** CORS allow-list origin. The SPA is cross-origin (GitHub Pages → the Pi). */
  readonly allowedOrigin: string;
  /**
   * `firebase` verifies a real ID token with the Admin SDK. `insecure-dev` trusts an
   * `x-debug-uid` header and verifies NOTHING — it exists so the API can be driven against
   * the local emulator without minting real tokens, and the server REFUSES to start in it
   * unless `ALLOW_INSECURE_AUTH=1` is also set, so it can never be the accidental prod default.
   */
  readonly authMode: AuthMode;
  /** Explicit opt-in required to boot `insecure-dev`. */
  readonly allowInsecure: boolean;
  /**
   * The ticket signing key — the offline-hardening secret. Signs and verifies.
   *
   * ABSENT MEANS ENFORCEMENT IS OFF and `/settle` accepts client-minted nonces exactly as it did
   * before this feature. That is a fail-OPEN on a security control and it is deliberate, for three
   * reasons that are worth having written down where the switch lives:
   *
   *   • It is the kill switch in the shape this repo already uses (`VITE_API_ECONOMY=0`,
   *     `VITE_WS_ROOMS=0`, `VITE_API_BLACKJACK=0`), and the Pi deploys BY HAND — so a deploy that
   *     lands the code before the env var must degrade to yesterday's behaviour rather than 409 the
   *     settle route for every player on the live site.
   *   • This control is NOT what protects money. The ledger balance bounds a bet, the recorded
   *     wager bounds a payout, and blackjack is dealt server-side. Failing open costs the OFFLINE
   *     BOUND — a cap on fabricated XP and win counts — and not one chip.
   *   • Failing closed would mean a forgotten env var takes the economy down, which is a worse
   *     outcome than the thing it prevents.
   *
   * It is not silent: `configWarnings` says so at boot and `/health` reports `tickets`, so the
   * state is checkable from the artifact rather than inferred.
   */
  readonly ticketSecret: string;
  /**
   * Verifies only, never signs — the rotation overlap window. Rotating is: move the current value
   * here, generate a new `TICKET_SECRET`, restart. A player who was offline across the rotation
   * banks normally, because their batch still verifies under this key until the NEXT rotation drops
   * it. Without an overlap, every rotation would silently eat every outstanding offline result.
   */
  readonly ticketSecretPrevious: string;
}

export type EnvLike = Readonly<Record<string, string | undefined>>;

const int = (v: string | undefined, fallback: number): number => {
  const n = v === undefined ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

export function readConfig(env: EnvLike = process.env): ApiConfig {
  const authMode: AuthMode = env.AUTH_MODE === 'insecure-dev' ? 'insecure-dev' : 'firebase';
  return {
    port: int(env.PORT, 8787),
    dbPath: env.DB_PATH?.trim() ? env.DB_PATH : './data/boardwalk.db',
    firebaseProjectId: env.FIREBASE_PROJECT_ID?.trim() ?? '',
    allowedOrigin: env.ALLOWED_ORIGIN?.trim() ? env.ALLOWED_ORIGIN : '*',
    authMode,
    allowInsecure: env.ALLOW_INSECURE_AUTH === '1',
    ticketSecret: env.TICKET_SECRET?.trim() ?? '',
    ticketSecretPrevious: env.TICKET_SECRET_PREVIOUS?.trim() ?? '',
  };
}

/**
 * Fail loudly on a config that would be dangerous or non-functional, rather than booting a
 * server that is quietly wrong. Returns the list of problems; an empty list means go.
 */
export function configProblems(cfg: ApiConfig): readonly string[] {
  const problems: string[] = [];
  if (cfg.authMode === 'insecure-dev' && !cfg.allowInsecure) {
    problems.push(
      'AUTH_MODE=insecure-dev requires ALLOW_INSECURE_AUTH=1 — it trusts x-debug-uid and verifies no token. Never set this in production.'
    );
  }
  if (cfg.authMode === 'firebase' && cfg.firebaseProjectId === '') {
    problems.push('FIREBASE_PROJECT_ID is required when AUTH_MODE=firebase (the ID-token audience).');
  }
  if (cfg.ticketSecretPrevious !== '' && cfg.ticketSecret === '') {
    problems.push(
      'TICKET_SECRET_PREVIOUS is set without TICKET_SECRET — a verify-only key with nothing signing is a half-finished rotation, and it silently disables ticket enforcement.'
    );
  }
  if (cfg.ticketSecret !== '' && cfg.ticketSecret === cfg.ticketSecretPrevious) {
    problems.push(
      'TICKET_SECRET and TICKET_SECRET_PREVIOUS are identical — that is a rotation that did not rotate, and it would read as a completed one.'
    );
  }
  return problems;
}

/**
 * Non-fatal, but the operator must SEE them. Separate from `configProblems` because these do not
 * stop the server: a running economy with a bound switched off beats a dead one (see
 * `ticketSecret`), and the whole point is that this degrades rather than fails. Printed at boot,
 * and mirrored by `/health` so the state is provable from the artifact — the standing lesson that a
 * health check answering identically under two configurations is not evidence of either.
 */
export function configWarnings(cfg: ApiConfig): readonly string[] {
  const warnings: string[] = [];
  if (cfg.ticketSecret === '') {
    warnings.push(
      'TICKET_SECRET is not set — ticket enforcement is OFF and /settle accepts client-minted nonces. Offline results are not bounded. This is the documented fallback, not a crash, but it should be deliberate.'
    );
  }
  return warnings;
}
