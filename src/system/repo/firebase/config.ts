/**
 * Read the Firebase config out of the environment. Pure — no `firebase/*`, no
 * `import.meta`, no DOM, no Node.
 *
 * WHY IT TAKES `env` AS AN ARGUMENT INSTEAD OF READING `import.meta.env` ITSELF. It
 * has two callers that cannot see each other: `./app.ts` (the browser, via
 * `import.meta.env`) and `vite.config.ts` (Node, via `loadEnv`), which fails the BUILD
 * when the credentials are missing rather than shipping a site that cannot sign anyone
 * in. A module that reached for `import.meta.env` directly could not be called from the
 * second, and the required-key list would be copied into the build config — which is
 * the exact defect that put v1's Firebase config inline in 32 HTML files. One list, one
 * home, two readers.
 *
 * WHY THE CONFIG IS INJECTED AND NOT COMMITTED. CLAUDE.md's rule. Worth being precise
 * about what it does and does not buy, because the usual reason is wrong: a Firebase
 * web config is NOT a secret. Google says so, it is readable in the built bundle by
 * anyone who opens devtools, and it has to be — the browser needs it to make the first
 * request. `database.rules.json` is what stops a stranger reading your data, not
 * obscurity about the API key. What injection actually buys is that `dev` and `prod`
 * can point at different projects, and that the value has ONE home instead of a copy
 * per environment. That is the v1 row this rule was bought by: 32 copies, each free to
 * drift, each game polling `setInterval(() => window.db, 50)` to discover which one had
 * loaded.
 */

/** Just enough of `FirebaseOptions` to initialise Auth + RTDB. Not imported from the SDK — this file may not touch it, and duplicating five field names is cheaper than the boundary it would cost. */
export interface FirebaseConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly databaseURL: string;
  readonly projectId: string;
  readonly appId: string;
  /** Optional: analytics only. The app does not use it, so a missing one is not a failure. */
  readonly measurementId?: string;
}

/**
 * Required, in the order a person should fix them. `storageBucket` and
 * `messagingSenderId` are in every Firebase snippet and are deliberately absent: this
 * app has no Storage and no Messaging, and a required variable nothing reads is a
 * variable that gets set to a wrong value and never noticed.
 */
export const REQUIRED_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_DATABASE_URL',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

export type EnvLike = Readonly<Record<string, string | undefined>>;

export type ConfigResult =
  | { readonly ok: true; readonly config: FirebaseConfig }
  | { readonly ok: false; readonly missing: readonly string[] };

const present = (v: string | undefined): v is string => v !== undefined && v.trim() !== '';

/**
 * ALL missing keys, never just the first.
 *
 * Reporting one at a time turns a two-minute setup into five rebuild cycles, and the
 * person doing it is by definition someone who has not got this working yet — the worst
 * possible audience for a guessing game.
 */
export function readFirebaseConfig(env: EnvLike): ConfigResult {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !present(env[key]));
  if (missing.length > 0) return { ok: false, missing };

  const measurementId = env['VITE_FIREBASE_MEASUREMENT_ID'];

  return {
    ok: true,
    config: {
      // The `?? ''` are unreachable: `missing` is empty, so every required key is a
      // non-empty string. They exist because `noUncheckedIndexedAccess` cannot know
      // that, and the honest options are this or a non-null assertion. A `?? ''` that
      // never fires beats a `!` that lies about having checked.
      apiKey: env['VITE_FIREBASE_API_KEY'] ?? '',
      authDomain: env['VITE_FIREBASE_AUTH_DOMAIN'] ?? '',
      databaseURL: env['VITE_FIREBASE_DATABASE_URL'] ?? '',
      projectId: env['VITE_FIREBASE_PROJECT_ID'] ?? '',
      appId: env['VITE_FIREBASE_APP_ID'] ?? '',
      // `exactOptionalPropertyTypes` is on: `measurementId: undefined` is NOT the same
      // as an absent key, and assigning the first to an optional prop is a type error.
      // Spreading a conditional object is the way to actually omit it.
      ...(present(measurementId) ? { measurementId } : {}),
    },
  };
}

/** One message, listing every missing key. Shared by the browser panel and the build failure so the two cannot drift into describing the same problem differently. */
export function missingConfigMessage(missing: readonly string[]): string {
  return [
    `Firebase is not configured — missing ${String(missing.length)} variable${missing.length === 1 ? '' : 's'}:`,
    ...missing.map((k) => `  • ${k}`),
    '',
    'Local: copy .env.example to .env.local and fill it from the Firebase console',
    '  (Project settings → Your apps → Web app → SDK setup and configuration).',
    'Deploy: set the same names as GitHub Actions secrets — see .github/workflows/deploy.yml.',
  ].join('\n');
}
