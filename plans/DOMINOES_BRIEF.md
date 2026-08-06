# Dominoes — the brief for a session of its own

**Status:** NOT STARTED. Written 2026-08-05 in the session that did the leaderboard fix, the hub
rework, the `/dev` readout and the chess-set cosmetic — where Dominoes was scoped in, then pulled
out by the owner as too big to share a session with all of that. That call was right: this is a
GAME, not an afternoon.

**Why it exists at all:** the owner staged Kenney's domino art and asked for domino cosmetics. There
is no dominoes game, so a `domino` cosmetic would have zero readers — the `loadout.color` defect
CLAUDE.md's store rule exists to prevent. The honest order is **game first, cosmetic second**, and
the cosmetic is the small half.

It is also, by the rule that matters most here, being built **because it sounds fun** — not to make
a number go up. Read
[Scope discipline](../CLAUDE.md#scope-discipline--the-rule-most-likely-to-be-violated) before
starting; if the motivation has drifted to "seven games", stop.

---

## Copy-paste prompt for the new session

> Build Dominoes as game #7 in the Boardwalk, following CLAUDE.md exactly.
>
> Read `plans/DOMINOES_BRIEF.md` first — it has the decisions already taken, the OS seams to reuse,
> and the traps. Then work in this order, and do not start the UI until the logic is green:
>
> 1. `packages/game-logic/src/games/dominoes/logic/` — a pure, unit-tested Block-and-Draw rulebook.
> 2. `tests/dominoes.test.ts` — rules first, UI never before green.
> 3. `src/games/dominoes/` — board + manifest, registered in `src/games/registry.ts`.
> 4. A mastery chain (`tests/achievements.test.ts` asserts chain ids equal the registry's game ids
>    as a SET, so the game cannot ship without one).
> 5. The `domino` cosmetic kind, WITH its reader, in the same commit.
> 6. A real browser pass against the emulator (see the browser-verification recipe), then update
>    CLAUDE.md's Enforcement table and test counts.
>
> Falsify every guard you add — break it on purpose, watch it go red — and stop before any Pi
> deploy or rules deploy to ask me.

---

## Decisions already taken (do not re-litigate)

| Question | Answer | Why |
|---|---|---|
| Which dominoes | **Block & Draw**, double-six | The version everyone means. Muggins/All-Fives needs a scoring UI and a whole second concept; it is a later variant on `manifest.options`, not slice 1. |
| Modes | **`['ai', 'online']`** | Hands are HIDDEN, so hot-seat is contradictory — the same call UNO made and for the same reason. |
| Betting | **NONE in slice 1** | `reportResult({ outcome })` only, like Chess. A pot is Liar's Dice's problem and it is a big one; adding it here would drag in the referee before the rules exist. |
| Who deals | **See the fork below.** This is the one real design decision left. |
| Seats | 2–4 | The standard table. `tableSizeChoices` already draws the picker from `manifest.seats`. |

## The one open fork: who holds the boneyard

Dominoes has hidden hands AND a face-down draw pile, so it is structurally UNO, not Chess. Two
existing models, both already built in this repo:

- **Host-as-dealer (UNO's original model).** The host holds the whole game, projects a public view
  (`toPublic`) and deals each hand to its owner's private node. Cheaper: no server work, no Pi
  deploy. Costs what UNO's model always cost — the host can see every hand.
- **Referee-dealt (Liar's Dice, and UNO since the pot).** The gateway holds the game; the client is
  a renderer. Correct, and the only option if betting is ever added. Costs a Pi deploy and gateway
  work.

**Recommendation: referee-dealt.** UNO has already been moved there, so host-as-dealer is now the
LEGACY model and building a new game on it is walking backwards. `boardwalk-api/src/domain/uno.ts`
plus `src/system/repo/api/unoRepo.ts` are the template — copy that shape, not UNO's pre-pot one.
But this is the owner's call, and it changes the size of the job by a lot.

## Reuse, do not rebuild

Everything below already exists and has callers. Using them is most of the job:

- `useRoom()` / `useSeats()` / `<Lobby>` — seats, presence, ordering, teardown.
- `writeHand(index, data)` / `useHand<T>(index)` — the private per-seat channel (UNO's).
- `<Rematch restart={…}>` — never draw a play-again button.
- `manifest.options` + `useGameOptions()` — for an AI difficulty tier, if you add one.
- `chooseAiMove(state, seat, level, rng)` — the pure-chooser shape both AI games use. **The rng is
  injected so a random tier is a value in a test.**
- `useAudio().play(role)` — a role, never a filename. `deal` and `click` already exist.

## Traps, each paid for by a real bug in this repo

1. **RTDB drops null children.** A wire-shaped state must not use `null` for meaningful-absent —
   Tic-Tac-Toe's `-1` sentinel is the fix. An empty end of the line is exactly this shape.
2. **A bot move the reducer REFUSES is a no-op on a bot's turn, and the table hangs forever.** Play
   whole games out in the test and assert the state CHANGED every move. UNO's first `casual` tier
   passed "legal move" and still could never win — 3,000 turns, no winner.
3. **A hand that can only draw.** Dominoes has UNO's `mustDraw` problem in a worse form: a player
   with no playable bone must draw, possibly repeatedly, and the boneyard can empty. Write the
   rulebook's own predicate (`mustDraw`), have BOTH the UI hint and any auto-draw timer read it, and
   arm the timer on a **KEY** (`round:eventSeq`), never a boolean — a boolean re-arms on every
   republish, so a table that republishes faster than the beat never draws at all.
4. **A blocked game is a real outcome, not a bug.** When nobody can play and the boneyard is empty
   the hand ends and the lightest hand wins. Test it explicitly; it is the state most likely to hang.
5. **Adding a mastery chain needs a Pi deploy before the badges fire.** The catalogue is shared and
   the referee grants from ITS built copy. An unwinnable badge rendering locked forever is the
   `big_win` defect. See the memory note on the shared catalogue.
6. **A `domino` cosmetic kind is a rules change AND a SQLite column.** `equipped` is pinned by
   `$other: false` in `database.rules.json`, and the referee needs an `equipped_domino` column with
   a `COLUMN_MIGRATIONS` entry — the DDL alone never reaches the Pi's existing database. The
   `chessset` kind added on 2026-08-05 is a complete worked example of the whole chain: type →
   catalogue → rules → column → migration → route allowlist → store section → preview arm → tests.

## The art, already on disk to draw from

`~/Desktop/Game-Shack/Gameboard-Pieces-2/Domino/` (Kenney, CC0). Curate the in-use subset into
`public/dominoes/` — do not dump the pack. Bring it in the commit that first draws it.
