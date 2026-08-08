import { Link, useNavigate } from 'react-router-dom';
import { Card } from '@/ui';
import { PIERS, gameIconSrc, gamesOnPier } from '@/games/registry';
import type { RegisteredGame } from '@/games/registry';
import {
  nextRankAfterLevel,
  rankForLevel,
  totalPlayed,
  totalWins,
  xpProgress,
} from '@boardwalk/game-logic';
import { hubGreeting } from '@/shell/greeting';
import { useProfile } from '@/system/profile/useProfile';
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
 * three piers the original layout ran the Arcade pier below the fold, so the third of three
 * piers was discoverable only by scrolling past everything a returning player had already read.
 *
 * FITTING IS NOT SHRINKING, and the first attempt at this confused the two. It bought the room
 * back by taking every card, icon, heading and gap down a step, narrowing to `max-w-6xl`, and
 * then CENTRING the result on both axes with `my-auto`. Each move is defensible alone; together
 * they turned a hub into a stamp — 1152px of tiny cards floating in the middle of a 1920×1080
 * screen with ~200px of nothing above the title and ~200px below the last pier. The dead band
 * under the top bar is the tell: a page that starts a third of the way down does not read as
 * "centred", it reads as a page that failed to load the rest of itself. Nothing could catch
 * this — it typechecked, it fit, it needed a screenshot (the Phase 1 war story, again).
 *
 * So the constraint stayed and the levers changed. The hub is TOP-ALIGNED like every other
 * page, and it is WIDE enough that three cards across are cards rather than chips. Leftover
 * height falls at the bottom, which is what every ordinary page does and nobody reads as broken.
 * Empty space below the content is the absence of more content; empty space ABOVE it is a
 * missing header. And the fit is bought PER VIEWPORT rather than once for all of them — see the
 * short-viewport tier at the layout root, which is what lets a desktop keep its full size while a
 * 768px laptop still lands the Arcade above the fold.
 *
 * NOT `h-screen overflow-hidden`, deliberately. "Fits" is a property of a viewport, not a promise
 * the layout can keep at every size: a phone, a very short window or a browser at 200% zoom must
 * still reach the Arcade, and clipping it to the viewport would hide the last pier ABSOLUTELY
 * rather than one scroll away. The tier moves the height at which that happens a long way down; it
 * does not abolish it, and nothing here should try to.
 */

function GameCard({ game }: { game: RegisteredGame }) {
  // A link to `/play/:id`, keyed off `manifest.id` — the same string the route resolves back
  // through `findGame`. The hub never hardcodes a game; it reads the registry, so a new game
  // appears here the moment its manifest lands, with no change to this file.
  const { id, name, blurb, icon } = game.manifest;
  const iconSrc = gameIconSrc(icon);
  return (
    <Link to={`/play/${id}`} className="block">
      {/* The icon sits BESIDE the text rather than above it, which is most of where a row of
          vertical space went. `h-full` keeps every card in a pier the same height however long
          its blurb runs, so the grid stays a grid. */}
      <Card
        interactive
        className="flex h-full items-center gap-4 p-6 [@media(max-height:900px)]:p-4"
      >
        {iconSrc !== undefined ? (
          // The art is furniture, not a sign — no glow (CLAUDE.md's card rule). `alt=""` +
          // aria-hidden because the heading right beside it already names the card.
          // `shrink-0` so a long name cannot squeeze the icon into a sliver.
          <img src={iconSrc} alt="" aria-hidden className="h-20 w-20 shrink-0 object-contain" />
        ) : (
          // Until a game's art is curated in, a quiet well with its initial keeps every card
          // the same height — the "bring the asset with its reader" rule, drawn honestly.
          <span
            aria-hidden
            className="bg-base-300 border-bw-line text-bw-muted rounded-field font-display flex h-20 w-20 shrink-0 items-center justify-center border text-xl font-bold"
          >
            {name.charAt(0)}
          </span>
        )}
        {/* `min-w-0` is what lets the blurb wrap instead of forcing the flex row wider than
            its column — without it a long blurb blows out the grid track. */}
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="font-display text-base-content text-base font-semibold tracking-[0.1em] uppercase">
            {name}
          </h3>
          <p className="text-bw-muted text-sm leading-snug">{blurb}</p>
        </div>
      </Card>
    </Link>
  );
}

/**
 * WHO YOU ARE AND HOW FAR ALONG — and it is what used to be a second "THE BOARDWALK", printed
 * directly under a top bar already carrying the wordmark.
 *
 * The duplication was the visible complaint; the interesting part is that fixing it uncovered the
 * same fault one column over. The top bar also carried the level and an XP sliver, so any header
 * here that said anything about the player would have re-run the bug it was replacing. So the
 * progression moved rather than being copied: `LevelPip` is GONE from `TopBar`, and this is where
 * it landed. See that file's header for why money and XP are not the same kind of fact and do not
 * belong in the same place.
 *
 * WHAT THE ROOM BOUGHT. A 64px sliver in a crowded bar could only say "you are making progress";
 * the pip's own comment conceded that the rank rode in a `title` tooltip because "Casino Legend"
 * would not fit. Here it fits, and so does the next rung — which is what turns a rank from a
 * sticker into a reason to play another hand (`ranks.ts` says exactly that, and until now only
 * the profile card had the room to honour it).
 *
 * EVERY NUMBER IS DERIVED, none stored: `level` from `xp`, the rank from the level, `wins` from
 * `stats`. One `xpProgress` call feeds the level, the bar and the XP figures, so the three cannot
 * disagree — the same discipline the profile card's meter holds to, and the wording is
 * deliberately identical to that card's ("Level N · Rank", "into / needed XP", "Rank at level N")
 * so two pages describing one fact do not invent two vocabularies for it.
 */
