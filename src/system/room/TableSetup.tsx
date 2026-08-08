import { useState } from 'react';
import { Button, Card, Input, useToast } from '@/ui';
import type { GameManifest } from '@/games/registry';
import { GameOptions } from '@/system/options/GameOptions';
import { useAuthStore } from '@/system/auth/authStore';
import { formatMoney } from '@boardwalk/game-logic';
import { repos } from '@/system/repo';
import { RoomBrowser } from '@/system/room/RoomBrowser';
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
import type { RoomMode } from '@/system/room/modes';
import { SeatPreview } from '@/system/room/SeatPreview';
import {
  humanCapacity,
  localSeatName,
  plannedSeats,
  tableSizeChoices,
  type SeatFill,
} from '@/system/room/seats';
import type { RoomVisibility } from '@/system/room/types';

/**
 * THE WAYS TO A TABLE — create one, browse for one, or type its code. ONE implementation
 * (plans/GAME_LAUNCH_MODAL.md §2), mounted in two places:
 *
 *   • `<GameLaunchModal>`, over the hub — the entrance, where a click on a game card lands.
 *   • `<Lobby>`, on the play route — because `/play/uno` typed directly, and a shared table link
 *     whose room has closed, both still arrive with no table to be at.
 *
 * The second is why this is a component rather than a screen inside the modal: the panel must not
 * exist twice, and the version that would rot is the one nobody reaches by clicking.
 *
 * IT NEVER LEARNS WHERE IT IS. `{ manifest, mode, onEntered }` and nothing else — no `inModal`
 * flag, no variant. What differs between the two homes is entirely the caller's: the lobby is
 * already at the right route and writes `?table=`, while the modal has to navigate to the game
 * first. Neither concern belongs in a create panel, and a component that knew which one it was in
 * would grow a second layout the day one of them changed.
 *
 * THE MODE IS A PROP, not a control here. `<Lobby>` owns it because the mode lives in the URL (see
 * that file for why that is a correctness property), and the modal owns it because picking a way in
 * IS its first step. Either way this component reads it and maps it to a seat fill, which is the
 * one place in the app that turns a mode into a fill — `seats.ts` deliberately refuses to.
 */
export interface TableSetupProps {
  readonly manifest: GameManifest;
  readonly mode: RoomMode;
  /** A table was created, found or typed — the caller decides what "go there" means. */
  readonly onEntered: (roomId: string) => void;
}

export function TableSetup({ manifest, mode, onEntered }: TableSetupProps) {
  const session = useAuthStore((s) => s.session);
  const toast = useToast();
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
  // WHAT GAME THIS TABLE IS PLAYING. The ante's sibling, and create-time for the same reason with
  // the money taken out: a table must not change the rules under a player who already sat down.
  // Defaults to nothing on — every house rule off IS the game as it already plays, so a host who
  // does not touch this gets exactly the table that existed before the control did.
  const ruleSpecs = houseRuleChoices(manifest.houseRules);
  const [houseRules, setHouseRules] = useState<TableRules>(NO_TABLE_RULES);

  if (session === null) {
    return (
      <Card className="p-6">
        <p className="text-bw-muted text-sm">Sign in to play at a table.</p>
      </Card>
    );
  }
  const myUid = session.uid;

  // THE HOUSE WILL BANK A LONE PLAYER, if the game declared that it has measured what its bots are
  // worth. That single flag is what lets an 'ai' table charge an ante at all — before it, betting
  // needed two humans everywhere, so a table of bots had nothing to win and the picker was hidden.
  const houseBanks = manifest.betting?.house === true;

  /**
   * WHAT THE EMPTY CHAIRS COME UP HOLDING (plans/GAME_LAUNCH_MODAL.md §5.2). The one place in the
   * app that turns a mode into a fill — `seats.ts` deliberately refuses to, because "below this
   * line there is no mode, only seats".
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
   * WHO WOULD PAY FOR THIS TABLE, as far as a table that does not exist yet can say — which is
   * only ever enough to decide what to lock (`pinnedForMoney`), never what to pay.
   *
   * `humanCapacity` and not `humanCount`: a planned online table holds one human and a row of open
   * chairs, and counting only the seated one would answer "the house banks this", locking UNO's bot
   * tier at `sharp` on the strength of a guess that nobody else will ever join. An AI table has no
   * open chairs by construction, so it answers `'house'` — which is the arrangement the pin exists
   * for and the one place a lone player is genuinely playing the building.
   */
  const backing = tableBacking(manifest.betting, anteCents, humanCapacity(planned));

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
      onEntered(result.value);
    })();
  };

  return (
    /*
      TWO COLUMNS ON A WIDE SCREEN: make on the left, join on the right. v1 stacked them in one
      scrolling column and then dimmed the host settings to 30% opacity the moment you typed in the
      join-code box — an apology for a layout that made it genuinely unclear which half the button
      at the bottom belonged to (§1). The two columns remove the ambiguity instead, so there is
      nothing to dim, and on a narrow screen they stack back with the create panel first.
    */
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="font-display text-bw-muted text-xs font-semibold tracking-[0.2em] uppercase">
          New table
        </h2>
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
          HOW THIS CLIENT PLAYS — the AI tier, and whatever else a game declares. Drawn from
          `manifest.options` by the OS's one control, so a game never draws a picker; a game with
          nothing declared renders nothing at all here.

          It is a `<GameShell>` value rather than a room field, which is exactly right for the only
          option any room game declares today (a tier read by the host, who drives every bot) and
          exactly wrong for anything a GUEST must also read — that belongs in room state, and it is
          named as a real change rather than a nuance in `manifest.houseRules`.
        */}
        <GameOptions forMoney={backing === 'house'} />
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
          `<GameOptions>` above, which is how one client does. Drawn only for a game that declares
          any, so the panel is unchanged for the other five.

          NOT online-only, unlike the ante and the visibility toggle. Those two are about other
          people; a house rule is about the game, and a table of bots plays the same game.

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

      <div className="flex flex-col gap-6">
        {/* Renders nothing when no table of this game is open, so the panel is unchanged on a
            quiet day and the code form below is still the way in. */}
        <RoomBrowser
          gameId={manifest.id}
          title="Open tables"
          onJoin={(_gameId, joinRoomId) => {
            onEntered(joinRoomId);
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
              if (code.trim() !== '') onEntered(code.trim().toUpperCase());
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
      </div>
    </div>
  );
}
