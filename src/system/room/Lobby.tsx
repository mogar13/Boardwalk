import { useState, type ReactNode } from 'react';
import { Button, Card, Input, useToast } from '@/ui';
import type { GameManifest } from '@/games/registry';
import { ChatPanel } from '@/system/chat/ChatPanel';
import { useAuthStore } from '@/system/auth/authStore';
import { repos } from '@/system/repo';
import { RoomProvider } from '@/system/room/RoomProvider';
import { SeatList } from '@/system/room/SeatList';
import { humanCount, tableIsFull } from '@/system/room/seats';
import { useRoom } from '@/system/room/useRoom';
import { useRoomContext, type RoomIdentity } from '@/system/room/roomContext';

/**
 * The lobby — create a table, join one by code, take a seat, chat, start. Built entirely from
 * `src/ui` (Button, Card, Input, useToast) and semantic tokens; NOT a single raw DaisyUI class,
 * which is the data point ARCHITECTURE.md's open question was waiting for — the lobby was the
 * component most likely to want a DaisyUI base, and it did not.
 *
 * SHAPE: the outer `Lobby` owns the pre-room choices (which mode, create vs join) as local state
 * and, once there is a room, mounts a single `<RoomProvider>` around the in-room view. The
 * provider is what owns the subscription and the teardown, so "leave the table" is just unmounting
 * it — the hygiene runs itself.
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
  const toast = useToast();
  const [roomId, setRoomId] = useState<string | null>(null);
  // The lobby is multiplayer-only: `'solo'` means no room at all, so a solo game never renders this
  // component. Filter it out defensively so the mode type stays the three room modes `RoomIdentity`
  // accepts, and a mixed-mode game never offers a "solo" button that a lobby cannot honour.
  const roomModes = manifest.modes.filter((m): m is RoomIdentity['mode'] => m !== 'solo');
  const [mode, setMode] = useState<RoomIdentity['mode']>(roomModes[0] ?? 'online');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (session === null) {
    return (
      <Card className="p-6">
        <p className="text-bw-muted text-sm">Sign in to play at a table.</p>
      </Card>
    );
  }
  const myUid = session.uid;

  if (roomId !== null) {
    const identity: RoomIdentity = { gameId: manifest.id, roomId, myUid, mode };
    return (
      <RoomProvider identity={identity}>
        <LobbyRoom
          manifest={manifest}
          onLeave={() => {
            setRoomId(null);
          }}
          onExit={onExit}
        >
          {children}
        </LobbyRoom>
      </RoomProvider>
    );
  }

  const createTable = () => {
    setBusy(true);
    void (async () => {
      const result = await repos.room.create(manifest.id, {
        seatCount: manifest.seats.max,
        host: { uid: myUid, name: session.username || 'Player' },
      });
      setBusy(false);
      if (result.ok) setRoomId(result.value);
      else toast.error(result.error);
    })();
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.06em] uppercase">
          {manifest.name}
        </h1>
        <p className="text-bw-muted text-sm">{manifest.blurb}</p>
      </div>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
          New table
        </h2>
        {roomModes.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {roomModes.map((m) => (
              <Button
                key={m}
                size="sm"
                variant={m === mode ? 'secondary' : 'ghost'}
                onClick={() => {
                  setMode(m);
                }}
              >
                {m}
              </Button>
            ))}
          </div>
        )}
        <Button variant="primary" disabled={busy} onClick={createTable}>
          Create table
        </Button>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
          Join a table
        </h2>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim() !== '') setRoomId(code.trim().toUpperCase());
          }}
        >
          <Input
            label="Table code"
            placeholder="ABCD"
            value={code}
            maxLength={4}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
            }}
            className="flex-1"
          />
          <Button type="submit" variant="secondary" disabled={code.trim() === ''}>
            Join
          </Button>
        </form>
      </Card>

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
            <SeatList allowAi={manifest.modes.includes('ai')} />
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