function HubHeader() {
  const profile = useProfile();
  // The session restores a tick before the profile on some paths. A header addressed to nobody is
  // a worse frame than no header, and the page below it is complete either way.
  if (profile === null) return null;

  const { level, into, needed, pct } = xpProgress(profile.xp);
  const rank = rankForLevel(level);
  const nextRank = nextRankAfterLevel(level);
  const wins = totalWins(profile.stats);

  return (
    <header className="flex flex-col gap-1.5">
      {/* `2xl`, where the old wordmark heading was `3xl`. The line is a sentence now rather than
          two words, and the budget this page runs on has not changed. */}
      <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.08em] uppercase">
        {hubGreeting({ name: profile.name, played: totalPlayed(profile.stats) })}
      </h1>
      <div className="text-bw-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>
          Level {level} · <span className="text-base-content font-semibold">{rank.name}</span>
        </span>
        {/* Cyan, and it does not glow. Progress is "here", not money, and a filling bar is
            furniture — the same call the profile card's meter makes. */}
        <div
          className="bg-base-300 border-bw-line inset-shadow-well h-1.5 w-24 overflow-hidden rounded-full border"
          role="progressbar"
          aria-valuenow={Math.round(pct * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Level ${String(level)} progress`}
        >
          <div
            className="bg-secondary h-full rounded-full transition-[width] duration-500 ease-strike"
            style={{ width: `${String(Math.round(pct * 100))}%` }}
          />
        </div>
        {/* `data-money` is tabular figures, not a claim about currency — an XP count ticks the
            same way a balance does, and without it the row reflows on every award. */}
        <span data-money>
          {into.toLocaleString('en-US')} / {needed.toLocaleString('en-US')} XP
        </span>
        {/* Absent at the top of the ladder, because `nextRankAfterLevel` returns null there and
            inventing a rung above the last one is a promise the ladder does not keep. */}
        {nextRank !== null && (
          <>
            <span aria-hidden>·</span>
            <span>
              {nextRank.name} at level {nextRank.minLevel}
            </span>
          </>
        )}
        <span aria-hidden>·</span>
        <span>
          {wins.toLocaleString('en-US')} win{wins === 1 ? '' : 's'}
        </span>
      </div>
    </header>
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
    // A centred column, narrower than the shell's full bleed and TOP-ALIGNED.
    //
    // Horizontally: the shell's `max-w-[110rem]` is right for a store grid with thirty tiles; for
    // six games it left a four-column track mostly empty. But `max-w-6xl` over-corrected — 1152px
    // on a 1920px screen is a 384px gutter each side, and three cards inside it are chips. `7xl`
    // is the width at which three across are cards. The leaderboard also opts out of full width —
    // a page asks for the width its content wants.
    //
    // Vertically: NOTHING. No `my-auto`, no `justify-center`. The earlier version centred on both
    // axes on the theory that a title screen should sit in the middle of its viewport, and on a
    // 1080p display that put ~200px of empty between the top bar and the word "BOARDWALK" — which
    // does not read as composed, it reads as broken. Leftover height goes at the bottom, where
    // every other page on the web puts it.
    //
    // THE SHORT-VIEWPORT TIER (`max-height: 900px`) is what stops "fits one screen" from being a
    // tax on the screens that already fit. The constraint is viewport-dependent, so its solution
    // has to be too: a fixed size can satisfy the 768px laptop or look right on the 1080p monitor,
    // and tuning one number for both is what produced the stamp this file's header describes —
    // everything was `text-xs` because the shortest laptop set the budget for everybody.
    //
    // So the budget is only spent where it is scarce. Above 900px tall nothing here applies and the
    // layout is exactly what a desktop sees. At or below it the WHITESPACE tightens — the outer
    // rhythm, the pier heading gap, the card padding — and the art, the type and the column width
    // do not move. Whitespace is the right currency: a 16px gap costs a reader nothing to lose,
    // where a type step costs them the text. Three tightenings buy ~120px, which is what a 1366×768
    // laptop needs to land the Arcade pier above the fold.
    //
    // It is a MEDIA QUERY, not a hook, so there is no resize listener, no state and no second
    // render — and it is an arbitrary variant rather than a named one because a named variant is a
    // theme token, and a theme token with one reader owes a guard that it resolves (see
    // tests/theme-tokens.test.ts, and `loadout.color` for why). Verified in a browser at 768 and
    // 800, which is also the only way to catch a media query Tailwind failed to generate: an
    // unmatched variant emits no CSS at all, silently, exactly like an undefined token.
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 [@media(max-height:900px)]:gap-3">
      <HubHeader />

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
          <section key={pier.id} className="flex flex-col gap-4 [@media(max-height:900px)]:gap-2">
            {/* Name and tagline on ONE row on wide screens: three piers each spending a second
                line on a sentence nobody re-reads is three lines of the budget. It wraps back to
                two lines when the row is too narrow, which is the normal flex-wrap behaviour and
                needs no breakpoint. */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 className="font-display text-base-content text-sm font-semibold tracking-[0.2em] uppercase">
                {pier.name}
              </h2>
              <p className="text-bw-muted text-sm">{pier.tagline}</p>
            </div>

            {games.length === 0 ? (
              <EmptyPier />
            ) : (
              // Three columns, not four. Every pier holds three games or fewer today, so a
              // four-track grid could never fill a row — it only made each card narrower and the
              // right-hand gutter wider. Three fills the Tables pier exactly and keeps every card
              // in every pier the same width, which is what makes the three sections read as one
              // board rather than three unrelated rows.
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
