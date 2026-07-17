import { firebaseAuthRepo } from '@/system/repo/firebase/authRepo';
import { firebaseProfileRepo } from '@/system/repo/firebase/profileRepo';
import type { Repos } from '@/system/repo/types';

/**
 * The composition root. The ONE file in `src/` that names an implementation.
 *
 * `@boardwalk/no-firebase-imports` allows `@/system/repo/firebase/*` to be imported from
 * `src/system/repo/` and nowhere else, which makes the two lines above the entire
 * coupling between this app and Firebase. Swapping to the server-authoritative economy in
 * BACKEND_PLAN.md is: write `./http/authRepo.ts`, change these imports. No game, no hook,
 * no component is touched — not because anyone promised, but because none of them can see
 * far enough to be affected.
 *
 * It is deliberately a value and not a factory, a provider, or a DI container. There is
 * one implementation and one process; a seam that has never been swapped does not need a
 * mechanism for swapping it at runtime, and building one now would be the same
 * speculative move as v1's `validateAndCommit()` — an abstraction designed before a
 * caller existed, still sitting there with zero adopters. When there is a second
 * implementation, this becomes a `const repos = pick()` and that is the whole change.
 */
export const repos: Repos = {
  auth: firebaseAuthRepo,
  profile: firebaseProfileRepo,
};

/**
 * Re-exported so nothing outside this directory needs to know that `firebase/` is where
 * the answer comes from. `App.tsx` asks this before it renders a form — a missing config
 * is not a form error, it is a deployment fact, and it gets a panel of its own.
 */
export { firebaseReady } from '@/system/repo/firebase/app';

export type {
  AuthRepo,
  ProfileRepo,
  RepoResult,
  Repos,
  SignInInput,
  SignUpInput,
  Unsubscribe,
} from '@/system/repo/types';
export type { Profile, Session } from '@/system/profile/types';
