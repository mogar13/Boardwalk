import { Button, Card, cx } from '@/ui';
import { useAuth, useIsAdmin } from '@/system/auth/useAuth';
import { useProfile } from '@/system/profile/useProfile';
import { repoWiring } from '@/system/repo';
import { useApiHealth } from '@/system/dev/useApiHealth';
import { formatMoney, totalPlayed, totalWins } from '@boardwalk/game-logic';

/**
 * `/dev` — the readout. What is this build, what is it wired to, is the backend up, and what does
 * my own record actually say.
 *
 * WHY IT EXISTS. Four of this repo's most expensive mistakes were all the same mistake: a fact
 * about the deployed system that nothing on screen could answer, so it got answered from memory
 * and written down wrong. A rules deploy that ran from a tree without the change and printed the
 * identical green. `/health` quoted as evidence of a phase it cannot distinguish. Two kill
 * switches read by the source and injected by nothing. A Pi whose `package.json` had silently
 * drifted behind `main`. Every one of those is "the artifact was never read".
 *
 * SO IT ONLY SHOWS WHAT IT CAN ACTUALLY SEE, and says so where it cannot:
 *
 *   • The BUILD STAMP is baked in by `vite.config.ts` at build time, so it is the commit this
 *     bundle was cut from and cannot be set wrong from outside the build.
 *   • The WIRING comes from `repoWiring`, derived from the very `const`s the `repos` object was
 *     built from — not re-read from `import.meta.env`, which would be a second implementation of
 *     the composition root free to disagree with it.
 *   • HEALTH is a live unauthenticated probe. It is labelled as what it is: proof the process is
 *     up, and **not** proof of which commit the Pi is running. There is no way to learn that from
 *     the browser, and inventing a confident-looking claim about it is the exact failure this page
 *     is a reaction to.
 *
 * IT IS A READOUT, NOT A CONSOLE. Nothing here mutates anything — no grant-me-money button, no
 * force-unlock, no impersonation. `.dev-only` UI is not a boundary (CLAUDE.md's security posture),
 * so a mutation offered here would have to be authorised at the server anyway; and the moment such
 * a route exists, the forgeable-`isDev` shape is back in a new costume. The honest tool is a
 * mirror.
 *
 * ADMIN-GATED, AND THE GATE IS COSMETIC. `Session.isAdmin` is a cache of `admins/<uid>`, read at
 * sign-in and fail-closed. Hiding this page hides a page; every number on it is one the signed-in
 * player could already read about themselves. Nothing here is privileged data, which is why a
 * cosmetic gate is the right strength — a page that NEEDED the gate would be a page that should
 * not exist client-side at all.
 */

