import { type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card } from '@/ui';
import type { GameManifest } from '@/games/registry';
import { ChatPanel } from '@/system/chat/ChatPanel';
import { GameOptions } from '@/system/options/GameOptions';
import { useAuthStore } from '@/system/auth/authStore';
import { formatMoney } from '@boardwalk/game-logic';
import { RoomProvider } from '@/system/room/RoomProvider';
import { SeatList } from '@/system/room/SeatList';
import { tableBacking } from '@/system/room/ante';
import { houseRuleChoices, isRuleOn } from '@/system/room/houseRules';
import { MODE_LABEL, roomModesOf } from '@/system/room/modes';
import { TableSetup } from '@/system/room/TableSetup';
import { humanCount, tableIsFull } from '@/system/room/seats';
import { useRoom } from '@/system/room/useRoom';
import { useRoomContext, type RoomIdentity } from '@/system/room/roomContext';

/**
 * The lobby — create a table, join one by code, take a seat, chat, start. Built entirely from
 * `src/ui` (Button, Card, Input, useToast) and semantic tokens; NOT a single raw DaisyUI class,
 * which is the data point ARCHITECTURE.md's open question was waiting for — the lobby was the
 * component most likely to want a DaisyUI base, and it did not.
 *
 * SHAPE: the outer `Lobby` owns the pre-room choices and, once there is a table, mounts a single
 * `<RoomProvider>` around the in-room view. The provider is what owns the subscription and the
 * teardown, so "leave the table" is just unmounting it — the hygiene runs itself.
 *
 * WHICH table (and which mode) is in the URL, not in state — see `linkedTable` below for why that
 * is a correctness property and not a routing preference.
 *
 * `children` IS THE GAME. A game (Tic-Tac-Toe onward) renders `<Lobby manifest onExit>` and passes
 * its board as the children; the lobby draws the seat list and chat while `status === 'waiting'`,
 * and swaps in the board the moment the host starts (`status === 'playing'`). The board is rendered
 * INSIDE the `<RoomProvider>`, which is the whole point — that is how the board's `useRoom`/
 * `useSeats`/`useChat` reach the one subscription without the game ever registering a listener. A
 * game with no children (the dev harness) falls back to a placeholder, so the lobby stands alone.
 */
export interface LobbyProps {
  readonly manifest: GameManifest;
  readonly onExit: () => void;
  /** The game's board, rendered inside the room once play starts. Absent → a placeholder. */
  readonly children?: ReactNode;
}

export function Lobby({ manifest, onExit, children }: LobbyProps) {
  const session = useAuthStore((s) => s.session);
  // The lobby is multiplayer-only: `'solo'` means no room at all, so a solo game never renders this
  // component. Filter it out defensively so the mode type stays the three room modes `RoomIdentity`
  // accepts, and a mixed-mode game never offers a "solo" button that a lobby cannot honour.
  const roomModes = roomModesOf(manifest.modes);
  /**
   * WHICH TABLE YOU ARE AT LIVES IN THE URL, and it is the ONLY place it lives.
   *
   * It is read HERE and not in the play route, because the play route hands a game `{ onExit }` and
   * nothing else — that rule is what stops a `system` prop growing back. The lobby is OS code, so it
   * may read the URL itself, and a game passing `<Lobby>` gets this for free without learning it
   * exists.
   *
   * It used to be read here AND held in a `roomId` state, reconciled as `roomId ?? linkedTable`.
   * Two sources of truth for one fact, and the failure was the one the derivation rule always
   * predicts: only the room BROWSER navigated, so only a table joined from the browser survived a
   * page load. Create and join-by-code set the state alone — so a refresh, a phone waking a locked
   * tab, or a shared link opened in a second window dumped you back on the create/join screen with
   * the code gone and the game still running without you. Mid-game that is indistinguishable from
   * being kicked out. Now every way in writes the URL and there is nothing to reconcile.
   *
   * `mode` rides along for the same reason rather than a different one. It is not decoration: it is
   * what tells `useSeats` whether this is a shared screen, so a hot-seat table that came back in
   * the default mode would restore every seat except the second local player's. A fact that has to
   * survive the reload belongs where the reload can read it.
   */
  const [params, setParams] = useSearchParams();
  const linkedTable = params.get('table');
  const linkedMode = params.get('mode');
  const mode: RoomIdentity['mode'] =
    roomModes.find((m) => m === linkedMode) ?? roomModes[0] ?? 'online';

  if (session === null) {
    return (
      <Card className="p-6">
        <p className="text-bw-muted text-sm">Sign in to play at a table.</p>
      </Card>
    );
  }
  const myUid = session.uid;

  const activeRoomId = linkedTable === null || linkedTable === '' ? null : linkedTable;

  /**
   * Enter a table — the one way in, whether it came from Create, a typed code, or the browser's
   * Join. It PUSHES, so the browser's Back button leaves the table like any other navigation.
   */
  const enterTable = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('table', id);
    next.set('mode', mode);
    setParams(next);
  };

  /** Leave the table AND the link that put us there, or a "leave" would immediately re-enter it. */
  const leaveTable = () => {
    const next = new URLSearchParams(params);
    next.delete('table');
    next.delete('mode');
    setParams(next, { replace: true });
  };

  /** The mode buttons write the URL too, so the choice is still there after a reload. */
  const chooseMode = (m: RoomIdentity['mode']) => {
    const next = new URLSearchParams(params);
    next.set('mode', m);
    setParams(next, { replace: true });
  };

  if (activeRoomId !== null) {
    const identity: RoomIdentity = { gameId: manifest.id, roomId: activeRoomId, myUid, mode };
    return (
      <RoomProvider identity={identity}>
        <LobbyRoom manifest={manifest} onLeave={leaveTable} onExit={onExit}>
          {children}
        </LobbyRoom>
      </RoomProvider>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.06em] uppercase">
          {manifest.name}
        </h1>
        <p className="text-bw-muted text-sm">{manifest.blurb}</p>
      </div>

      {/*
        THE WAYS IN, in the manifest's own order, labelled by the OS. This row used to render the
        raw union member, so the screen said "ai" and "online" — invisible for as long as the only
        way here was a page nobody looked at twice, and no longer true now the launch modal draws
        the same choice at eye level. `MODE_LABEL` is the one place those words live, so the
        entrance and the table cannot come to different names for the same thing.

        A game with one room mode draws no row: a picker that cannot change the outcome is worse
        than none, which is `tableSizeChoices`'s rule one level up.
      */}
      {roomModes.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="How to play">
          {roomModes.map((m) => (
            <Button
              key={m}
              size="sm"
              variant={m === mode ? 'secondary' : 'ghost'}
              aria-pressed={m === mode}
              onClick={() => {
                chooseMode(m);
              }}
            >
              {MODE_LABEL[m]}
            </Button>
          ))}
        </div>
      )}

      {/*
        CREATE / BROWSE / JOIN — the same component the launch modal mounts over the hub, and the
        reason it is a component at all: `/play/uno` typed directly, and a shared link whose table
        has closed, both land here, so the panel must not exist twice. See `<TableSetup>`.
      */}
      <TableSetup manifest={manifest} mode={mode} onEntered={enterTable} />

      <div>
        <Button variant="quiet" onClick={onExit}>
          Back to the hub
        </Button>
      </div>
    </div>
  );
}

