/**
 * Token verification. The referee's reason to exist: identity stays in Firebase Auth (the plan
 * is emphatic — do NOT hand-roll JWTs), and the server trusts a `uid` only after the Firebase
 * Admin SDK confirms the ID token was signed by the project. A browser cannot do this; that
 * asymmetry is the anti-cheat boundary.
 */

export interface TokenVerifier {
  /** Resolve the uid for a valid ID token; reject for anything else. */
  verify(idToken: string): Promise<string>;
}

/**
 * The real verifier. `firebase-admin` is imported LAZILY (dynamic import inside the factory) so
 * that tests and `insecure-dev` runs never load a heavy native dep they will not use, and a
 * machine with no service-account credentials can still boot the API in dev mode.
 *
 * Admin credentials come from `GOOGLE_APPLICATION_CREDENTIALS` (a service-account JSON path) via
 * `applicationDefault()` — the standard, keyless-in-code path. When
 * `FIREBASE_AUTH_EMULATOR_HOST` is set, the Admin SDK verifies emulator-minted tokens instead,
 * which is how this can run end-to-end against the local emulator with real token verification.
 */
export function firebaseVerifier(projectId: string): TokenVerifier {
  let ready: Promise<(idToken: string) => Promise<string>> | null = null;

  const init = async (): Promise<(idToken: string) => Promise<string>> => {
    const admin = await import('firebase-admin');
    if (admin.apps.length === 0) {
      admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
    }
    const auth = admin.auth();
    return async (idToken: string) => {
      const decoded = await auth.verifyIdToken(idToken);
      return decoded.uid;
    };
  };

  return {
    async verify(idToken: string): Promise<string> {
      ready ??= init();
      const verifyFn = await ready;
      return verifyFn(idToken);
    },
  };
}

/**
 * The dev bypass. Verifies NOTHING — it trusts whatever the middleware read from `x-debug-uid`.
 * It exists only so the API can be exercised against the emulator without minting real tokens,
 * and `configProblems` refuses to start a server in this mode without an explicit opt-in.
 */
export const insecureDevVerifier: TokenVerifier = {
  verify(idToken: string): Promise<string> {
    return Promise.resolve(idToken);
  },
};
