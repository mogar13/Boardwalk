import type { Profile } from '@boardwalk/game-logic';
import { apiFetch, type ApiClientConfig } from '@/system/repo/api/client';
import type {
  BlackjackDealInput,
  BlackjackMoveInput,
  BlackjackRepo,
  BlackjackTurn,
  HandView,
  RepoResult,
} from '@/system/repo/types';

/**
 * THE SERVER-DEALT TABLE — BACKEND_PLAN.md Phase D, client half.
 *
 * Two POSTs, and the interesting thing about this file is how little it does. It stringifies an
 * input that has no field for a card, a result or a payout, and it reads back a hand that has no
 * field for the deck. All the correctness is on the other side of the wire and in the projection
 * type; this is a transport, and the moment it starts computing something is the moment the client
 * has an opinion about a hand again.
 *
 * `replayed` is on the response and is deliberately dropped here. It tells the referee's own tests
 * that a repeated nonce moved nothing; the table has nothing to render differently for it, because
 * the whole point of the replay branch is that the answer is identical to the first one.
 */

interface TurnBody {
  readonly profile: Profile;
  readonly hand: HandView;
  readonly replayed?: boolean;
}

/**
 * The shared response handling for both verbs. 409 = the request was understood and is simply not
 * true right now ("insufficient funds for that double", "that hand is already settled"). That is
 * game state the table renders, so it comes back as a value; anything else non-2xx is a real
 * failure and throws — the `RepoResult` doctrine, unchanged from `httpEconomyRepo`.
 */
async function turnOf(res: Response, verb: string): Promise<RepoResult<BlackjackTurn>> {
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? 'that is not possible right now' };
  }
  if (!res.ok) throw new Error(`blackjack ${verb} failed: ${String(res.status)}`);

  const body = (await res.json()) as TurnBody;
  return { ok: true, value: { profile: body.profile, hand: body.hand } };
}

export function httpBlackjackRepo(cfg: ApiClientConfig): BlackjackRepo {
  return {
    // `uid` is accepted for the interface's shape and never sent: the referee reads it off the
    // verified bearer token instead. A uid a request can assert is a uid a request can forge, and
    // here it would be a stranger's bankroll — the same reason `chat` pins `uid === auth.uid` in
    // `database.rules.json` rather than believing the message.
    async deal(_uid: string, input: BlackjackDealInput): Promise<RepoResult<BlackjackTurn>> {
      const res = await apiFetch(cfg, '/blackjack/deal', {
        method: 'POST',
        body: JSON.stringify({ nonce: input.nonce, wagerCents: input.wagerCents }),
      });
      return await turnOf(res, 'deal');
    },

    async move(_uid: string, input: BlackjackMoveInput): Promise<RepoResult<BlackjackTurn>> {
      const res = await apiFetch(cfg, '/blackjack/move', {
        method: 'POST',
        body: JSON.stringify({ nonce: input.nonce, handId: input.handId, move: input.move }),
      });
      return await turnOf(res, 'move');
    },
  };
}
