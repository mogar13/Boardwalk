import type { GameProps } from '@/games/registry';
import { Lobby } from '@/system/room/Lobby';
import { useGame } from '@/system/economy/useGame';
import { TableBoard } from '@/games/blackjack/components/TableBoard';

/**
 * Blackjack — the SDK's economy proof, and now a TABLE and nothing else.
 *
 * **IT USED TO HAVE TWO CONTAINERS FOR ONE RULEBOOK AND NOW HAS ONE.** `'solo'` was the room-less
 * game this repo shipped first: no lobby, no seats, no subscription, a hand dealt behind
 * `BlackjackRepo` straight into the `<GameShell>` the play route already wrapped it in. It worked,
 * it was correct, and it was the wrong thing to keep, because a player standing at the entrance
 * could not tell it apart from `'ai'` — two buttons, "Play" and "Solo / AI", that both mean "play
 * blackjack by myself" and differ only in whether the empty chairs hold bots. A picker whose
 * options a player cannot distinguish is a picker that cannot be used, which is the argument
 * `MODE_LABEL` already makes one level up about two buttons reading the same word.
 *
 * So the room-less half is DELETED rather than hidden behind a mode nothing offers. `Table.tsx`,
 * `useBlackjackTable`, `BlackjackRepo` and both its implementations went with it, in the commit
 * that stopped declaring `'solo'` — because the cheapest way to defeat a cutover is to leave the
 * road it replaced standing, and an unreachable board is the same dead reference as a cosmetic
 * with no reader.
 *
 * WHAT IT COST, NAMED: blackjack no longer deals during a Pi outage. The room-less hand had a local
 * twin that ran the shared reducer client-side over ordinary `bet`/`settle` intents, so a fresh
 * clone and the RTDB fallback could still play it; a TABLE cannot exist on that path at all, for
 * UNO's and Liar's Dice's reason — the only client-side dealer available is one player's browser
 * holding the deck and the hole card. That is a real loss and it is the price of one entrance.
 *
 * The lobby owns create/join/seats/chat/start and the one `<RoomProvider>` subscription;
 * `<TableBoard>` renders inside it as `children` once play starts, which is how its `useRoom`/
 * `useSeats` reach that subscription without this game registering a listener.
 */
export default function BlackjackGame({ onExit }: GameProps) {
  const { manifest } = useGame();
  return (
    <Lobby manifest={manifest} onExit={onExit}>
      <TableBoard />
    </Lobby>
  );
}
