import { apiRepos, apiRoomChat } from '@/system/repo/api';
import { firebaseAuth, firebaseReady } from '@/system/repo/firebase/app';
import { firebaseAuthRepo } from '@/system/repo/firebase/authRepo';
import { firebaseChatRepo } from '@/system/repo/firebase/chatRepo';
import { firebaseEconomyRepo } from '@/system/repo/firebase/economyRepo';
import { firebaseLeaderboardRepo } from '@/system/repo/firebase/leaderboardRepo';
import { firebaseProfileRepo } from '@/system/repo/firebase/profileRepo';
import { firebaseRoomRepo } from '@/system/repo/firebase/roomRepo';
import { localBlackjackRepo } from '@/system/repo/local/blackjackRepo';
import { shadowProfileRepo } from '@/system/repo/shadow/profileRepo';
import type { EconomyRepo, ProfileRepo, Repos } from '@/system/repo/types';

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
 * The API is DEV-emulator-aware: an emulator session mints `demo-boardwalk` tokens that the live
 * Pi's `boardwalk-fca02` verifier rejects, so calling it under the emulator would be a stream of
 * 401s. Gate it off there. In prod (or a non-emulator dev run against real Firebase) a real token
 * is available.
 */
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const useEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === '1';
const api =
  apiBaseUrl !== undefined && apiBaseUrl !== '' && !useEmulator
    ? apiRepos({ baseUrl: apiBaseUrl, getToken })
    : null;

/**
 * PHASE B CUTOVER — SQLite is now the source of truth for the profile, the economy and the stats.
 *
 * `VITE_API_ECONOMY=0` is the kill switch back to the Phase-A arrangement (Firebase authoritative,
 * the API a shadow mirror) with a rebuild and no code change — the twin of Phase C's
 * `VITE_WS_ROOMS=0`, and it exists for the same reason: a Pi outage should be one env var, not a
 * revert. `shadowProfileRepo` therefore stays in the tree rather than being deleted.
 *
 * WHAT ACTUALLY CHANGED, because "flip the wiring" undersells it. The bankroll is no longer a
 * number the client sends; it is `SUM(ledger.delta_cents)` on the server, and the four money paths
 * became four intents the server prices itself (`repos.economy`). `ProfileRepo.save` still exists
 * and still runs, but it now carries only a name, an avatar and the equipped cosmetics — the
 * server's `PUT /profile` reads three fields and nothing else, so the write that used to be able
 * to set a balance no longer has anywhere to put one.
 */
const apiEconomyOn = api !== null && import.meta.env.VITE_API_ECONOMY !== '0';

const profile: ProfileRepo = apiEconomyOn
  ? api.profile
  : api
    ? shadowProfileRepo(firebaseProfileRepo, api.profile)
    : firebaseProfileRepo;

const economy: EconomyRepo = apiEconomyOn ? api.economy : firebaseEconomyRepo;

/**
 * The leaderboard follows the profile, and it has to: it ranks the same numbers. Reading standings
 * from Firebase while the balances that feed them live in SQLite would rank a projection nothing
 * writes any more — a board that silently freezes on the day of the cutover. Phase A deliberately
 * left this on Firebase because the API's store was empty; after the flip the API's store is the
 * only one being filled.
 */
const leaderboard = apiEconomyOn ? api.leaderboard : firebaseLeaderboardRepo;

/**
 * PHASE D CUTOVER — the referee deals blackjack, so the one game that can win money stops telling
 * us how much it won.
 *
 * `VITE_API_BLACKJACK=0` is the kill switch, and it restores something real rather than something
 * improvised: `localBlackjackRepo` runs the SAME shared reducer client-side and moves the stake and
 * the payout as `bet`/`settle` intents through whatever `economy` is composed above. So with the
 * API up, turning this off puts the table back on the Phase-B economy exactly — server-priced
 * intents, the 2.5× settle ceiling, the lot — and with no API at all it is the pre-Phase-B table
 * unchanged, which is what makes a fresh clone and the emulator loop still deal a hand.
 *
 * It follows the ECONOMY's flag rather than carrying a second base-URL check, because a table whose
 * cards the server deals and whose money the server does not price is a state nobody designed: the
 * deal would stake through the referee's ledger while the settle wrote a client-computed profile
 * over the top. One switch, one coherent pair.
 */
const blackjack =
  apiEconomyOn && import.meta.env.VITE_API_BLACKJACK !== '0'
    ? api.blackjack
    : localBlackjackRepo({ economy, profile });

/**
 * PHASE C CUTOVER — room + chat run over the WebSocket referee instead of RTDB. Now **on by default**
 * wherever the API is configured (prod carries `VITE_API_BASE_URL` already): the deployed gateway was
 * soaked end-to-end against the live Pi with real Firebase tokens — handshake, seat arbitration and
 * forgery refusal, host-only gating, monotonic seq, owner-only hidden hands, author-pinned chat, and
 * the disconnect→seat-release safety net, all green (`boardwalk-api/tests/gateway.test.ts` covers the
 * same protocol in CI). The `firebase/room`/`chat` repos stay in the tree as the fallback: setting
 * **`VITE_WS_ROOMS=0`** forces rooms back onto RTDB with a rebuild, no code change — the kill switch
 * for a Pi outage. Inert under the emulator (a `demo-boardwalk` token the Pi's verifier rejects). When
 * this has run clean in prod for a stretch, the Firebase room/chat repos get deleted and RTDB is no
 * longer read or written. No game, hook, or component is touched — the whole point of the seam.
 */
const wsRooms =
  import.meta.env.VITE_WS_ROOMS !== '0' &&
  apiBaseUrl !== undefined &&
  apiBaseUrl !== '' &&
  !useEmulator
    ? apiRoomChat({ baseUrl: apiBaseUrl, getToken })
    : null;

export const repos: Repos = {
  auth: firebaseAuthRepo,
  profile,
  economy,
  blackjack,
  leaderboard,
  room: wsRooms ? wsRooms.room : firebaseRoomRepo,
  chat: wsRooms ? wsRooms.chat : firebaseChatRepo,
};

/**
 * Re-exported so nothing outside this directory needs to know that `firebase/` is where
 * the answer comes from. `App.tsx` asks this before it renders a form — a missing config
 * is not a form error, it is a deployment fact, and it gets a panel of its own.
 */
export { firebaseReady } from '@/system/repo/firebase/app';

export type {
  AuthRepo,
  BlackjackDealInput,
  BlackjackMove,
  BlackjackMoveInput,
  BlackjackRepo,
  BlackjackTurn,
  ChatRepo,
  EconomyIntent,
  EconomyRepo,
  HandView,
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
export type { Profile } from '@boardwalk/game-logic';
export type { Session } from '@/system/auth/session';
export type { RoomMeta, RoomSnapshot, Seat, SeatOccupant } from '@/system/room/types';
