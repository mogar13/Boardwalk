# Asset credits

This repo carries assets in two tiers, and the distinction is deliberate.

**Curated, in-use SDK assets** — `public/audio/`, `public/cards/`, `public/chips/`, `public/games/`,
`public/felts/`. The sound and card assets are **CC0** (public domain); the game-card icons come
from the Game Shack icon set and are **CC0 / CC-BY**. These are trimmed to the set the SDK actually
plays — an asset arrives with the game that draws it — and each family has a test that resolves it
to a file on disk.

**Two honest exceptions: `public/felts/` (P5) and now `public/chips/`.** Most curated directories
are CC0, and for a while "curated" and "CC0" happened to mean the same set. Both of these are
curated *out of* the mixed-provenance `public/assets/` trove described below rather than from a CC0
pack, so they carry that tier's terms — **private use only, not cleared for redistribution or
sale** — even though they live in a curated directory. The distinction that matters is the licence,
not the folder, so it is written down here rather than inferred from where the file sits. Between
them that is ten images, and a recolour would replace them if they ever need to be public-cleared.

**The chips changed hands, and the old set is gone rather than kept beside the new one.**
`public/chips/` held eighteen 16×16 pixel chips from Phase 4 with **no reader at all** — nothing in
`src/` imported them, which is the dead-asset failure this repo names by its own rule. Blackjack's
felt is the first thing to draw a chip, and it needs denominations printed on the face at a size
that survives being stacked in a betting circle; the pixel set is 16×16 and blank. So it was
retired in the same commit that gave the directory a reader, because one curated directory holding
a used set and an unused set is how the next person picks the wrong one.

**The full Game Shack image library** — `public/assets/`. The complete `pieces/` (incl.
`chess-pieces/`), `boards/`, `bgs/`, `dice/`, `sudoku/`, and the Game Shack's own
`cards/`/`chips/`/`icons/` sets, staged **wholesale**. This is a deliberate exception to the
per-game curation above: the Boardwalk is being grown back into the Game Shack for a **private,
non-commercial friends' game night**, so the art its games will use is known and wanted up front.
Provenance here is **mixed** — mostly CC0/CC-BY. Third-party **branded logos** (Monopoly, Clue,
Risk, Scrabble, Trivial Pursuit, Family Feud, SNL) were deliberately **excluded**: publishing a
trademarked mark on a public site (this repo deploys to GitHub Pages) is a different matter from
personal use of generic game art, so those seven files are not committed. What remains is committed
for private play; it is **not** cleared for redistribution or sale.

| Assets | Source | License |
|---|---|---|
| Casino SFX — card slides/places, chip lays, shuffle, win/lose/push, click, notify (`public/audio/`) | Kenney — *Casino Audio* & *Music Jingles* packs (kenney.nl) | CC0 |
| Celebration stingers — `unlock.ogg`, `fanfare.ogg` (P5): an achievement firing and a pack reveal | Kenney — *Music Jingles* pack, Sax set (kenney.nl) | CC0 |
| End-of-round stingers — `victory.ogg`, `defeat.ogg`: a whole game won or lost at a table, as against `win`/`lose`, which settle a single hand. Chosen by MEASUREMENT rather than by name — the Sax set is a sustained instrument, so its spectral contour is the melody and not the decay, and these are the pack's clearest riser and faller | Kenney — *Music Jingles* pack, Sax set (kenney.nl) | CC0 |
| Turn cue — `notify.ogg`, replacing `notify.mp3`: an octave lower (368 Hz against 754) at the same level and a fifth of the length, because the old one read as shrill for something that fires on every turn | Kenney — *Interface Sounds* pack (kenney.nl) | CC0 |
| Table felts — `public/felts/felt-{blue,green,red}.png` (P5's `felt` cosmetic) | Game Shack asset trove (`public/assets/boards/table_*.png`) | Mixed (see note) — **private use only** |
| Standard 52-card deck + backs, UNO deck (`public/cards/`) | Kenney — *Boardgame Pack* (kenney.nl) | CC0 |
| Poker chips — `public/chips/chip-{1,5,10,25,100,500,1000}.png`, the denominations the blackjack felt stacks a wager from | Game Shack asset trove (`public/assets/chips/new-chips/`) | Mixed (see note) — **private use only** |
| Game-card icons — Blackjack, Tic-Tac-Toe (Game Shack icons), Chess (a knight from the piece set), UNO (a red number card), Solitaire (Kenney Ace of Spades) — all in `public/games/` | Game Shack icon set + Kenney deck | CC0 / CC-BY — cleared for reuse |
| Favicon — arcade joystick (inlined in `index.html` as a data URI, not a file) | Game Shack icon set | CC0 / CC-BY — cleared for reuse |
| Full Game Shack image library — pieces (incl. chess), boards, backgrounds, dice, sudoku + the Game Shack card/chip/icon sets (`public/assets/`) | Game Shack asset trove | Mixed (mostly CC0/CC-BY; 7 branded logos excluded) — **private use only** |

The unextracted originals live outside the repo (on the maintainer's machine). The curated dirs keep
the "bring the asset with its reader" discipline — `public/games/` never fills with icons for games
that do not exist. `public/assets/` is the one place that rule is intentionally set aside, for the
reason above.
