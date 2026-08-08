import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Input, useToast } from '@/ui';
import type { GameManifest } from '@/games/registry';
import { ChatPanel } from '@/system/chat/ChatPanel';
import { GameOptions } from '@/system/options/GameOptions';
import { useAuthStore } from '@/system/auth/authStore';
import { formatMoney } from '@boardwalk/game-logic';
import { repos } from '@/system/repo';
import { RoomProvider } from '@/system/room/RoomProvider';
import { RoomBrowser } from '@/system/room/RoomBrowser';
import { SeatList } from '@/system/room/SeatList';
import { anteChoices, DEFAULT_ANTE_CENTS, tableBacking } from '@/system/room/ante';
import {
  houseRuleChoices,
  isRuleAvailable,
  isRuleOn,
  NO_TABLE_RULES,
  setTableRule,
  tableRulesFor,
  type TableRules,
} from '@/system/room/houseRules';
import { SeatPreview } from '@/system/room/SeatPreview';
import {
  humanCount,
  localSeatName,
  plannedSeats,
  tableIsFull,
  tableSizeChoices,
  type SeatFill,
} from '@/system/room/seats';
import { useRoom } from '@/system/room/useRoom';
import { useRoomContext, type RoomIdentity } from '@/system/room/roomContext';
import type { RoomVisibility } from '@/system/room/types';

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
  const toast = useToast();
  // The lobby is multiplayer-only: `'solo'` means no room at all, so a solo game never renders this
  // component. Filter it out defensively so the mode type stays the three room modes `RoomIdentity`
  // accepts, and a mixed-mode game never offers a "solo" button that a lobby cannot honour.
  const roomModes = manifest.modes.filter((m): m is RoomIdentity['mode'] => m !== 'solo');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  // HOW MANY CHAIRS. Defaults to `seats.min` — the SMALLEST table, not the largest.
  //
  // The first draft defaulted to `seats.max` on the "default is whatever already shipped" rule that
  // AI difficulty follows. That rule is about not silently RETUNING a game under someone, and a seat
  // count is not a tuning knob: defaulting to the biggest table reproduces exactly the friction this
  // control exists to remove, for everyone who does not notice the control. Sitting down to UNO meant
  // adding six CPUs before you could press Start, and a picker you have to find first does not fix
  // that. The smallest table is the one you can start on your own, which is what a player opening a
  // game alone is trying to do; anybody who wants a full house is one tap away.
  const sizeChoices = tableSizeChoices(manifest.seats);
  const [seatCount, setSeatCount] = useState(manifest.seats.min);
  // WHAT A CHAIR COSTS. Chosen here, at create, because it is stamped onto the room and every
  // joiner is bound by it — the seat-count argument, with money behind it: a table cannot grow a
  // chair under someone who joined by code, and it must certainly not raise the stakes on them.
  // Defaults to nothing (`DEFAULT_ANTE_CENTS`), so no chip ever moves because a control went
  // unnoticed.
  const anteOptions = anteChoices(manifest.betting);
  const [anteCents, setAnteCents] = useState(DEFAULT_ANTE_CENTS);
  // THE HOUSE WILL BANK A LONE PLAYER, if the game declared that it has measured what its bots are
  // worth. That single flag is what lets an 'ai' table charge an ante at all — before it, betting
  // needed two humans everywhere, so a table of bots had nothing to win and the picker was hidden.
  const houseBanks = manifest.betting?.house === true;
  // WHAT GAME THIS TABLE IS PLAYING. The ante's sibling, and create-time for the same reason with
  // the money taken out: a table must not change the rules under a player who already sat down.
  // Defaults to nothing on — every house rule off IS the game as it already plays, so a host who
  // does not touch this gets exactly the table that existed before the control did.
  const ruleSpecs = houseRuleChoices(manifest.houseRules);
  const [houseRules, setHouseRules] = useState<TableRules>(NO_TABLE_RULES);
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
   * WHAT THE EMPTY CHAIRS COME UP HOLDING (plans/GAME_LAUNCH_MODAL.md §5.2). The one place in the
   * app that turns a mode into a fill — `seats.ts` deliberately refuses to, because "below this
   * line there is no mode, only seats", and the lobby is the component that already owns the mode
   * buttons and writes the mode to the URL.
   *
   * ONLINE STAYS OPEN, and that is a decision rather than an omission (§5.3): a public table that
   * comes up full starts before anyone can walk up to it, which is the wrong default for the one
   * mode whose entire point is other people. The host fills it from the room instead — that is
   * what "Fill with CPUs" in `SeatList` is for.
   */
  const fill: SeatFill = mode === 'ai' ? 'ai' : mode === 'hotseat' ? 'local' : 'none';
  const host = { uid: myUid, name: session.username || 'Player' };
  // The array the preview draws AND the array the create is about to produce — one call, so the
  // preview cannot promise a table create does not deliver. See `plannedSeats`.
  const planned = plannedSeats({ seatCount, host, fill });

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

  const createTable = () => {
    setBusy(true);
    void (async () => {
      const result = await repos.room.create(manifest.id, {
        seatCount,
        host,
        // AN 'AI' TABLE IS NEVER LISTED, whatever the toggle last said. The mode is otherwise a
        // client-side matter (it decides which seats are LOCAL, nothing about the room), but a
        // player who picked "vs the house" is not asking for company, and a stranger arriving in
        // their game is a surprise the browser has no business creating. The control is hidden in
        // that mode for the same reason — a visible toggle that cannot change the outcome is
        // worse than none.
        visibility: mode === 'online' ? visibility : 'private',
        // AN 'AI' TABLE ANTES ONLY IF THE HOUSE WILL BANK IT. It never did before slice 5, and the
        // reason was sound while it held: betting needed two humans, an AI table has exactly one by
        // construction, and charging a stake that could only ever be handed back to the person who
        // paid it is worse than not offering it. What changed is not the reasoning but the fact —
        // UNO measured what a player wins against its own `sharp` bots, so there is now a
        // counterparty and a price. A game that has NOT measured it still zeroes here, and the
        // control is hidden with it.
        anteCents: mode === 'online' || houseBanks ? anteCents : 0,
        // NOT mode-gated, unlike the two above, and the difference is the point: those are both
        // about other PEOPLE (who may join, who can be charged), so an AI table zeroes them. A
        // house rule is about the GAME, and a table of bots plays the same game a table of humans
        // does. `tableRulesFor` sends only what is on and only what this game declares.
        houseRules: tableRulesFor(houseRules, ruleSpecs),
        // THE HOUSE SITS DOWN WITH YOU, inside the create itself. Not a loop of `setAi` calls
        // afterwards: the referee seats them in the same construction as the host, so the table is
        // never observably half-filled and a stranger cannot walk into a chair the host is about to
        // fill. See `store.create`.
        fillAi: fill === 'ai',
      });
      if (!result.ok) {
        setBusy(false);
        toast.error(result.error);
        return;
      }
      /**
       * A HOT-SEAT TABLE IS FILLED BY THE CLIENT, and the asymmetry with `fillAi` above is the
       * design rather than an inconsistency (§5.2). A seat carrying a uid must be written by the
       * account that owns it — the one seat rule the server cannot keep on somebody's behalf — so
       * the extra local players are ordinary claims from the host's own socket. Chess is the only
       * hot-seat game and its table is two chairs, so this is ONE call, on a private table nobody
       * can race; a `fillLocal` wire field would be more surface than the case deserves.
       *
       * Sequential and awaited before entering, so the table the room mounts is the table the
       * preview drew — arriving to a half-seated board and watching chairs fill in is the same
       * "wait, is this working?" the six clicks were.
       */
      if (fill === 'local') {
        for (let i = 1; i < planned.length; i += 1) {
          await repos.room.claimSeat(manifest.id, result.value, i, {
            uid: myUid,
            name: localSeatName(i),
          });
        }
      }
      setBusy(false);
      enterTable(result.value);
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
                  chooseMode(m);
                }}
              >
                {m}
              </Button>
            ))}
          </div>
        )}
        {/*
          HOW MANY CHAIRS (v1's "PLAYERS 2 / 3 / 4"). Only drawn when the manifest's seat range
          holds more than one size — see `tableSizeChoices`. Before this, `seats.min` was decoration
          and every table was built at `max`, which is why sitting down to UNO meant filling six
          CPU chairs whether or not you wanted them.
        */}
        {sizeChoices.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
              Players
            </span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="How many players">
              {sizeChoices.map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={n === seatCount ? 'secondary' : 'ghost'}
                  aria-pressed={n === seatCount}
                  onClick={() => {
                    setSeatCount(n);
                  }}
                >
                  {n}
                </Button>
              ))}
            </div>
          </div>
        )}
        {/*
          WHAT A CHAIR COSTS (v1's "ANTE: NONE / $25 / $100 / $500 / $1K"). Drawn only when the game
          declares `betting` AND the ladder holds more than one stake — `anteChoices` collapses to
          `[0]` otherwise, and a stake picker offering only "None" is a control that cannot change
          the outcome.

          ONLINE, or AI at a game the house will bank — the mirror of what `createTable` sends. A
          visible ante on a table that can never pay one out is the same lie as a visibility toggle
          on a table that is never listed, which is why this was online-only until a lone player had
          a counterparty and a measured price.
        */}
        {(mode === 'online' || houseBanks) && anteOptions.length > 1 && (
          <div className="flex flex-col gap-2">
            <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
              Ante
            </span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="What a seat costs">
              {anteOptions.map((cents) => (
                <Button
                  key={cents}
                  size="sm"
                  variant={cents === anteCents ? 'secondary' : 'ghost'}
                  aria-pressed={cents === anteCents}
                  onClick={() => {
                    setAnteCents(cents);
                  }}
                >
                  {cents === 0 ? 'None' : formatMoney(cents)}
                </Button>
              ))}
            </div>
            {/*
              WHAT THE STAKE BUYS, said before the table exists — and it is two different sentences
              now, because there are two counterparties. A table of people plays for each other's
              money; a lone player plays the house, which funds the pot and prices it under fair
              odds. Neither sentence names a multiple: the odds are a rule of the GAME (the lobby
              must not learn one), and the exact pot is on the board the moment it is dealt.
            */}
            {anteCents > 0 &&
              (mode === 'ai' ? (
                <p className="text-bw-muted text-xs">
                  You ante {formatMoney(anteCents)} against the house, which banks the pot. The bots
                  play their best and the odds are the house&rsquo;s — win and it pays out, lose and
                  it keeps the ante.
                </p>
              ) : (
                <p className="text-bw-muted text-xs">
                  Every player antes {formatMoney(anteCents)}; the winner takes the pot.{' '}
                  {houseBanks
                    ? 'One player against bots is banked by the house instead, at the house’s odds.'
                    : 'Needs two human players — otherwise the table plays for XP alone.'}
                </p>
              ))}
          </div>
        )}
        {/*
          HOUSE RULES (plans/done/UNO_HOUSE_RULES.md §1) — how this TABLE plays, as opposed to
          `<GameOptions>` below, which is how one client does. Drawn only for a game that declares
          any, so the lobby is unchanged for the other five.

          NOT online-only, unlike the ante and the visibility toggle above. Those two are about
          other people; a house rule is about the game, and a table of bots plays the same game.

          CREATE-TIME ONLY — there is no counterpart in the in-room view, and that is the control
          doing its job rather than a gap in it: the rules are stamped on the room and read by the
          referee at the deal, so a mid-lobby retune would change the game under somebody who
          already took a chair. Same shape as the seat count and the stake, same reason.
        */}
        {ruleSpecs.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
              House rules
            </span>
            <div className="flex flex-col gap-2" role="group" aria-label="House rules">
              {ruleSpecs.map((spec) => {
                const on = isRuleOn(houseRules, spec.id);
                const available = isRuleAvailable(houseRules, spec);
                return (
                  <div key={spec.id} className="flex flex-col gap-0.5">
                    <Button
                      size="sm"
                      className="self-start"
                      variant={on ? 'secondary' : 'ghost'}
                      aria-pressed={on}
                      disabled={!available}
                      onClick={() => {
                        setHouseRules((prev) => setTableRule(prev, ruleSpecs, spec.id, !on));
                      }}
                    >
                      {on ? '✓ ' : ''}
                      {spec.label}
                    </Button>
                    {spec.hint !== undefined && (
                      <p className="text-bw-muted text-xs">{spec.hint}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/*
          PUBLIC vs PRIVATE, chosen before the table exists (V1_FEATURE_GAPS #9). This is the one
          control the room browser adds to the lobby, and it is here rather than inside the room
          because a table that is briefly public is public: somebody can already have joined by the
          time you change your mind. Public is the default — that is what every table was before
          the browser, and a discovery surface nobody appears on is worth nothing.
        */}
        {mode === 'online' && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Who can join">
            {(['public', 'private'] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={v === visibility ? 'secondary' : 'ghost'}
                aria-pressed={v === visibility}
                onClick={() => {
                  setVisibility(v);
                }}
              >
                {v === 'public' ? 'Listed' : 'Code only'}
              </Button>
            ))}
          </div>
        )}
        {/*
          THE TABLE YOU ARE ABOUT TO CREATE (§5.1) — v1's lobby preview, and the half of that
          screen worth keeping. It sits directly above Create because that is the question it
          answers: this is what pressing the button produces, seat for seat, before it produces it.

          It is the same `plannedSeats` array the create path uses, not a drawing of one. That is
          why a mode change redraws it (an AI table shows CPUs, an online one shows open chairs a
          stranger can take) with nothing in this component knowing what a mode is.
        */}
        <SeatPreview seats={planned} />
        <Button variant="primary" disabled={busy} onClick={createTable}>
          Create table
        </Button>
      </Card>

      {/* Renders nothing when no table of this game is open, so the lobby is unchanged on a quiet
          day and the code form below is still the way in. */}
      <RoomBrowser
        gameId={manifest.id}
        title="Open tables"
        onJoin={(_gameId, joinRoomId) => {
          enterTable(joinRoomId);
        }}
      />

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
          Join a table
        </h2>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim() !== '') enterTable(code.trim().toUpperCase());
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
              {isHost && <GameOptions className="justify-end" forMoney={backing === 'house'} />}
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
