/// <reference types="vite/client" />

/**
 * The env vars this app reads, typed.
 *
 * `import.meta.env` is `any`-shaped without this, so `env.VITE_FIREBASE_API_KY` (note the
 * typo) would typecheck, build, deploy, and fail at runtime with "Firebase is not
 * configured" naming a variable that IS set. Declaring the shape turns that into a red
 * squiggle. The type is the guard; `readFirebaseConfig` is the runtime check for the case
 * types cannot see — a variable that exists but is empty.
 *
 * All optional, because at type level none of them are guaranteed: a `.env.local` that
 * does not exist is not a compile error. `readFirebaseConfig` is the one place that turns
 * "might be missing" into "definitely here or definitely reported".
 */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_DATABASE_URL?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  /**
   * The `boardwalk-api` base URL (BACKEND_PLAN.md Phase A). OPTIONAL, unlike the Firebase keys: its
   * absence disables shadow mode rather than failing the build, so a fresh clone and the emulator
   * harness run without it. When present, the composition root mirrors profile writes here — see
   * `@/system/repo` and `@/system/repo/shadow`. Injected like the Firebase config; a GitHub Actions
   * secret in prod.
   */
  readonly VITE_API_BASE_URL?: string;
  /**
   * PHASE C CUTOVER (BACKEND_PLAN.md): rooms + chat run over the `boardwalk-api` WebSocket referee by
   * default wherever `VITE_API_BASE_URL` is set (inert under the emulator). This var is now the KILL
   * SWITCH, not the enable: `'0'` forces rooms back onto Firebase RTDB (a rebuild, no code change) if
   * the Pi is down. See `@/system/repo` and `@/system/repo/api/socket`.
   */
  readonly VITE_WS_ROOMS?: string;
  /**
   * PHASE B CUTOVER (BACKEND_PLAN.md): SQLite is the source of truth for the profile, the economy
   * and the stats wherever `VITE_API_BASE_URL` is set. Like `VITE_WS_ROOMS`, this is the KILL
   * SWITCH and not the enable: `'0'` forces the economy back to the Phase-A arrangement (Firebase
   * authoritative, the API a shadow mirror) with a rebuild and no code change.
   *
   * It was UNDECLARED here and UNWIRED in `.github/workflows/deploy.yml` until 2026-07-18 — Vite
   * only embeds a `VITE_*` var present in the build environment, so setting the secret did nothing
   * and the deploy went green while doing it. `tests/deploy-env.test.ts` now guards the wiring.
   */
  readonly VITE_API_ECONOMY?: string;
  /**
   * DEV-ONLY opt-in: `'1'` points the app at the local Firebase emulators (see
   * `@/system/repo/firebase/app`). Gated by `import.meta.env.DEV` there, so it is inert in a
   * production build. This is how the Phase 5 lobby harness drives a real room flow locally.
   */
  readonly VITE_USE_EMULATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
