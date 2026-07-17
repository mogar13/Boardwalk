import { Button, Card } from '@/ui';
import { formatDollars } from '@/system/profile/money';
import type { Profile } from '@/system/profile/types';
import { useProfile } from '@/system/profile/useProfile';
import { CATALOG, isEquipped, isOwned, type Cosmetic } from '@/system/store/catalog';
import { useStore } from '@/system/store/useStore';

/**
 * The store — Phase 4's, with something priced and a way to pay. It sells AVATARS and only
 * avatars, on purpose: an equipped avatar has a reader today (the top bar, the profile card), and
 * a cosmetic with no reader is `loadout.color` — v1's field written by the store and read by
 * nothing, a row in the defect table. Card backs and felts land with the game that draws them.
 *
 * Dog food, like every file outside `src/ui`: the kit and semantic tokens only. Gold is the price
 * and nothing else on this page; the Buy button is the lit primary blue (the action), Equip is a quiet unlit
 * tube until you touch it, and the one you are wearing is cyan (= here).
 */

function CosmeticCard({
  item,
  profile,
  buy,
  equip,
}: {
  item: Cosmetic;
  profile: Profile;
  buy: (item: Cosmetic) => void;
  equip: (item: Cosmetic) => void;
}) {
  const owned = isOwned(profile, item);
  const equipped = isEquipped(profile, item);
  const affordable = profile.bankrollCents >= item.priceCents;

  return (
    <Card className="flex flex-col items-center gap-3 p-5 text-center">
      <span className="text-5xl" aria-hidden>
        {item.emoji}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="font-display text-base-content text-sm font-semibold tracking-[0.08em]">
          {item.name}
        </span>
        {item.priceCents === 0 ? (
          <span className="text-bw-muted text-xs">Starter</span>
        ) : (
          <span data-money className="text-accent text-xs font-semibold">
            {formatDollars(item.priceCents)}
          </span>
        )}
      </div>

      {equipped ? (
        <span className="font-display text-secondary text-xs font-semibold tracking-[0.14em] uppercase">
          Equipped
        </span>
      ) : owned ? (
        <Button variant="ghost" size="sm" onClick={() => equip(item)}>
          Equip
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          disabled={!affordable}
          onClick={() => {
            void buy(item);
          }}
        >
          Buy
        </Button>
      )}
    </Card>
  );
}

export function Store() {
  const profile = useProfile();
  const { buy, equip } = useStore();
  if (profile === null) return null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-base-content text-3xl font-bold tracking-[0.08em] uppercase">
          The Store
        </h1>
        <p className="text-bw-muted max-w-2xl text-sm">
          Avatars for your bankroll. What you equip shows in the top bar and on your profile — card
          backs and felts arrive with the games that draw them.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {CATALOG.map((item) => (
          <CosmeticCard key={item.id} item={item} profile={profile} buy={buy} equip={equip} />
        ))}
      </div>
    </div>
  );
}
