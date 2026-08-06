import { Link, useNavigate } from 'react-router-dom';
import { Card } from '@/ui';
import { PIERS, gameIconSrc, gamesOnPier } from '@/games/registry';
import type { RegisteredGame } from '@/games/registry';
import { DailyRewardCard } from '@/system/rewards/DailyRewardCard';
import { RefillCard } from '@/system/economy/RefillCard';
import { RoomBrowser } from '@/system/room/RoomBrowser';

/**
 * The hub — the boardwalk seen from the entrance. It renders the piers in order, and each
 * pier renders the games standing on it. The hub reads the registry and hardcodes no
 * catalogue, so a new game appears here the day its manifest lands, with no change to this
 * file. That is the test of the structure, and six games in it has held.
 *
 * IT IS SIZED TO FIT ONE SCREEN, and that is a deliberate constraint rather than a coat of
 * paint. The entrance to an arcade should show you the whole arcade: with six games across
 * three piers the old layout ran the Arcade pier below the fold, so the third of three piers
 * was discoverable only by scrolling past everything a returning player had already read.
 * Two things bought the room back — the piers moved to a three-column grid inside a CENTRED
 * `max-w-6xl` column (the previous full-bleed `max-w-[110rem]` stretched a four-column grid
 * across 1760px, which is why a two-game pier read as one card and a lot of nothing), and
 * every card, heading and gap came down a step.
 *
 * NOT `h-screen overflow-hidden`, deliberately. "Fits" is a property of a desktop viewport,
 * not a promise the layout can keep at every size: a phone, a short laptop or a browser at
 * 200% zoom must still reach the Arcade, and clipping it to the viewport would hide the last
 * pier ABSOLUTELY rather than one scroll away. So this is a tight, centred column that
 * happens to fit — and degrades to an ordinary scroll when it cannot. The Phase 1 war story
 * is the same shape: a layout that "worked" until a real viewport disagreed with it.
 */

function GameCard({ game }: { game: RegisteredGame }) {
  // A link to `/play/:id`, keyed off `manifest.id` — the same string the route resolves back
  // through `findGame`. The hub never hardcodes a game; it reads the registry, so a new game
  // appears here the moment its manifest lands, with no change to this file.
  const { id, name, blurb, icon } = game.manifest;
  const iconSrc = gameIconSrc(icon);
  return (
    <Link to={`/play/${id}`} className="block">
      {/* The icon sits BESIDE the text now rather than above it, which is most of where a row
          of vertical space went. `h-full` keeps every card in a pier the same height however
          long its blurb runs, so the grid stays a grid. */}
      <Card interactive className="flex h-full items-start gap-3 p-4">
        {iconSrc !== undefined ? (
          // The art is furniture, not a sign — no glow (CLAUDE.md's card rule). `alt=""` +
          // aria-hidden because the heading right beside it already names the card.
          // `shrink-0` so a long name cannot squeeze the icon into a sliver.
          <img src={iconSrc} alt="" aria-hidden className="h-10 w-10 shrink-0 object-contain" />
        ) : (
          // Until a game's art is curated in, a quiet well with its initial keeps every card
          // the same height — the "bring the asset with its reader" rule, drawn honestly.
          <span
            aria-hidden
            className="bg-base-300 border-bw-line text-bw-muted rounded-field font-display flex h-10 w-10 shrink-0 items-center justify-center border text-lg font-bold"
          >
            {name.charAt(0)}
          </span>
        )}
        {/* `min-w-0` is what lets the blurb wrap instead of forcing the flex row wider than
            its column — without it a long blurb blows out the grid track. */}
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="font-display text-base-content text-sm font-semibold tracking-[0.1em] uppercase">
            {name}
          </h3>
          <p className="text-bw-muted text-xs leading-snug">{blurb}</p>
        </div>
      </Card>
    </Link>
  );
}

function EmptyPier() {
  return (
    <Card className="border-bw-line/60 flex items-center justify-center border-dashed p-5">
      <p className="text-bw-muted text-xs">No games on this pier yet — check back soon.</p>
    </Card>
  );
}

export function Hub() {
  const navigate = useNavigate();
  return (
    // A CENTRED column, not the shell's full bleed, and centred on BOTH axes.
    //
    // Horizontally: the shell's `max-w-[110rem]` is right for a store grid with thirty tiles; for
    // six games it left a four-column track mostly empty and pinned everything to the left edge of
    // a 1920px screen. The leaderboard already opts out of full width for the same reason — a page
    // asks for the width its content wants.
    //
    // Vertically: `min-h-full` + `justify-center`. Once the piers fit, the leftover space belongs
    // split above and below, not dumped underneath — the hub is a title screen, and a title screen
    // hugging the top of a 1080p display with 300px of nothing below it reads as a page that
    // failed to load the rest of itself.
    //
    // `my-auto`, not `justify-center` — this element is a flex ITEM (the shell's `main` is the
    // column), and auto margins on a flex item absorb the free space around it.
    //
    // WHY THIS CANNOT CLIP THE TOP, which is the usual bug with centred flex content: auto margins
    // only ever distribute POSITIVE free space. When the piers are taller than the viewport there
    // is none — `main` grows, the margins collapse to zero, and the page scrolls from the heading
    // like any other. Verified at a 600px-tall viewport, where the heading sits at +105 with
    // scrollTop 0 rather than at a negative offset nothing can scroll back to.
    <div className="mx-auto my-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.08em] uppercase">
          The Boardwalk
        </h1>
        <p className="text-bw-muted max-w-2xl text-xs">
          Pick a pier. The Casino takes your bankroll; the Tables and the Arcade are just for the
          game.
        </p>
      </header>

      <DailyRewardCard />

      {/* Renders nothing unless the bankroll has run out, so on an ordinary day the hub is
          unchanged. It sits under the daily claim because when both are showing, the claim is
          the better of the two moves. */}
      <RefillCard />

      {/*
        ACTIVE TABLES (V1_FEATURE_GAPS #9) — the hub's half of the room browser, and the reason it
        is a hub surface at all: v1's scanner is what filled casual online tables, because a player
        who has to be HANDED a code can only play with people they already know. Renders nothing
        when no table is open, so on a quiet day the hub is exactly what it was.

        Joining is a NAVIGATION, not a room action: the hub sends the player to the game's own
        route carrying the code, and `<Lobby>` reads it back off the URL. So the hub never touches
        a room, and a shared link works identically to a click here.
      */}
      <RoomBrowser
        onJoin={(gameId, roomId) => {
          void navigate(`/play/${gameId}?table=${roomId}`);
        }}
      />

      {PIERS.map((pier) => {
        const games = gamesOnPier(pier.id);
        return (
          <section key={pier.id} className="flex flex-col gap-2">
            {/* Name and tagline on ONE row on wide screens: three piers each spending a second
                line on a sentence nobody re-reads is three lines of the budget. It wraps back to
                two lines when the row is too narrow, which is the normal flex-wrap behaviour and
                needs no breakpoint. */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="font-display text-base-content text-xs font-semibold tracking-[0.2em] uppercase">
                {pier.name}
              </h2>
              <p className="text-bw-muted text-xs">{pier.tagline}</p>
            </div>

            {games.length === 0 ? (
              <EmptyPier />
            ) : (
              // Three columns, not four. Every pier holds three games or fewer today, so a
              // four-track grid could never fill a row — it only made each card narrower and the
              // right-hand gutter wider. Three fills the Tables pier exactly and keeps every card
              // in every pier the same width, which is what makes the three sections read as one
              // board rather than three unrelated rows.
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {games.map((game) => (
                  <GameCard key={game.manifest.id} game={game} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
