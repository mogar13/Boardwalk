import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, type Database } from 'firebase/database';
import {
  readFirebaseConfig,
  missingConfigMessage,
  type FirebaseConfig,
} from '@/system/repo/firebase/config';

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

/**
 * DEV ONLY, and opt-in. When `VITE_USE_EMULATOR=1` in a dev build, the app points at the local
 * Firebase emulators instead of production — the "wire the app to the emulator behind a dev flag"
 * step Phase 3's gap named, which is what lets the whole room flow (sign-in, create, claim, chat,
 * teardown) be driven locally without touching `boardwalk-fca02`. `import.meta.env.DEV` gates it
 * so it can never be true in a production bundle, no matter what a stray env var says.
 */
const useEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === '1';

/**
 * A throwaway config for the emulator path, so the harness runs on a fresh clone with no
 * `.env.local`. The emulator ignores the API key and the project is `demo-` prefixed (matching the
 * rules test), so it refuses to touch any real project. When the flag is on this is used
 * REGARDLESS of any real `.env.local`, so the app and the emulator agree on one project namespace
 * — pointing a `boardwalk-fca02` app at the `demo-boardwalk` emulator would mismatch.
 */
const EMULATOR_CONFIG: FirebaseConfig = {
  apiKey: 'demo-key',
  authDomain: 'localhost',
  databaseURL: 'http://127.0.0.1:9000?ns=demo-boardwalk',
  projectId: 'demo-boardwalk',
  appId: 'demo-app',
};

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

  // With the emulator flag on, the demo config is used regardless (app and emulator must share one
  // project namespace). Otherwise the real config is required — a missing one is still the loud
  // failure it has always been.
  const config = useEmulator ? EMULATOR_CONFIG : result.ok ? result.config : null;
  if (config === null) throw new Error(missingConfigMessage(result.ok ? [] : result.missing));

  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getDatabase(app);

  if (useEmulator) {
    // Ports match firebase.json. `disableWarnings` silences the loud dev banner the auth emulator
    // prints — expected here, since being on the emulator is the whole point of the flag.
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(db, '127.0.0.1', 9000);
  }

  return { auth, db };
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
