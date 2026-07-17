import { useState } from 'react';
import { Button, Card, Input, Modal, UiRoot, useToast, useConfirm } from '@/ui';
import { AuthPanel } from '@/system/auth/AuthPanel';
import { useAuth, useAuthBootstrap } from '@/system/auth/useAuth';
import { ProfileCard } from '@/system/profile/ProfileCard';
import { firebaseReady } from '@/system/repo';

/**
 * Phase 1 shipped the LOOK, so this page was the look. Phase 2 makes the top of it real:
 * the bankroll card is no longer a hardcoded 500_000, it is a record that came back from
 * Firebase through `ProfileRepo`. The rest is still the style guide.
 *
 * It is still not a hub. The hub, the router and the top bar are Phase 3, and building
 * them here would be four phases of decisions made in one afternoon.
 *
 * It is also the dog food. This file lives outside `src/ui`, so both Phase 1 lint
 * rules apply to it in full — it cannot spell `btn`, and it cannot spell a colour.
 * Everything below is built from the kit and semantic tokens only, which is the
 * same constraint every game will be under from Phase 6. If the kit were missing
 * something, this page could not have been written, and that is the point of
 * writing it first.
 */

/** Local to the demo. A real <Section> would be a kit component; this is a page. */
function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-base-content text-sm font-semibold tracking-[0.2em] uppercase">
          {title}
        </h2>
        <p className="text-bw-muted max-w-2xl text-sm">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`border-bw-line rounded-field h-12 w-full border ${token}`} />
      <span className="text-bw-muted font-mono text-[0.65rem] tracking-tight">{label}</span>
    </div>
  );
}

/**
 * No credentials, no app. The panel names every missing variable.
 *
 * This is the deliberate opposite of v1's failure mode. There, the config was inline in 32
 * HTML files and a game discovered the database was missing by polling `window.db` every
 * 50ms — forever, silently, with no error anywhere. Here the answer is on screen, in the
 * theme, naming the fix. A production build never reaches this state at all: vite.config.ts
 * fails the build. Only `npm run dev` on a fresh clone can, which is exactly when someone
 * needs to be told what to do.
 */
function NotConfigured({ error }: { error: string }) {
  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="font-display text-warning text-sm font-semibold tracking-[0.2em] uppercase">
        Firebase is not configured
      </h2>
      <pre className="text-bw-muted overflow-x-auto font-mono text-xs whitespace-pre-wrap">
        {error}
      </pre>
    </Card>
  );
}

/** Signed in -> the player. Signed out -> the form. No config -> the panel that says so. */
function Account() {
  const ready = firebaseReady();
  const { status } = useAuth();

  if (!ready.ok) return <NotConfigured error={ready.error} />;
  return status === 'signed-in' ? <ProfileCard /> : <AuthPanel />;
}

