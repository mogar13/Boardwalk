# Asset credits

This repo carries assets in two tiers, and the distinction is deliberate.

**Curated, in-use SDK assets** — `public/audio/`, `public/cards/`, `public/chips/`, `public/games/`.
The sound, card and chip assets are **CC0** (public domain); the game-card icons come from the Game
Shack icon set and are **CC0 / CC-BY**. These are trimmed to the set the SDK actually plays — an
asset arrives with the game that draws it — and each family has a test that resolves it to a file on
disk.

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
| Standard 52-card deck + backs, UNO deck (`public/cards/`) | Kenney — *Boardgame Pack* (kenney.nl) | CC0 |
| Poker chips (`public/chips/`) | Rad Potato — *Pixel Perfect* board-game asset pack (itch.io) | CC0 |
| Game-card icons — Blackjack, Tic-Tac-Toe (`public/games/`) | Game Shack icon set (flat game icons) | CC0 / CC-BY — cleared for reuse |
| Favicon — arcade joystick (inlined in `index.html` as a data URI, not a file) | Game Shack icon set | CC0 / CC-BY — cleared for reuse |
| Full Game Shack image library — pieces (incl. chess), boards, backgrounds, dice, sudoku + the Game Shack card/chip/icon sets (`public/assets/`) | Game Shack asset trove | Mixed (mostly CC0/CC-BY; 7 branded logos excluded) — **private use only** |

The unextracted originals live outside the repo (on the maintainer's machine). The curated dirs keep
the "bring the asset with its reader" discipline — `public/games/` never fills with icons for games
that do not exist. `public/assets/` is the one place that rule is intentionally set aside, for the
reason above.
