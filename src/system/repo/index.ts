import { apiRepos } from '@/system/repo/api';
import { firebaseAuth, firebaseReady } from '@/system/repo/firebase/app';
import { firebaseAuthRepo } from '@/system/repo/firebase/authRepo';
import { firebaseChatRepo } from '@/system/repo/firebase/chatRepo';
import { firebaseLeaderboardRepo } from '@/system/repo/firebase/leaderboardRepo';
import { firebaseProfileRepo } from '@/system/repo/firebase/profileRepo';
import { firebaseRoomRepo } from '@/system/repo/firebase/roomRepo';
import { shadowProfileRepo } from '@/system/repo/shadow/profileRepo';
import type { ProfileRepo, Repos } from '@/system/repo/types';

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
 *
 * PHASE A (BACKEND_PLAN.md) IS THAT SECOND IMPLEMENTATION ARRIVING, IN SHADOW. When
 * `VITE_API_BASE_URL` is set, the profile repo becomes `shadowProfileRepo(firebase, api)`:
 * Firebase stays the source of truth and every write is ALSO mirrored to `boardwalk-api`,
 * with any read-back disagreement logged. Nothing is flipped to the API as primary — that
 * is Phase B — so this is still one implementation the app trusts, plus an observer. The
 * leaderboard stays on Firebase for the same reason: the API's store is empty until the
 * write mirror fills it, so ranking off it now would be wrong, not just noisy.
 */

/**
 * Resolve a Firebase ID token for the API, or `null` when signed out / unconfigured. This is the
 * ONE place that bridges the two worlds: the API repos are firebase-free by design (the token is
 * injected, not fetched with the SDK), so `@boardwalk/no-firebase-imports` stays satisfied and this
 * root is the only file that names both. It never throws — `firebaseReady()` gates the `firebaseAuth()`
 * call that otherwise would when config is missing, so a fresh clone degrades to "no token" rather
 * than a crash, and the mirror simply does nothing.
 */
const getToken = async (): Promise<string | null> => {
  if (!firebaseReady().ok) return null;
  const user = firebaseAuth().currentUser;
  return user === null ? null : await user.getIdToken();
};

/**
 * Shadow is DEV-emulator-aware: an emulator session mints `demo-boardwalk` tokens that the live Pi's
 * `boardwalk-fca02` verifier rejects, so mirroring under the emulator would be a stream of 401s. Gate
 * it off there. In prod (or a non-emulator dev run against real Firebase) a real token is available
 * and the mirror is live.
 */
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const useEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === '1';
const shadowApi =
  apiBaseUrl !== undefined && apiBaseUrl !== '' && !useEmulator
    ? apiRepos({ baseUrl: apiBaseUrl, getToken })
    : null;

const profile: ProfileRepo = shadowApi
  ? shadowProfileRepo(firebaseProfileRepo, shadowApi.profile)
  : firebaseProfileRepo;

export const repos: Repos = {
  auth: firebaseAuthRepo,
  profile,
  leaderboard: firebaseLeaderboardRepo,
  room: firebaseRoomRepo,
  chat: firebaseChatRepo,
};

/**
 * Re-exported so nothing outside this directory needs to know that `firebase/` is where
 * the answer comes from. `App.tsx` asks this before it renders a form — a missing config
 * is not a form error, it is a deployment fact, and it gets a panel of its own.
 */
export { firebaseReady } from '@/system/repo/firebase/app';

export type {
  AuthRepo,
  ChatRepo,
  LeaderboardEntry,
  LeaderboardRepo,
  ProfileRepo,
  RepoResult,
  Repos,
  RoomRepo,
  SignInInput,
  SignUpInput,
  Unsubscribe,
} from '@/system/repo/types';
export type { ChatMessage } from '@/system/chat/types';
export type { Profile, Session } from '@/system/profile/types';
export type { RoomMeta, RoomSnapshot, Seat, SeatOccupant } from '@/system/room/types';
