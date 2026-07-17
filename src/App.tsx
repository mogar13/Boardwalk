import { useState } from 'react';
import { Button, Card, Input, Modal, UiRoot, useToast, useConfirm } from '@/ui';

/**
 * Phase 1 ships the LOOK, so this page is the look — every kit component, on
 * screen, in the theme, at the URL. It is a style guide, not a hub: the hub, the
 * router and the top bar are Phase 3, and building them here would be four phases
 * of decisions made in one afternoon.
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

export default function App() {
  const [modalOpen, setModalOpen] = useState(false);
  const [bet, setBet] = useState('25');
  const toast = useToast();
  const { confirm } = useConfirm();

  // The bankroll is integer cents, always — CLAUDE.md, and blackjack's 3:2 natural
  // is why. Formatting is the only place it becomes a decimal.
  const balanceCents = 500_000;

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
            Phase 1 — the theme and the kit. Five games will run on this, and none of them are
            written yet. The look is decided here so that nothing after this has to decide it again.
          </p>
        </header>

        {/* ── Money ─────────────────────────────────────────────────────────
            Gold appears exactly once on this page, and this is it. That is the
            rule doing its job: if gold showed up on a heading too, it would stop
            being the thing your eye finds when you want to know what you have. */}
        <Card className="flex flex-wrap items-center justify-between gap-6 px-6 py-5">
          <div className="flex flex-col gap-1">
            <span className="font-display text-bw-muted text-[0.65rem] font-semibold tracking-[0.2em] uppercase">
              Bankroll
            </span>
            <span
              // data-money → tabular figures, from the theme. A ticking balance
              // that reflows on every digit is v1's HUD, and it is one line to fix.
              data-money
              className="font-display text-accent text-4xl font-bold tracking-tight"
            >
              ${(balanceCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => {
                toast.success('Paid $375 — blackjack, 3:2.');
              }}
            >
              Deal
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                toast.info('Table minimum is $2.');
              }}
            >
              Rules
            </Button>
          </div>
        </Card>

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
          Phase 0 shipped a pipeline. Phase 1 shipped a look. Next: the data layer.
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
