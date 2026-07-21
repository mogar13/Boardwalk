import { useState } from 'react';
import { Button, Card, Input, Modal } from '@/ui';
import { useAuth, useIsAdmin } from '@/system/auth/useAuth';
import { formatMoney, useProfile } from '@/system/profile/useProfile';
import { useProfileEditor } from '@/system/profile/useProfileEditor';
import { nextRankAfterLevel, rankForLevel, xpProgress } from '@boardwalk/game-logic';
import { equippedTitle } from '@boardwalk/game-logic';
import { Avatar } from '@/system/profile/Avatar';
import { useEquippedFrame } from '@/system/frame/useEquippedFrame';

/**
 * The signed-in player, in full. The top bar (`src/shell/TopBar`) shows a compact version
 * of the same facts; this is the profile route's expanded card, with the XP meter the top
 * bar has no room for — and, from Phase 4, the one editable thing: the display name.
 *
 * Phase 2's proof still holds here: the record came back from RTDB, through `ProfileRepo`,
 * into the store, and the bankroll below is real. What Phase 3 changed is `level` — it is
 * no longer a stored field, it is `xpProgress(profile.xp).level`, computed the same way
 * everywhere it appears so the badge and the bar can never disagree. What Phase 4 adds is the
 * writer: renaming goes through `useProfileEditor`, the same single `mutateProfile` path a bet
 * or a purchase takes, so the top bar re-renders the new name the instant it saves.
 */
export function ProfileCard() {
  const { session, signOut } = useAuth();
  const profile = useProfile();
  const isAdmin = useIsAdmin();
  const frame = useEquippedFrame();
  const { rename } = useProfileEditor();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  if (session === null || profile === null) return null;

  const { level, into, needed, pct } = xpProgress(profile.xp);
  const title = equippedTitle(profile);
  // The rank is what the level MEANS, and it is derived from the same `level` the meter draws —
  // one `xpProgress` call feeds the badge, the bar and the name, so none of the three can disagree.
  const rank = rankForLevel(level);
  const nextRank = nextRankAfterLevel(level);

  const openEditor = () => {
    setDraft(profile.name);
    setEditing(true);
  };

  const save = () => {
    setSaving(true);
    void rename(draft).then((ok) => {
      setSaving(false);
      if (ok) setEditing(false);
    });
  };

  return (
    <>
      <Card className="flex flex-col gap-6 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <Avatar emoji={profile.avatar} size="lg" frame={frame} />
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-display text-base-content text-lg font-semibold tracking-[0.08em]">
                  {profile.name}
                </span>
                {/* The one editable thing. Quiet, next to the name, opening a real <Modal> — never
                  a native prompt(), which is a lint error and cannot be themed or tested. */}
                <Button variant="quiet" size="sm" onClick={openEditor}>
                  Edit
                </Button>
              </div>
              <span className="text-bw-muted text-xs">
                Level {level}
                {/* The RANK — what the level is called. Not a colour of its own: it reads in the
                  muted body tone, because it is a description of the number beside it rather than
                  a third status signal. A rank is NOT the equipped title below — one is reached,
                  the other is bought or earned — and they sit next to each other precisely so a
                  reader can tell which is which. */}
                {' · '}
                <span className="text-base-content font-semibold">{rank.name}</span>
                {/* The equipped title — the reader that keeps a `title` cosmetic from being
                  loadout.color. Cyan (= here / you), never gold, so it reads as identity, not
                  money. Absent when nothing is equipped, which is most accounts. */}
                {title !== null && (
                  <>
                    {' · '}
                    <span className="text-secondary font-semibold">{title}</span>
                  </>
                )}
                {/* Hiding a badge is cosmetic. `admins/<uid>` and database.rules.json are
                  what actually stop a non-admin's writes — this only renders a fact the
                  server already decided. v1 shipped two backdoors by getting that
                  backwards. */}
                {isAdmin && ' · admin'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex flex-col gap-1">
              <span className="font-display text-bw-muted text-[0.65rem] font-semibold tracking-[0.2em] uppercase">
                Bankroll
              </span>
              {/* Gold, once, and only here on this card. It is money — that is the whole
                rule. `data-money` gives tabular figures from the theme, so a ticking
                balance does not reflow on every digit the way v1's HUD does. */}
              <span
                data-money
                className="font-display text-accent text-3xl font-bold tracking-tight"
              >
                {formatMoney(profile.bankrollCents)}
              </span>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                void signOut();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>

        {/* The XP meter. Cyan, not gold — progress is "here", not money — and it does not
          glow: the room stays dark, and a filling bar is furniture, not a sign. `into` and
          `needed` come from the same `xpProgress` call as `level`, so there is one source
          for the badge and the bar both. */}
        <div className="flex flex-col gap-1.5">
          <div className="text-bw-muted flex items-center justify-between text-xs">
            <span className="font-display font-semibold tracking-[0.2em] uppercase">
              {rank.name}
            </span>
            <span data-money>
              {into.toLocaleString('en-US')} / {needed.toLocaleString('en-US')} XP
            </span>
          </div>
          {/* What the bar is FOR. A rank with no next rung is a sticker; naming the one being
            climbed towards is what makes the meter a goal. Absent at Casino Legend, because
            `nextRankAfterLevel` returns null there and inventing a rung above the last one would
            be a promise the ladder does not keep. */}
          {nextRank !== null && (
            <span className="text-bw-muted text-[0.7rem]">
              {nextRank.name} at level {nextRank.minLevel}
            </span>
          )}
          <div
            className="bg-base-300 border-bw-line inset-shadow-well h-2 w-full overflow-hidden rounded-full border"
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
        </div>
      </Card>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit your name"
        description="Your display name — not your login. It shows in the top bar and on the leaderboard."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              Save name
            </Button>
          </>
        }
      >
        <Input
          label="Display name"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          maxLength={40}
          autoFocus
        />
      </Modal>
    </>
  );
}
