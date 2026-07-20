import { httpBlackjackRepo } from '@/system/repo/api/blackjackRepo';
import { httpEconomyRepo } from '@/system/repo/api/economyRepo';
import { httpLeaderboardRepo } from '@/system/repo/api/leaderboardRepo';
import { httpProfileRepo } from '@/system/repo/api/profileRepo';
import { apiChatRepo } from '@/system/repo/api/chatRepo';
import { httpTicketRepo } from '@/system/repo/api/ticketRepo';
import { apiRoomRepo } from '@/system/repo/api/roomRepo';
import { apiLiarsDiceRepo } from '@/system/repo/api/liarsDiceRepo';
import { createRoomSocket } from '@/system/repo/api/socket';
import type { ApiClientConfig } from '@/system/repo/api/client';
import type {
  BlackjackRepo,
  ChatRepo,
  EconomyRepo,
  LeaderboardRepo,
  LiarsDiceRepo,
  ProfileRepo,
  RoomRepo,
  TicketRepo,
} from '@/system/repo/types';

/**
 * The API repo family — the server half of the seam.
 *
 * `profile`/`leaderboard` are the HTTP repos wired in Phase A (shadow mode): the client keeps
 * Firebase authoritative AND mirrors to the API, and a diff proves they agree before Phase B flips
 * the source of truth. `room`/`chat` are Phase C: they are realtime, so they ride a WebSocket
 * (`apiRoomChat`) rather than HTTP, and the composition root swaps them in behind a cutover flag —
 * the same one-wiring-line swap the seam exists to make.
 */
export interface ApiRepos {
  readonly profile: ProfileRepo;
  readonly economy: EconomyRepo;
  readonly leaderboard: LeaderboardRepo;
  /** Phase D: the referee deals blackjack. See `api/blackjackRepo`. */
  readonly blackjack: BlackjackRepo;
  /** Offline hardening: the nonces a client cannot mint. See `api/ticketRepo`. */
  readonly tickets: TicketRepo;
}

export function apiRepos(cfg: ApiClientConfig): ApiRepos {
  return {
    profile: httpProfileRepo(cfg),
    economy: httpEconomyRepo(cfg),
    leaderboard: httpLeaderboardRepo(cfg),
    blackjack: httpBlackjackRepo(cfg),
    tickets: httpTicketRepo(cfg),
  };
}

/**
 * The realtime half — room + chat over one shared WebSocket to the referee (BACKEND_PLAN.md Phase
 * C). Built as its own factory (not folded into `apiRepos`) because it owns a live connection with a
 * lifecycle, where the HTTP repos are stateless. The composition root creates this only when the
 * WS-rooms cutover flag is on; until then room/chat stay on Firebase RTDB.
 */
export function apiRoomChat(
  cfg: ApiClientConfig
): { room: RoomRepo; chat: ChatRepo; liarsDice: LiarsDiceRepo } {
  const socket = createRoomSocket(cfg);
  // The dealt game rides the SAME socket as rooms and chat — it is not a second connection, and it
  // shares the reconnect and subscription replay the transport already does.
  return { room: apiRoomRepo(socket), chat: apiChatRepo(socket), liarsDice: apiLiarsDiceRepo(socket) };
}

export type { ApiClientConfig } from '@/system/repo/api/client';