function Field({
  label,
  value,
  tone = 'plain',
  mono = true,
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'good' | 'warn' | 'bad';
  mono?: boolean;
}) {
  return (
    <div className="border-bw-line/60 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b py-2 last:border-b-0">
      <span className="font-display text-bw-muted text-[0.65rem] font-semibold tracking-[0.16em] uppercase">
        {label}
      </span>
      <span
        className={cx(
          'text-right text-xs break-all',
          mono && 'font-mono',
          tone === 'good' && 'text-success',
          tone === 'warn' && 'text-warning',
          tone === 'bad' && 'text-error',
          tone === 'plain' && 'text-base-content'
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Panel({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2 p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-base-content text-sm font-semibold tracking-[0.2em] uppercase">
          {title}
        </h2>
        <p className="text-bw-muted text-xs">{blurb}</p>
      </div>
      <div className="flex flex-col">{children}</div>
    </Card>
  );
}

function BuildPanel() {
  return (
    <Panel
      title="Build"
      blurb="Baked in when this bundle was compiled. Not readable from the environment, so it cannot be set wrong after the fact."
    >
      <Field label="Commit" value={__BUILD_COMMIT__} />
      <Field
        label="Working tree"
        value={__BUILD_DIRTY__ ? 'DIRTY — built with uncommitted changes' : 'clean'}
        tone={__BUILD_DIRTY__ ? 'warn' : 'good'}
        mono={false}
      />
      <Field label="Mode" value={__BUILD_MODE__} />
    </Panel>
  );
}

function HealthPanel() {
  const { state, refresh } = useApiHealth();
  return (
    <Card className="flex flex-col gap-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-base-content text-sm font-semibold tracking-[0.2em] uppercase">
            Backend
          </h2>
          {/* The caveat is IN the UI, not only in a comment — this is the exact claim that was
              wrong in CLAUDE.md for three days. */}
          <p className="text-bw-muted max-w-xl text-xs">
            A live, unauthenticated probe. It proves the process is up and the database opens — it
            does <span className="text-warning">not</span> prove which commit the Pi is running.
            Nothing in the browser can; check the artifact on the device.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh}>
          Re-probe
        </Button>
      </div>

      <div className="flex flex-col">
        {state.status === 'unconfigured' ? (
          <>
            <Field
              label="Status"
              value={
                state.url === null
                  ? 'no API in this build — Firebase path end to end'
                  : 'not in use by this build — not probed'
              }
              tone="warn"
              mono={false}
            />
            {/* A configured-but-unused URL is worth showing precisely because it is confusing:
                it is the emulator case, where `.env.local` names the Pi and the composition root
                deliberately ignores it. Saying "unreachable" here would be a lie about the Pi. */}
            {state.url !== null && <Field label="Configured URL" value={state.url} />}
          </>
        ) : state.status === 'loading' ? (
          <p className="text-bw-muted py-2 text-xs">Probing…</p>
        ) : state.status === 'down' ? (
          <>
            <Field label="Status" value={`unreachable — ${state.reason}`} tone="bad" mono={false} />
            <Field label="URL" value={repoWiring.apiBaseUrl ?? '—'} />
          </>
        ) : (
          <>
            <Field label="Status" value="up" tone="good" mono={false} />
            <Field
              label="Database"
              value={state.health.db}
              tone={state.health.db === 'up' ? 'good' : 'bad'}
            />
            <Field
              label="Ticket gate"
              value={state.health.tickets}
              tone={state.health.tickets === 'on' ? 'good' : 'warn'}
            />
            <Field label="Round trip" value={`${String(state.latencyMs)} ms`} />
            <Field label="URL" value={repoWiring.apiBaseUrl ?? '—'} />
          </>
        )}
      </div>
    </Card>
  );
}

function WiringPanel() {
  const w = repoWiring;
  return (
    <Panel
      title="Wiring"
      blurb="What the composition root actually composed. Every one of these is a build-time branch, invisible at runtime until now."
    >
      <Field
        label="Economy + profile"
        value={w.economy}
        tone={w.economy === 'api' ? 'good' : 'warn'}
      />
      <Field
        label="Rooms + chat"
        value={w.rooms}
        tone={w.rooms === 'websocket' ? 'good' : 'warn'}
      />
      <Field
        label="Offline banking"
        value={w.tickets}
        tone={w.tickets === 'server-signed' ? 'good' : 'warn'}
      />
      <Field
        label="Server-dealt games"
        value={
          w.liarsDice && w.uno && w.blackjackTable
            ? "Liar's Dice + UNO + Blackjack available"
            : 'unavailable (no gateway)'
        }
        tone={w.liarsDice && w.uno && w.blackjackTable ? 'good' : 'bad'}
        mono={false}
      />
    </Panel>
  );
}

function RecordPanel() {
  const { session } = useAuth();
  const profile = useProfile();
  if (profile === null) {
    return (
      <Panel title="Your record" blurb="Loading…">
        <p className="text-bw-muted py-2 text-xs">No profile loaded.</p>
      </Panel>
    );
  }

  const played = totalPlayed(profile.stats);
  const wins = totalWins(profile.stats);
  const equipped = Object.entries(profile.equipped);

  return (
    <Panel
      title="Your record"
      blurb="Read back from whichever store the wiring above named. This is the authoritative copy, not the optimistic one."
    >
      <Field label="uid" value={session?.uid ?? '—'} />
      <Field label="Bankroll" value={formatMoney(profile.bankrollCents)} />
      <Field label="XP" value={String(profile.xp)} />
      <Field label="Played / won" value={`${String(played)} / ${String(wins)}`} />
      <Field label="Badges" value={String(Object.keys(profile.achievements).length)} />
      <Field label="Inventory" value={String(Object.keys(profile.inventory).length)} />
      <Field
        label="Equipped"
        value={
          equipped.length === 0
            ? 'nothing'
            : equipped.map(([k, v]) => `${k}=${String(v)}`).join('  ')
        }
      />
      <Field
        label="Daily"
        value={`streak ${String(profile.daily.streak)}, last claim day ${String(profile.daily.lastClaimDay)}`}
        mono={false}
      />
    </Panel>
  );
}

export function Dev() {
  const isAdmin = useIsAdmin();

  if (!isAdmin) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Card className="flex flex-col gap-2 p-8">
          <h1 className="font-display text-base-content text-xl font-bold tracking-[0.08em] uppercase">
            Not available
          </h1>
          <p className="text-bw-muted text-sm">
            This page is for accounts listed in <code className="font-mono">admins/</code>. Nothing
            on it is privileged — it is a readout of your own account and this build — but it is
            noise for everyone else.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-base-content text-2xl font-bold tracking-[0.08em] uppercase">
          Developer
        </h1>
        <p className="text-bw-muted max-w-2xl text-xs">
          A mirror, not a console — nothing here changes anything. It answers the four questions
          that have historically been answered from memory and written down wrong.
        </p>
      </header>

      <BuildPanel />
      <HealthPanel />
      <WiringPanel />
      <RecordPanel />
    </div>
  );
}
