import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card } from '@/ui';
import type { GameManifest } from '@/games/registry';
import { ChatPanel } from '@/system/chat/ChatPanel';
import { ExitGame } from '@/system/game/ExitGame';
import { GameRules } from '@/system/game/GameRules';
import { GameOptions } from '@/system/options/GameOptions';
import { useAuthStore } from '@/system/auth/authStore';
import { formatMoney } from '@boardwalk/game-logic';
import { RoomProvider } from '@/system/room/RoomProvider';
import { SeatList } from '@/system/room/SeatList';
import { TableAsideProvider } from '@/system/room/TableAside';
import { tableBacking } from '@/system/room/ante';
import { houseRuleChoices, isRuleOn } from '@/system/room/houseRules';
import { MODE_LABEL, roomModesOf } from '@/system/room/modes';
import { TableSetup } from '@/system/room/TableSetup';
import { humanCount, seatsAreReady } from '@/system/room/seats';
import { useAutoSeat } from '@/system/room/useAutoSeat';
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

  /**
   * There is no `leaveTable` any more, and its absence is the point — see `<ExitGame>`.
   *
   * It used to drop `?table=` and leave you sitting on this component's OTHER branch, the
   * create-or-join page, which is a form nobody asked for at the moment they said "leave". The way
   * back to a table's setup is the browser's Back button, which works because `enterTable` PUSHES;
   * the way out of a game is the hub, and there is now exactly one control that says so.
   */

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
        <LobbyRoom manifest={manifest} onExit={onExit}>
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
        <ExitGame onExit={onExit} />
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
  onExit,
  children,
}: {
  manifest: GameManifest;
  onExit: () => void;
  children?: ReactNode;
}) {
  const { seats, status, meta, isHost, setStatus, setHouseRules } = useRoom();
  const roomIdView = useRoomContext().identity.roomId;
  /**
   * ARRIVING AT A TABLE SITS YOU DOWN AT IT. Called here rather than at each entrance because there
   * are four of them — create, join-by-code, the room browser, a shared link — and they already
   * funnel through one `enterTable`; this is that convergence one level further in. See
   * `useAutoSeat` for the race, and `autoSeatIndex` for the three cases it refuses.
   */
  useAutoSeat();
  /**
   * THE SIDEBAR'S SPARE SLOT — see `<TableAside>`. A game's own running panel (UNO's move log, and
   * whatever the seventh game brings) portals in UNDER the chat, because the alternative is what
   * UNO did for six phases: draw it at the bottom of the board, below the player's own hand, where
   * it is off the screen on every real table and squeezing the felt it exists to comment on.
   */
  const [asideSlot, setAsideSlot] = useState<HTMLDivElement | null>(null);
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
        <ExitGame onExit={onExit} />
      </Card>
    );
  }

  /**
   * Startable once the seats are a game and it is mine to start. The seat half is `seatsAreReady`,
   * and it is a shared function rather than an expression BECAUSE THE ENTRANCE ASKS IT TOO: a table
   * whose plan was already ready never reaches this button at all — `TableSetup` starts it, and it
   * decides that with this same predicate, so the preview, the create and the button cannot come to
   * three different conclusions about whether a table is waiting for anything.
   *
   * What is left here is the ONLINE case, which is the one that genuinely waits: its chairs are
   * open on purpose, and the moment they fill is a moment somebody arrived rather than a moment the
   * host chose. That beat is what the button is for.
   */
  const canStart = isHost && status === 'waiting' && seatsAreReady(seats);

  return (
    <TableAsideProvider slot={asideSlot}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.06em] uppercase">
              {manifest.name}
            </h1>
            <p className="text-bw-muted text-sm">
              Table{' '}
              <span className="text-secondary font-display tracking-[0.3em]">{roomIdView}</span> ·{' '}
              {status} · {humanCount(seats)} player{humanCount(seats) === 1 ? '' : 's'}
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
                {/*
                  ONCE A ROUND IS LIVE, THIS LINE IS ABOUT THE NEXT ONE — and saying so is a
                  correctness fix, not a nicety (plans/done/LIVE_HOUSE_RULES.md §4). It reads the
                  ROOM, and the host can now change the room mid-game; the round in flight keeps
                  what it was DEALT with. So during play the two differ for exactly as long as a
                  change is pending, and an unqualified "House rules: Stacking" over a round dealt
                  without it is a UI that lies in the ordinary way. The label is the whole fix: the
                  OS still never reads the match's rules, because it does not need to know WHICH
                  set is in force to say truthfully which one it is quoting.
                */}
                {status === 'playing' ? 'Next deal: ' : 'House rules: '}
                {ruleLabels.join(' · ')}
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
            {/*
            WHAT THIS TABLE IS PLAYING, reachable once play has started — which is when it is
            actually asked. The header's `House rules:` line above says which are ON and nothing
            about what any of them DOES: those sentences are in the manifest and were rendered only
            on the setup panel, a screen you leave in order to play. So "can a +4 answer a +2 here?"
            had no answer anywhere on the page at the moment somebody plays one.

            It sits beside the exit rather than on the board for `<GameResult>`'s and
            `<ExitGame>`'s reason, arriving a fourth time: a control a player wants at a specific
            moment must not be somewhere they have to scroll a felt to find. And it is the OS's to
            draw, not the game's, because what it renders is manifest DATA — the same split
            `<GameOptions>` and the lobby's own rule toggles already make. No game spells it.

            It renders null for a game declaring neither kind, so five of the six draw no button.
          */}
            {/*
              The HOST gets toggles; everyone else gets the statement. `onChangeRules` is the whole
              gate — absent means read-only, so a guest is never shown a control the referee would
              refuse, which is the same rule that kept the toggles out of PR #91 entirely.
            */}
            <GameRules
              manifest={manifest}
              tableRules={meta?.houseRules}
              live={status === 'playing'}
              {...(isHost ? { onChangeRules: setHouseRules } : {})}
            />
            <ExitGame onExit={onExit} />
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
              <p className="text-bw-muted text-xs">
                Hosted by {isHost ? 'you' : 'another player'}.
              </p>
            )}
          </div>
          {/*
            THE SIDEBAR TAKES ITS HEIGHT FROM THE BOARD AND CONTRIBUTES NONE OF ITS OWN.

            Each panel used to bound ITSELF — the chat `max-h-[60vh]`, the move log `max-h-[28rem]`
            — which reads as careful and bounds nothing together: at 1080p that is 648 + 448 plus
            two headers, so the column ran ~1200px beside a ~730px board. The COLUMN then set the
            page height, the page grew a scrollbar the board never asked for, and the move log —
            being second — was the half that ended up off the bottom of the screen. That is the fold
            problem `<GameResult>` and `<ExitGame>` each closed once, arriving a third time through
            a different door, which is why it is a rule now (`tests/table-sidebar.test.ts`).

            THE MECHANISM IS `absolute inset-0` INSIDE A STRETCHED GRID ITEM, and it is the one part
            of this worth reading twice. A grid item contributes its content to the row's height, so
            simply giving the column a `max-h` still lets it push the row open — it only stops
            pushing at the cap. Taking the panels out of flow makes the wrapper's own content box
            EMPTY, so the row is sized by the board alone and the sidebar is then stretched to
            whatever that came to. The consequence is the property: the sidebar cannot grow the page
            at all, at any content length, rather than being capped somewhere.

            And with a DEFINITE height to divide, `flex-1 min-h-0` on each panel is a real 50/50 —
            which is what was asked for and what a `max-h` cannot give, because a column that is
            only capped sizes to its content and leaves both panels hugging whatever they hold.

            BELOW `lg` there is one column and no board beside it, so the panels sit in normal flow
            and take the viewport bound instead. `min-h-0` is load-bearing in both, exactly as it is
            in `<Modal>`: a flex item's default `min-height: auto` refuses to shrink below its
            content, so without it both panels ignore their own `overflow-y-auto`.
          */}
          <div className="relative min-h-0">
            <aside className="flex max-h-[calc(100dvh-9rem)] min-h-64 flex-col gap-6 lg:absolute lg:inset-0 lg:max-h-none lg:min-h-0">
              <ChatPanel />
              {/* `empty:hidden` so a table whose game contributes no panel does not pay a gap for
                  it — nor half the column, since a hidden flex item takes no share. */}
              <div ref={setAsideSlot} className="flex min-h-0 flex-1 flex-col gap-6 empty:hidden" />
            </aside>
          </div>
        </div>
      </div>
    </TableAsideProvider>
  );
}
