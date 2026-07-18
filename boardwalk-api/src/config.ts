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
  return problems;
}
