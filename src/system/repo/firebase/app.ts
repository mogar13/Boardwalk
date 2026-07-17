import { initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';
import { readFirebaseConfig, missingConfigMessage } from '@/system/repo/firebase/config';

/**
 * The one Firebase app. One `initializeApp`, one `Auth`, one `Database`, for the
 * process.
 *
 * THE WHOLE POINT, IN ONE V1 LINE:
 *
 *     setInterval(() => window.db, 50)
 *
 * That is in every game in The Game Shack, because the config was pasted inline into
 * 32 HTML files and a `<script type="module">` bridge assigned `window.db` at some
 * point after the classic scripts ran. So each game polled a global, twenty times a
 * second, to discover whether the database existed yet. `system_auth.js` has its own
 * version — `_watchAuth` polls for `window.fbOnAuthStateChanged` every 50ms, up to 100
 * attempts, then gives up — and every one of its methods opens with
 * `if (!window.fbAuth) return { ok: false, error: "Authentication not loaded." }`.
 *
 * A real module system deletes that entire class of problem: `import { auth } from
 * './app'` cannot run before this file has. What has to SURVIVE from it is the
 * invariant those guards were protecting — nothing touches Auth before it exists — and
 * here that is not a guard at all, it is what `import` means.
 *
 * WHY IT IS LAZY. Module-level `initializeApp(...)` would run at import, which means at
 * page load, which means a missing `.env.local` is a white screen with a stack trace in
 * the console. `firebaseReady()` lets `App.tsx` ask "is this thing configured?" and
 * render a panel that names the missing variables instead. Loud, but useful — v1's
 * failure mode was the opposite: silent, and diagnosed by a `setInterval` that never
 * resolved.
 */

interface Wiring {
  readonly auth: Auth;
  readonly db: Database;
}

/** Memoised, not re-derived. `initializeApp` twice with the same name is an error. */
let wiring: Wiring | null = null;
let failure: string | null = null;

function connect(): Wiring {
  // `import.meta.env` is Vite's, and it is why config.ts takes `env` as a parameter
  // rather than reaching for this — vite.config.ts calls the same reader from Node,
  // where this does not exist.
  //
  // No cast: `ImportMetaEnv` in src/vite-env.d.ts declares these keys as
  // `readonly x?: string`, which IS an `EnvLike`. That is the payoff for declaring the
  // shape rather than leaving `import.meta.env` as `any` — a cast here would accept a
  // typo'd variable name, which is exactly the bug the declaration exists to catch.
  const result = readFirebaseConfig(import.meta.env);

  if (!result.ok) throw new Error(missingConfigMessage(result.missing));

  const app = initializeApp(result.config);
  return { auth: getAuth(app), db: getDatabase(app) };
}

/**
 * Connect, or explain why not. Never throws.
 *
 * The failure is cached alongside the success: a config that was missing on the first
 * call is missing on every call, and retrying it per render would re-throw the same
 * error forever while looking like it might not.
 */
export function firebaseReady():
  { readonly ok: true } | { readonly ok: false; readonly error: string } {
  if (wiring !== null) return { ok: true };
  if (failure !== null) return { ok: false, error: failure };
  try {
    wiring = connect();
    return { ok: true };
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
    return { ok: false, error: failure };
  }
}

/**
 * The wiring, or a throw.
 *
 * Repo methods call this and do NOT handle the throw, deliberately. `RepoResult` is for
 * things the USER did — "username already taken" is a form state. "This app was
 * deployed without credentials" is not something a player can act on, and rendering it
 * into a form field is how a config error gets mistaken for a typo. The UI asks
 * `firebaseReady()` once, up front, and never mounts the form if the answer is no.
 */
function require_(): Wiring {
  const ready = firebaseReady();
  if (!ready.ok) throw new Error(ready.error);
  // `wiring` is non-null whenever firebaseReady() said ok — but that is two statements
  // apart and TypeScript is right not to take our word for it.
  if (wiring === null) throw new Error('Firebase wiring vanished after a successful connect.');
  return wiring;
}

export const firebaseAuth = (): Auth => require_().auth;
export const firebaseDb = (): Database => require_().db;
