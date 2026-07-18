# Asset credits

The sound, card and chip assets under `public/audio/`, `public/cards/` and `public/chips/` are
**CC0** (public domain). Commercial use is permitted and attribution is not required — but it is
appreciated, so it is recorded here. The game-card icons under `public/games/` come from the Game
Shack icon set and are **CC0 / CC-BY**, cleared for reuse by the maintainer; where an icon is
CC-BY, attribution travels with the source assets. These are the same asset families the original
Game Shack shipped; they were curated down to the set the Boardwalk actually plays (never dumped
wholesale — an asset arrives with the game that draws it).

| Assets | Source | License |
|---|---|---|
| Casino SFX — card slides/places, chip lays, shuffle, win/lose/push, click, notify (`public/audio/`) | Kenney — *Casino Audio* & *Music Jingles* packs (kenney.nl) | CC0 |
| Standard 52-card deck + backs, UNO deck (`public/cards/`) | Kenney — *Boardgame Pack* (kenney.nl) | CC0 |
| Poker chips (`public/chips/`) | Rad Potato — *Pixel Perfect* board-game asset pack (itch.io) | CC0 |
| Game-card icons — Blackjack, Tic-Tac-Toe (`public/games/`) | Game Shack icon set (flat game icons) | CC0 / CC-BY — cleared for reuse |
| Favicon — arcade joystick (inlined in `index.html` as a data URI, not a file) | Game Shack icon set | CC0 / CC-BY — cleared for reuse |

The unextracted originals of these packs live outside the repo (on the maintainer's machine); only
the curated, in-use subset is committed here. Only the icons a registered game actually names are
staged — the same "bring the asset with its reader" discipline the audio and card registries hold
to, so `public/games/` never fills with art for games that do not exist yet.