/**
 * The in-room view. A reader of `useRoom()` — the provider around it owns the subscription — so
 * this is presentation plus two host-only actions (start, and the seat controls inside SeatList).
 */
function LobbyRoom({
  manifest,
  onLeave,
  onExit,
  children,
}: {
  manifest: GameManifest;
  onLeave: () => void;
  onExit: () => void;
  children?: ReactNode;
}) {
  const { seats, status, meta, isHost, setStatus } = useRoom();
  const roomIdView = useRoomContext().identity.roomId;
  // WHO IS PAYING FOR THIS TABLE — what the stake line says, and whether the options control is
  // locked. The referee asks the same question of the game's own rulebook when it deals; this is
  // the OS's copy of it, and the two are asserted to agree (see `tableBacking`).
  const backing = tableBacking(manifest.betting, meta?.anteCents ?? 0, humanCount(seats));
  // The room's rules, rendered with the LABELS the manifest declares — the room carries ids, and an
  // id is not copy. An id the manifest no longer declares simply drops out, which is the honest
  // rendering of a rule this build of the client does not know about.
  const ruleLabels = houseRuleChoices(manifest.houseRules)
    .filter((spec) => meta !== null && isRuleOn(meta.houseRules, spec.id))
    .map((spec) => spec.label);

  if (status === 'gone') {
    return (
      <Card className="flex flex-col items-start gap-4 p-6">
        <p className="text-bw-muted text-sm">This table has closed.</p>
        <Button variant="primary" onClick={onLeave}>
          Back to the lobby
        </Button>
      </Card>
    );
  }

  // Startable once the table is full and at least one human is present to host/deal. NOT
  // `humanCount >= seats.min`: that conflated "min PLAYERS" with "min HUMANS", and AI-as-occupant
  // makes them differ. `SeatList` only offers "Add CPU" when the manifest declares an `ai` mode, so
  // a game with no bots (Chess) fills its table with humans only — `tableIsFull` there already means
  // `max` humans ≥ `min`, making the old clause redundant. For a game WITH bots (UNO), a full table
  // may be one human plus six CPUs, which is a legitimate game the old gate wrongly refused. So the
  // real requirement is a full table (players = `max` ≥ `min`) with a human driver in it — UNO is
  // the design input that surfaced this, the AI-as-occupant sibling of Chess's `allowAi`.
  const canStart = isHost && status === 'waiting' && tableIsFull(seats) && humanCount(seats) >= 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.06em] uppercase">
            {manifest.name}
          </h1>
          <p className="text-bw-muted text-sm">
            Table <span className="text-secondary font-display tracking-[0.3em]">{roomIdView}</span>{' '}
            · {status} · {humanCount(seats)} player{humanCount(seats) === 1 ? '' : 's'}
          </p>
          {/*
            WHAT THIS CHAIR COSTS, said before anybody sits in it.

            The whole reason the ante is room META rather than a create-time value the host keeps to
            itself: a joiner arriving by code or from the browser has to know the stake BEFORE they
            take a seat. Plumbing it to their snapshot and then not drawing it is worse than not
            plumbing it, because it looks done — and it WAS, for one browser pass: the guest was
            offered a SIT button on a $25 table with nothing on screen saying so, which is exactly
            the consent problem this design was built to close.

            The "needs two players" half is said here too, because the stake is otherwise a promise
            the table cannot keep — a bot has no bankroll, so below two humans nothing is charged.
          */}
          {meta !== null && meta.anteCents > 0 && (
            <p className="text-warning text-sm font-semibold">
              {formatMoney(meta.anteCents)} a seat ·{' '}
              {backing === 'house' ? 'the house banks the pot' : 'winner takes the pot'}
              {backing === 'none' && (
                <span className="text-bw-muted font-normal">
                  {' '}
                  — needs two human players, or the table plays for XP alone
                </span>
              )}
              {backing === 'house' && (
                <span className="text-bw-muted font-normal">
                  {' '}
                  — you against the bots, at the house&rsquo;s odds
                </span>
              )}
            </p>
          )}
          {/*
            WHAT GAME THIS TABLE IS PLAYING, said before anybody sits down — the ante line's
            sibling, and it exists for the identical reason. The rules reach a guest on their own
            room subscription (the gateway test asserts exactly that, over a real socket, from a
            socket holding no seat), and plumbing them there and then not drawing them would be
            worse than not plumbing them, because it looks done. That is not hypothetical: the ante
            shipped in precisely that state for one browser pass, and a guest was offered a SIT
            button on a $25 table with nothing on screen saying so.

            Reads the ROOM's rules and not the game's projection, because this line has to be true
            before the deal — there is no projection yet. Once dealt, the board reads the rules off
            `UnoState`, which is the match's own copy. Absent/empty draws nothing, so every table
            that agreed to nothing looks exactly as it did.
          */}
          {meta !== null && ruleLabels.length > 0 && (
            <p className="text-secondary text-sm font-semibold">
              House rules: {ruleLabels.join(' · ')}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {canStart && (
            <Button
              variant="primary"
              onClick={() => {
                void setStatus('playing');
              }}
            >
              Start
            </Button>
          )}
          <Button
            variant="quiet"
            onClick={() => {
              onLeave();
            }}
          >
            Leave table
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          {status === 'playing' ? (
            // The game's board — rendered inside <RoomProvider>, so its hooks reach the one
            // subscription. Falls back to a placeholder when the lobby is used bare (dev harness).
            (children ?? (
              <Card className="p-6">
                <p className="text-bw-muted text-sm">
                  The game is in progress. A game passed as children renders its board here — the
                  room, seats, chat and ordering it stands on are all live.
                </p>
              </Card>
            ))
          ) : (
            <>
              {/*
                The options seam's other half, and the gap it shipped with: `<GameOptions>` was
                rendered only by solo games, because every option-declaring game was solo. AI
                difficulty (V1_FEATURE_GAPS #1) is the room game that closes it — the tier is
                chosen here, at the table, before the deal.

                HOST ONLY, and the reason is worth stating rather than hiding: the values live in
                `<GameShell>`, which is per-CLIENT, and the only option any room game declares today
                is an AI tier — read exclusively by the host, since `aiSeatsToDrive` is host-only.
                So a guest's copy would be a control that changes nothing, which is worse than no
                control. The moment a room game declares an option a GUEST must also read, this is
                the wrong home for it: it belongs in room state, written at start. That is a real
                change, named here, not a nuance papered over.

                It renders in the WAITING branch only — the panel is gone once the board is up — so
                a tier cannot be retuned mid-game. v1's Chess reached the same place by queueing a
                difficulty change to the next game; here the shape of the lobby says it instead.
              */}
              {/*
                `forMoney` when the HOUSE is the counterparty, which is the only arrangement where
                an option can price itself: the player picks the tier and the house pays the bill,
                so a game may pin one (`GameOption.pinnedForMoney`) and the control shows the pinned
                value locked with the game's own reason. A table of people is untouched — nobody
                there is paying for anybody else's difficulty. The referee pins it either way; this
                is what stops the screen offering a choice the deal will not honour.
              */}
              {isHost && <GameOptions layout="panel" forMoney={backing === 'house'} />}
              <SeatList allowAi={manifest.modes.includes('ai')} />
            </>
          )}
          {meta !== null && (
            <p className="text-bw-muted text-xs">Hosted by {isHost ? 'you' : 'another player'}.</p>
          )}
        </div>
        <div className="min-h-64">
          <ChatPanel />
        </div>
      </div>

      <div>
        <Button variant="quiet" onClick={onExit}>
          Back to the hub
        </Button>
      </div>
    </div>
  );
}
