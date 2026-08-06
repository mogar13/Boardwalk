import { Card, cx } from '@/ui';
import { useAudio } from '@/system/audio/useAudio';
import { useIsAdmin } from '@/system/auth/useAuth';
import { Link } from 'react-router-dom';

/**
 * Settings — the player-facing preferences page. NOT admin-gated: everything here is a choice
 * about this browser, not a privilege.
 *
 * IT OWNS NO STATE. Every row reads and writes through the system that already owns the setting —
 * `useAudio()` for mute, which persists to `localStorage` and syncs across tabs on its own. This
 * page is a second VIEW of a preference, never a second copy of it, which is the same call the
 * top bar's mute toggle makes: two controls, one store, so they cannot drift. A settings page that
 * held its own `useState` and pushed on save is how a mute button ends up disagreeing with itself.
 *
 * DELIBERATELY SHORT. There is exactly one real preference in this app today, and a settings page
 * padded with controls that do nothing is the `loadout.color` defect with a nicer heading. Rows
 * arrive here when the thing they configure does — the same bar a sound role or a cosmetic kind
 * has to clear.
 *
 * Theme is NOT here, and that is a decision rather than an omission: `packages/theme/theme.css` is
 * the one file permitted to name a colour, the app ships a single neon identity, and a theme
 * switcher would need a second full palette to switch to. Light/dark is not a toggle this design
 * has — the glow budget is defined against the dark surfaces. See CLAUDE.md's UI section.
 */

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-bw-line/60 flex flex-wrap items-center justify-between gap-4 border-b py-4 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-display text-base-content text-sm font-semibold tracking-[0.06em]">
          {label}
        </span>
        <span className="text-bw-muted text-xs">{hint}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * A two-state switch. Not `<Button>`: a Button is an ACTION ("Claim $500"), and this is a state
 * with a readable position — so it carries `role="switch"` + `aria-checked`, which a screen reader
 * announces as on/off rather than as a button whose label happens to have changed.
 */
function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={cx(
        'rounded-field font-display px-4 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase',
        'ring-1 transition-colors duration-200 ease-strike',
        on
          ? 'bg-secondary/15 text-secondary ring-secondary/40'
          : 'text-bw-muted ring-bw-line hover:text-base-content'
      )}
    >
      {on ? 'On' : 'Off'}
    </button>
  );
}

export function Settings() {
  const { muted, toggleMute } = useAudio();
  const isAdmin = useIsAdmin();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.08em] uppercase">
          Settings
        </h1>
        <p className="text-bw-muted text-xs">
          Preferences for this browser. Your bankroll, record and cosmetics live on your account —
          they are the same on every device.
        </p>
      </header>

      <Card className="flex flex-col px-5 py-1">
        {/* The label says what the switch turns ON, so "On" means sound plays — mute is stored
            inverted and inverting it here is the whole reason this is a function of `muted` and
            not `muted` itself. A switch whose On means silence is a switch people press twice. */}
        <Row label="Sound" hint="Card deals, chips, and the payout fanfare.">
          <Toggle on={!muted} onChange={toggleMute} label="Sound" />
        </Row>
      </Card>

      {/* Only rendered for an admin, and it is a LINK, not a privilege — `/dev` does its own
          gating. Hiding a link is convenience; `admins/<uid>` and database.rules.json are the
          boundary. See CLAUDE.md's security posture: `.dev-only` only hides UI. */}
      {isAdmin && (
        <Card className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <span className="font-display text-base-content text-sm font-semibold tracking-[0.06em]">
              Developer
            </span>
            <span className="text-bw-muted text-xs">
              Build stamp, backend health, resolved wiring and your raw record.
            </span>
          </div>
          <Link
            to="/dev"
            className="rounded-field font-display text-secondary ring-secondary/40 px-4 py-1.5 text-xs font-semibold tracking-[0.08em] uppercase ring-1"
          >
            Open /dev
          </Link>
        </Card>
      )}
    </div>
  );
}