export default function App() {
  const [modalOpen, setModalOpen] = useState(false);
  const [bet, setBet] = useState('25');
  const toast = useToast();
  const { confirm } = useConfirm();

  // The one session subscription, started once, torn down on unmount. Mounted here beside
  // <UiRoot /> because both are app-root singletons; in Phase 3 both move into the shell.
  useAuthBootstrap();

  return (
    <>
      <div className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-16">
        {/* ── The sign ──────────────────────────────────────────────────────
            Real neon reads WHITE at the core with the hue thrown outward, which is
            why the letters are base-content and the magenta lives entirely in
            text-shadow-neon. Setting the text itself magenta is the tell that
            separates CSS neon from a sign: a lit tube saturates your eye, so the
            gas colour is only ever visible in the air around it. */}
        <header className="flex flex-col items-center gap-4 pt-8 text-center">
          <p className="font-display text-secondary text-xs font-semibold tracking-[0.4em] uppercase">
            Casino OS v2
          </p>
          <h1 className="font-display text-base-content text-shadow-neon text-6xl font-bold tracking-[0.08em] uppercase sm:text-8xl">
            The Boardwalk
          </h1>
          <p className="text-bw-muted max-w-xl text-sm">
            Phase 2 — the data layer. Five games will run on this, and none of them are written yet.
            The look was decided in Phase 1; this phase decided where the money lives.
          </p>
        </header>

        {/* ── The account ───────────────────────────────────────────────────
            Phase 1 had a hardcoded 500_000 here with two decorative buttons. This is
            the same card with a database behind it — the bankroll below came out of
            RTDB through ProfileRepo, and gold still appears exactly once on the page,
            because it is still money and money is still the only thing it means. */}
        <Section
          title="Your account"
          subtitle="Phase 2 — the data layer. Firebase Auth owns the password; this app never sees one. Sign up without an email and your account is a synthetic address that cannot receive mail, which is the trick that keeps real addresses out of a world-readable username index."
        >
          <Account />
        </Section>

        <Section
          title="Buttons"
          subtitle="A button is a sign. Primary is the lit tube and there is one per view; ghost is the same tube unlit, and hovering strikes it. That is why a page can carry a dozen without becoming a ransom note — only the one you are touching is on."
        >
          <Card className="flex flex-wrap items-center gap-3 p-6">
            <Button variant="primary">Place bet</Button>
            <Button variant="secondary">Sit down</Button>
            <Button variant="ghost">Spectate</Button>
            <Button variant="danger">Leave table</Button>
            <Button variant="quiet">Cancel</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </Card>
          <Card className="flex flex-wrap items-center gap-3 p-6">
            <Button variant="primary" size="sm">
              Small
            </Button>
            <Button variant="primary" size="md">
              Medium
            </Button>
            <Button variant="primary" size="lg">
              Large
            </Button>
          </Card>
        </Section>

        <Section
          title="Surfaces"
          subtitle="A card is lit from above, not filled lighter — the elevation is a 1px highlight on the top edge, because that is where light lands. Interactive cards take a cyan edge: cyan means here, magenta means act, and a hovered card is a location, not a verb."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {['Blackjack', 'Chess', 'UNO'].map((name) => (
              <Card key={name} interactive className="flex flex-col gap-2 p-5">
                <h3 className="font-display text-base-content text-base font-semibold tracking-[0.1em] uppercase">
                  {name}
                </h3>
                <p className="text-bw-muted text-sm">Not built yet — Phase 6.</p>
              </Card>
            ))}
          </div>
        </Section>

        <Section
          title="Fields"
          subtitle="The inverse of a card: cut into the page, so the top edge is in shadow. Label, hint and error are props because a bare styled input is a skin, and every consumer that hand-rolls the label is one that eventually forgets it."
        >
          <Card className="grid gap-5 p-6 sm:grid-cols-2">
            <Input
              label="Your bet"
              hint="Table minimum $2, maximum $500."
              value={bet}
              inputMode="numeric"
              onChange={(e) => {
                setBet(e.target.value);
              }}
            />
            <Input
              label="Room code"
              error="No table with that code — check the four letters."
              defaultValue="XKCD"
            />
          </Card>
        </Section>

        <Section
          title="Overlays"
          subtitle="One modal and one useToast(), because v1 has four ad-hoc modal systems and toasts that lazily inject their own container. alert/confirm/prompt are lint errors — these are where that road leads."
        >
          <Card className="flex flex-wrap items-center gap-3 p-6">
            <Button
              variant="secondary"
              onClick={() => {
                setModalOpen(true);
              }}
            >
              Open modal
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void (async () => {
                  // The replacement for `if (confirm(msg))`. Still one line — which
                  // is the only reason banning the global is realistic.
                  const ok = await confirm({
                    title: 'Leave the table?',
                    body: 'Your $250 bet stays on the felt. This cannot be undone.',
                    confirmLabel: 'Forfeit $250',
                    destructive: true,
                  });
                  if (ok) toast.warning('You left. The $250 stayed.');
                  else toast.info('Still seated.');
                })();
              }}
            >
              Ask to leave
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                toast.success('Seat claimed.');
              }}
            >
              Toast: nice
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                toast.error('Seat taken — someone claimed it first.');
              }}
            >
              Toast: problem
            </Button>
          </Card>
        </Section>

        <Section
          title="The palette"
          subtitle="Every value generated and checked, never eyeballed: all inside sRGB, every foreground at least 4.5:1 on all three surfaces. Gold is money and nothing else, which is why warning is amber and sits 24° away from it."
        >
          <Card className="grid grid-cols-3 gap-4 p-6 sm:grid-cols-6">
            <Swatch token="bg-base-100" label="base-100" />
            <Swatch token="bg-base-200" label="base-200" />
            <Swatch token="bg-base-300" label="base-300" />
            <Swatch token="bg-primary" label="primary" />
            <Swatch token="bg-secondary" label="secondary" />
            <Swatch token="bg-accent" label="accent · money" />
            <Swatch token="bg-info" label="info" />
            <Swatch token="bg-success" label="success" />
            <Swatch token="bg-warning" label="warning" />
            <Swatch token="bg-error" label="error" />
            <Swatch token="bg-bw-line" label="bw-line" />
            <Swatch token="bg-bw-muted" label="bw-muted" />
          </Card>
        </Section>

        <footer className="border-bw-line text-bw-muted border-t pt-8 pb-4 text-center text-xs">
          Phase 0 shipped a pipeline. Phase 1 shipped a look. Phase 2 shipped the data layer. Next:
          the shell — router, top bar, hub.
        </footer>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
        }}
        title="Table rules"
        description="Blackjack pays 3:2. Dealer stands on soft 17."
        footer={
          <>
            <Button
              variant="quiet"
              onClick={() => {
                setModalOpen(false);
              }}
            >
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setModalOpen(false);
                toast.success('Seated. Good luck.');
              }}
            >
              Sit down
            </Button>
          </>
        }
      >
        <p>
          This is a native <code className="text-secondary">&lt;dialog&gt;</code>. Focus is trapped,
          the page behind is inert, Escape closes it, and it renders in the top layer — none of
          which is our code. v1 hand-rolled four of these and got a different subset of it right
          each time.
        </p>
      </Modal>

      {/* Once, at the root. Toasts and confirm() do not work without it. */}
      <UiRoot />
    </>
  );
}
