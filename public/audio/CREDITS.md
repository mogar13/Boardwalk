# Asset credits

This repo carries assets in two tiers, and the distinction is deliberate.

**Curated, in-use SDK assets** — `public/audio/`, `public/cards/`, `public/chips/`, `public/games/`,
`public/felts/`. The sound, card and chip assets are **CC0** (public domain); the game-card icons
come from the Game Shack icon set and are **CC0 / CC-BY**. These are trimmed to the set the SDK
actually plays — an asset arrives with the game that draws it — and each family has a test that
resolves it to a file on disk.

**One honest exception, added by P5: `public/felts/`.** Every other curated directory is CC0, and
until now "curated" and "CC0" happened to mean the same set. The three felts are curated *out of*
the mixed-provenance `public/assets/` trove described below rather than from a CC0 pack, so they
carry that tier's terms — **private use only, not cleared for redistribution or sale** — even
though they now live in a curated directory. The distinction that matters is the licence, not the
folder, so it is written down here rather than inferred from where the file sits. If these ever
need to be public-cleared, they are three images and a recolour would replace them.

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
| Table felts — `public/felts/felt-{blue,green,red}.png` (P5's `felt` cosmetic) | Game Shack asset trove (`public/assets/boards/table_*.png`) | Mixed (see note) — **private use only** |
| Standard 52-card deck + backs, UNO deck (`public/cards/`) | Kenney — *Boardgame Pack* (kenney.nl) | CC0 |
| Poker chips (`public/chips/`) | Rad Potato — *Pixel Perfect* board-game asset pack (itch.io) | CC0 |
| Game-card icons — Blackjack, Tic-Tac-Toe (Game Shack icons), Chess (a knight from the piece set), UNO (a red number card), Solitaire (Kenney Ace of Spades) — all in `public/games/` | Game Shack icon set + Kenney deck | CC0 / CC-BY — cleared for reuse |
| Favicon — arcade joystick (inlined in `index.html` as a data URI, not a file) | Game Shack icon set | CC0 / CC-BY — cleared for reuse |
| Full Game Shack image library — pieces (incl. chess), boards, backgrounds, dice, sudoku + the Game Shack card/chip/icon sets (`public/assets/`) | Game Shack asset trove | Mixed (mostly CC0/CC-BY; 7 branded logos excluded) — **private use only** |

The unextracted originals live outside the repo (on the maintainer's machine). The curated dirs keep
the "bring the asset with its reader" discipline — `public/games/` never fills with icons for games
that do not exist. `public/assets/` is the one place that rule is intentionally set aside, for the
reason above.
