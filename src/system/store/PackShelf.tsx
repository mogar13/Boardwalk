/**
 * THE PACK SHELF — the store's slot machine, and the visible half of P4.
 *
 * Two jobs, both of which are the mechanic rather than decoration:
 *
 *   1. PUBLISH THE ODDS. Every pack card renders its rate table, read straight off `pack.odds` —
 *      the same object `openPack` rolls against, so the shown odds cannot drift from the real ones.
 *      This is not a legal nicety bolted on; it is the honest version of the thing it imitates, and
 *      the reason it is safe to imitate at all (play money, published rates, no purchase path —
 *      see the guardrail in `packs.ts`).
 *   2. STAGE THE REVEAL. A pull is one modal, one card, one line: what you got, what tier it is,
 *      and — on a duplicate — the dust it converted to. The reveal is the product; a toast would
 *      throw the moment away.
 *
 * The audio is roles that already exist (`jackpot` for epic-and-up, `win` for a fresh pull, `push`
 * for a duplicate) — no new sound files staged for a feature that can borrow. Celebration stingers
 * are P5's, when there is a reason to curate them properly.
 */
import { useState } from 'react';
import { useAudio } from '@/system/audio/useAudio';
import { formatDollars } from '@/system/profile/money';
import type { Profile } from '@/system/profile/types';
import type { Rarity } from '@/system/store/catalog';
import { CosmeticPreview } from '@/system/store/CosmeticPreview';
import { canOpen, dustFor, PACKS, packPool, type Pack, type PackPull } from '@/system/store/packs';
import { RARITY_ORDER, RARITY_TEXT } from '@/system/store/rarity';
import { useStore } from '@/system/store/useStore';
import { Button, Card, Modal, cx } from '@/ui';

/** A pack's published rate table. One row per tier the pack can actually serve. */
function Odds({ pack }: { pack: Pack }) {
  const servable = RARITY_ORDER.filter(
    (r) => pack.odds[r] > 0 && packPool(pack).some((c) => c.rarity === r)
  );
  return (
    <dl className="flex w-full flex-col gap-1">
      {servable.map((rarity) => (
        <div key={rarity} className="flex items-baseline justify-between gap-2">
          <dt
            className={cx(
              'font-display text-[0.6rem] font-semibold tracking-[0.18em] uppercase',
              RARITY_TEXT[rarity]
            )}
          >
            {rarity}
          </dt>
          <dd className="text-bw-muted text-xs tabular-nums">
            {(pack.odds[rarity] * 100).toFixed(pack.odds[rarity] < 0.01 ? 1 : 0)}%
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PackCard({
  pack,
  profile,
  onOpen,
}: {
  pack: Pack;
  profile: Profile;
  onOpen: (pack: Pack) => void;
}) {
  const check = canOpen(profile, pack);
  const pool = packPool(pack);
  const ownedCount = pool.filter((c) => c.id in profile.inventory).length;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <span className="font-display text-base-content text-sm font-semibold tracking-[0.08em]">
          {pack.name}
        </span>
        <p className="text-bw-muted text-xs leading-snug">{pack.blurb}</p>
      </div>

      <Odds pack={pack} />

      <p className="text-bw-muted text-[0.65rem] leading-snug">
        {ownedCount} of {pool.length} collected · a duplicate refunds{' '}
        {formatDollars(dustFor(pack, 'common'))}–{formatDollars(dustFor(pack, 'legendary'))}
      </p>

      <div className="mt-auto flex flex-col items-center gap-2">
        <span data-money className="text-accent text-xs font-semibold">
          {formatDollars(pack.priceCents)}
        </span>
        <Button variant="primary" size="sm" disabled={!check.ok} onClick={() => onOpen(pack)}>
          Open
        </Button>
        {!check.ok && <span className="text-bw-muted text-center text-xs">{check.error}</span>}
      </div>
    </Card>
  );
}

/** The reveal. Held open by the pull itself, so it cannot be open with nothing to show. */
function Reveal({ pull, pack, onClose }: { pull: PackPull; pack: Pack; onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={pull.duplicate ? 'Duplicate' : 'You pulled'}
      description={
        pull.duplicate
          ? `You already own ${pull.item.name}, so it converted to ${formatDollars(pull.dustCents)} in dust.`
          : `${pull.item.name} is yours — equip it from the ${pack.kinds.length > 1 ? 'shelves' : 'shelf'} below.`
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-3 py-4">
        <CosmeticPreview item={pull.item} large />
        <span className="font-display text-base-content text-lg font-semibold tracking-[0.08em]">
          {pull.item.name}
        </span>
        <span
          className={cx(
            'font-display text-xs font-semibold tracking-[0.18em] uppercase',
            RARITY_TEXT[pull.item.rarity]
          )}
        >
          {pull.item.rarity}
        </span>
      </div>
    </Modal>
  );
}

/** Which sound a tier deserves. Epic-and-up gets the loud one; that is the whole point of a tier. */
function soundFor(rarity: Rarity): 'jackpot' | 'win' {
  return rarity === 'epic' || rarity === 'legendary' ? 'jackpot' : 'win';
}

export function PackShelf({ profile }: { profile: Profile }) {
  const { open } = useStore();
  const { play } = useAudio();
  const [reveal, setReveal] = useState<{ pull: PackPull; pack: Pack } | null>(null);

  const handleOpen = (pack: Pack): void => {
    void (async () => {
      const pull = await open(pack);
      if (pull === null) return;
      play(pull.duplicate ? 'push' : soundFor(pull.item.rarity));
      setReveal({ pull, pack });
    })();
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-base-content text-xl font-semibold tracking-[0.08em] uppercase">
          Packs
        </h2>
        <p className="text-bw-muted max-w-2xl text-xs">
          Chips in, one random cosmetic out. Rates are published on every pack and duplicates refund
          dust. Play money only — nothing here has ever cost a real cent, and nothing ever will.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PACKS.map((pack) => (
          <PackCard key={pack.id} pack={pack} profile={profile} onOpen={handleOpen} />
        ))}
      </div>
      {reveal !== null && (
        <Reveal pull={reveal.pull} pack={reveal.pack} onClose={() => setReveal(null)} />
      )}
    </section>
  );
}
