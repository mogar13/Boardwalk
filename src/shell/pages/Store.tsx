import { Button, Card, cx } from '@/ui';
import { cardBackSrc } from '@/system/cards/cards';
import { formatDollars } from '@boardwalk/game-logic';
import type { Profile } from '@boardwalk/game-logic';
import { useProfile } from '@/system/profile/useProfile';
import {
  cosmeticsOfKind,
  isEarnOnly,
  isEquipped,
  isOwned,
  type Cosmetic,
  type CosmeticKind,
  type Rarity,
} from '@boardwalk/game-logic';
import { useStore } from '@/system/store/useStore';

/**
 * The store — P2 of the progression overhaul, where it stops being flaccid. It sells three kinds
 * now, each with a live reader (the rule a cosmetic has to pass to exist): AVATARS (top bar +
 * profile card), CARD BACKS (every standard-deck game draws your equipped back), and TITLES (the
 * profile card, next to your name). Card backs are the flagship — a real reader, plenty of art on
 * disk, a full rarity ladder.
 *
 * Two P2 levers show here: RARITY (a flat tier label — pure status, no glow, drives nothing
 * functional) and the EARN-VS-BUY split (chips buy flair; the best titles are earn-only and render
 * LOCKED with "earn via X", because money cannot fake prestige — the grant lands in P3).
 *
 * Dog food, like every file outside `src/ui`: the kit and semantic tokens only. Gold is the price
 * and nothing else on this page; Buy is the lit primary blue (the action), Equip is a quiet tube
 * until you touch it, and the one you are wearing is cyan (= here).
 */

/** Rarity → its flat label colour token. Literal strings so Tailwind's scan generates each class. */
const RARITY_TEXT: Record<Rarity, string> = {
  common: 'text-rarity-common',
  rare: 'text-rarity-rare',
  epic: 'text-rarity-epic',
  legendary: 'text-rarity-legendary',
};

/** The three kinds, in the order the store stacks them, with the section copy for each. */
const SECTIONS: readonly { kind: CosmeticKind; title: string; blurb: string }[] = [
  { kind: 'cardback', title: 'Card Backs', blurb: 'The face-down art on every table you deal — Blackjack and Solitaire draw the one you equip.' },
  { kind: 'avatar', title: 'Avatars', blurb: 'Your face in the top bar and on your profile.' },
  { kind: 'title', title: 'Titles', blurb: 'A flex under your name. The best ones are earned, not bought.' },
];

/** The thing itself — an emoji, the card-back art, or the title text set in the display face. */
function Preview({ item }: { item: Cosmetic }) {
  if (item.kind === 'avatar') {
    return (
      <span className="text-5xl" aria-hidden>
        {item.emoji}
      </span>
    );
  }
  if (item.kind === 'cardback') {
    return (
      <img
        src={cardBackSrc(item.id)}
        alt={`${item.name} card back`}
        width={140}
        height={190}
        className="border-bw-line h-24 w-16 rounded-md border object-contain shadow-md"
      />
    );
  }
  // title
  return (
    <span className="font-display text-base-content flex h-24 items-center text-lg font-bold tracking-[0.12em] uppercase">
      {item.name}
    </span>
  );
}

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
  const earnOnly = isEarnOnly(item);
  const affordable = item.priceCents !== null && profile.bankrollCents >= item.priceCents;

  return (
    <Card className="flex flex-col items-center gap-3 p-5 text-center">
      <div className="flex min-h-24 items-center justify-center">
        <Preview item={item} />
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <span className="font-display text-base-content text-sm font-semibold tracking-[0.08em]">
          {item.name}
        </span>
        {/* Rarity — a flat tier label. Pure status: it colours a word, nothing functional. */}
        <span
          className={cx(
            'font-display text-[0.6rem] font-semibold tracking-[0.18em] uppercase',
            RARITY_TEXT[item.rarity]
          )}
        >
          {item.rarity}
        </span>
        {item.priceCents === 0 ? (
          <span className="text-bw-muted text-xs">Starter</span>
        ) : earnOnly ? (
          <span className="text-bw-muted text-xs">Earn only</span>
        ) : (
          <span data-money className="text-accent text-xs font-semibold">
            {formatDollars(item.priceCents ?? 0)}
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
      ) : earnOnly ? (
        // The earn-vs-buy split, made visible: no Buy button at any price, just how you unlock it.
        <span className="text-bw-muted max-w-40 text-xs leading-snug">
          🔒 {item.unlock ?? 'Earn it in play.'}
        </span>
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
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-base-content text-3xl font-bold tracking-[0.08em] uppercase">
          The Store
        </h1>
        <p className="text-bw-muted max-w-2xl text-sm">
          Spend your bankroll on flair — card backs your games actually deal, avatars, and titles.
          The rarest titles you cannot buy: you earn them.
        </p>
      </header>

      {SECTIONS.map((section) => {
        const items = cosmeticsOfKind(section.kind);
        if (items.length === 0) return null;
        return (
          <section key={section.kind} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-base-content text-xl font-semibold tracking-[0.08em] uppercase">
                {section.title}
              </h2>
              <p className="text-bw-muted max-w-2xl text-xs">{section.blurb}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {items.map((item) => (
                <CosmeticCard key={item.id} item={item} profile={profile} buy={buy} equip={equip} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
