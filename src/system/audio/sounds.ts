/**
 * The sound registry — pure data, no DOM, no React, so a test can assert every declared file
 * actually exists on disk (see `tests/audio.test.ts`). This is the audio equivalent of the card
 * art staging: a role-keyed table, exactly like v1's `system_audio.js` `tracks` map, but typed so
 * a game names a ROLE (`'deal'`) and never a filename — the filename is an asset detail that can
 * change without touching a caller, and a misspelled role is a compile error rather than a silent
 * no-op (v1's `play('cardz')` failed quietly).
 *
 * WHY ROLES AND NOT FILES. v1 learned this the useful way: `chipStack` and `card` are ARRAYS of
 * near-identical takes, and playing a random one each time is what stops a rapid deal from
 * sounding like a machine gun. So the registry maps one role to one-or-more files, and the engine
 * picks a variation. The role is the game's vocabulary; how many takes back it is the OS's business.
 *
 * WHY THESE ROLES. This is the casino set — the sounds Blackjack needs and the ones the other
 * card games will reuse (deal, place, flip, chip, shuffle, win/lose/push). It is deliberately not
 * every sound in the trove: a role with no caller is `loadout.color`, a fixture written to be read
 * by nothing. Roles get added here in the commit that first plays them.
 *
 * THE TWO CELEBRATION ROLES (P5) EARN THEIR SEPARATION FROM `win`. `win` answers "this hand went
 * your way" and fires many times an hour; these two answer "you got something you keep", which
 * happens rarely and is worth a different sound. Reusing `win`/`jackpot` for them — which is what
 * P4's pack reveal did as an explicit placeholder — makes an unlock sound like a payout, so the
 * one moment the meta-progression has to sell itself sounds like ordinary play.
 *
 * They are BOTH single-file, not pools, and the split in this registry is not stylistic: `deal`,
 * `place`, `chip` and `chips` are pools because they fire in rapid bursts and identical repeats
 * machine-gun. An unlock or a pack reveal is a punctuation mark, so one take is right and a pool
 * would only make the same event sound inconsistent from itself.
 */

/** A playable role. A game passes one of these to `useAudio().play`; it cannot spell a filename. */
export type SoundName =
  | 'deal' // a card sliding out of the shoe
  | 'place' // a card set down on the felt
  | 'flip' // the dealer's hole card turning face-up
  | 'chip' // a bet pushed forward
  | 'chips' // chips colliding — a pot raked, a win paid
  | 'shuffle' // the deck reshuffled
  | 'win' // this hand won
  | 'jackpot' // a big win — the louder stinger, kept apart from `win` on purpose
  | 'unlock' // an achievement fired — the short bright one, plays behind a toast
  | 'fanfare' // a pack revealed — the long one, and the only role that interrupts
  | 'lose' // this hand lost
  | 'push' // a tie — money back, neither stinger
  | 'click' // a UI affordance (also the browser-unlock primer)
  | 'notify' // something arrived (a chat message, a turn)
  | 'error'; // a refused action

/**
 * Role → the file(s) under `public/audio/` that voice it, WITHOUT the `audio/` prefix or the base
 * path — the engine prepends `import.meta.env.BASE_URL + 'audio/'`, so this stays a plain,
 * environment-free manifest a Node test can read. Multi-entry roles are random-variation pools.
 *
 * `click` is the unlock primer (played muted-then-paused on first gesture), so it must be a single
 * short file, not a pool — the engine reaches for `SOUNDS.click[0]`.
 */
export const SOUNDS: Record<SoundName, readonly string[]> = {
  deal: ['card-slide-1.ogg', 'card-slide-2.ogg', 'card-slide-3.ogg'],
  place: ['card-place-1.ogg', 'card-place-2.ogg'],
  flip: ['card-flip.mp3'],
  chip: ['chip-lay-1.ogg', 'chip-lay-2.ogg', 'chip-lay-3.ogg'],
  chips: ['chips-collide-1.ogg', 'chips-collide-2.ogg', 'chips-collide-3.ogg'],
  shuffle: ['shuffle.ogg'],
  win: ['win.ogg'],
  jackpot: ['jackpot.mp3'],
  unlock: ['unlock.ogg'],
  fanfare: ['fanfare.ogg'],
  lose: ['lose.ogg'],
  push: ['push.ogg'],
  click: ['click.mp3'],
  notify: ['notify.mp3'],
  error: ['error.mp3'],
};

/** Every role, for iteration (the test walks these; a UI could preload them). */
export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

/** Every distinct file the registry references, deduped — what a preloader or a disk test walks. */
export function allSoundFiles(): string[] {
  return [...new Set(SOUND_NAMES.flatMap((name) => SOUNDS[name]))];
}
