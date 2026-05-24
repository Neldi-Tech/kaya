'use client';

// /hive/guide — kid-friendly explainer for the Honey Pot system.
//
// Three goals:
//   1. Demystify the three balances (HP / Honey / Cash) and how they
//      relate. Kids land here confused about why Honey ≠ HP and why
//      they can't cash out HP directly.
//   2. Make the family's *actual* rates concrete — pulls hpToHoneyRate,
//      honeyToCashRate, minHpReserve, minCashOut etc. live so every
//      example reflects the kid's real family settings.
//   3. State the safety rules clearly: only Honey converts to cash;
//      conversions need parent approval; an HP reserve floor (if set)
//      keeps a savings buffer.
//
// Tone: short sentences, ample emoji, ~6-12yo reading level. Long
// blocks of text get broken into stepped cards with a single idea each.
// All numbers come from HiveContext so a parent rate tweak is reflected
// the next time the kid opens the page.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';
import { useFamily } from '@/contexts/FamilyContext';
import { currencySymbol } from '@/lib/hive';
import BackButton from '@/components/ui/BackButton';
import HoneyCoin from '@/components/hive/HoneyCoin';
import { formatCashClean, formatHp, honeyToCashCents } from '@/components/hive/format';

export default function HiveGuidePage() {
  const { children } = useFamily();
  const { activeKidId, wallet, config, fxUsdToFamily } = useHive();
  const activeKid = children.find((c) => c.id === activeKidId);
  const fxRate = fxUsdToFamily ?? 1;

  // Concrete numbers: at the family's current rates, how much cash is
  // one Honey Coin worth in the kid's local currency? Drives the
  // "1 🍯 = TSh X" pill in the flow diagram so it's never abstract.
  const oneHoneyCents = honeyToCashCents(1, config.honeyToCashRate, fxRate);

  // Example HP for the flow diagram. Aim for at least 100 HP (a tangible
  // number a kid can picture earning over a week or two) AND at least 1
  // full Honey Coin's worth of conversion (so the example never floors
  // down to 0 🍯). At a 1-HP-per-Honey rate this becomes 100 HP → 100 🍯;
  // at a 100-HP-per-Honey rate it becomes 100 HP → 1 🍯.
  const exampleHp = Math.max(100, config.hpToHoneyRate);
  const exampleHoney = config.hpToHoneyRate > 0 ? Math.floor(exampleHp / config.hpToHoneyRate) : 0;
  const exampleCashCents = honeyToCashCents(exampleHoney, config.honeyToCashRate, fxRate);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-8">
      <div className="lg:hidden"><BackButton /></div>

      {/* Hero */}
      <div className="rounded-hive-lg p-6 mb-6 bg-gradient-to-br from-[#FFE9C2] via-hive-honey-soft to-hive-honey shadow-[0_24px_48px_-24px_rgba(243,156,47,0.55)] relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/30 blur-2xl pointer-events-none" />
        <div className="relative">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">
            {activeKid ? `${activeKid.name}'s Money Guide` : 'Money Guide'}
          </p>
          <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1 leading-tight">
            How your money works 🍯
          </h1>
          <p className="text-[13px] text-hive-ink/70 mt-2 leading-relaxed">
            A quick map of how points become real money. Read once — you&apos;ll know the whole system.
          </p>
        </div>
      </div>

      {/* The three things */}
      <h2 className="font-nunito font-black text-xl mb-3">The three kinds of money</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-7">
        <ThingCard
          icon="⭐"
          label="House Points"
          shortLabel="HP"
          tagline="How you EARN"
          desc="You get these for doing your routines and chores well. They build up every day."
          color="bg-gradient-to-br from-[#E5EBF3] to-[#F4F7FB] border-[#D5DEE9]"
        />
        <ThingCard
          icon={<HoneyCoin size={34} />}
          label="Honey Coins"
          shortLabel="HC"
          tagline="What you SAVE"
          desc="Each Honey Coin is a chunk of real money saved for you — they live in your Treasury Reserve. Save up for what you want."
          color="bg-gradient-to-br from-[#FFF3D9] to-hive-honey-soft border-hive-honey"
        />
        <ThingCard
          icon="💵"
          label="Cash"
          shortLabel={currencySymbol(config.currency)}
          tagline="What you SPEND"
          desc="Real money in your family's currency. Only Honey Coins turn into cash — never HP straight."
          color="bg-gradient-to-br from-[#E6F7EE] to-[#C9EBD7] border-[#8FD3AB]"
        />
      </div>

      {/* Flow diagram */}
      <h2 className="font-nunito font-black text-xl mb-3">The journey: HP → Honey Coins → Cash</h2>
      <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5 mb-7">
        <div className="flex items-center justify-between gap-2 text-center">
          <FlowStep emoji="⭐" label="HP" tone="hp" />
          <ArrowWithLabel label={`${config.hpToHoneyRate} HP = 1 coin`} />
          <FlowStep emoji={<HoneyCoin size={26} />} label="Coins" tone="honey" />
          <ArrowWithLabel label={`1 coin = ${formatCashClean(oneHoneyCents, config.currency)}`} />
          <FlowStep emoji="💵" label="Cash" tone="cash" />
        </div>
        <p className="text-[11px] text-hive-muted text-center mt-4 leading-relaxed">
          Today: <strong className="text-hive-ink">{formatHp(exampleHp)} HP</strong> →{' '}
          <strong className="text-hive-honey-dk">{exampleHoney} HC</strong> →{' '}
          <strong className="text-hive-green">{formatCashClean(exampleCashCents, config.currency)}</strong>{' '}
          in your wallet. Your coins wait safely in your Treasury Reserve 🍯 until then.
        </p>
      </div>

      {/* Earn HP */}
      <Section
        n={1}
        emoji="🌱"
        title="How you earn House Points"
        body={
          <>
            <p className="mb-2">
              Every morning and evening, a grown-up rates how you did on your routines —
              brushing teeth, making your bed, doing homework, all that. Each one earns HP:
            </p>
            <ul className="space-y-1 pl-1">
              <li>🌟 <strong>Excellent</strong> — full points</li>
              <li>👍 <strong>Good</strong> — half points</li>
              <li>👎 <strong>Bad</strong> — zero points (try again tomorrow!)</li>
            </ul>
            <p className="mt-3">
              You can also get <strong>bonus awards</strong> from parents for extra-helpful things,
              or earn from quests — anything that helps the family.
            </p>
          </>
        }
      />

      {/* HP → Honey */}
      <Section
        n={2}
        emoji="🍯"
        title="Turning HP into Honey Coins"
        body={
          <>
            <p className="mb-2">
              When you have enough HP, you can <strong>save</strong> them as Honey Coins.
              In your family, the rate is:
            </p>
            <div className="bg-hive-cream border border-hive-line rounded-hive p-3 my-2 text-center">
              <p className="font-nunito font-black text-lg">
                {config.hpToHoneyRate} HP = 1 Honey Coin
              </p>
            </div>
            {config.minHpReserve > 0 && (
              <div className="bg-hive-rose/10 border border-hive-rose/30 rounded-hive p-3 my-3">
                <p className="font-nunito font-extrabold text-[13px] text-hive-rose leading-snug">
                  🛟 Reserve rule
                </p>
                <p className="text-[12px] text-hive-ink/80 mt-1 leading-relaxed">
                  Your family keeps a safety floor of <strong>{formatHp(config.minHpReserve)} HP</strong> in
                  your pot at all times. You can only convert HP that&apos;s <em>above</em> that line.
                  It&apos;s like a piggy bank emergency fund — keeps you from spending everything in one go.
                </p>
              </div>
            )}
            <p className="mt-2">
              <strong>Tap Save</strong> on your Treasury Reserve, pick how many HP to convert,
              and your parent approves. Done — those HP become Honey Coins, saved in your Treasury Reserve (the Honey Pot 🍯).
            </p>
          </>
        }
      />

      {/* Honey → Cash */}
      <Section
        n={3}
        emoji="💵"
        title="Turning Honey into real cash"
        body={
          <>
            <p className="mb-2">
              <strong>Honey is the only thing that becomes cash.</strong> HP can&apos;t be
              cashed out directly — you have to save it as Honey first.
            </p>
            <div className="bg-hive-cream border border-hive-line rounded-hive p-3 my-2 text-center">
              <p className="font-nunito font-black text-lg">
                1 Honey Coin = {formatCashClean(oneHoneyCents, config.currency)}
              </p>
              <p className="text-[11px] text-hive-muted mt-1">
                in {config.currency}, at today&apos;s rate
              </p>
            </div>
            {config.minCashOut > 0 && (
              <p className="mt-2">
                <strong>Minimum cash-out:</strong> {config.minCashOut} Honey Coins. Saves you from
                cashing out tiny amounts.
              </p>
            )}
            <p className="mt-2">
              <strong>Tap Spend</strong> on your Treasury Reserve, pick the amount,
              parent approves, and the cash lands in your wallet.
            </p>
          </>
        }
      />

      {/* Approvals */}
      <Section
        n={4}
        emoji="🛡️"
        title="Why parents approve"
        body={
          <>
            <p>
              Both saves (HP → coins) and cash-outs (coins → cash) need a parent tap. Two reasons:
            </p>
            <ul className="space-y-1 mt-2 pl-1">
              <li>✅ It&apos;s a quick sanity check — &quot;sure, that&apos;s a fair trade.&quot;</li>
              <li>✅ The cash actually has to come from somewhere — usually parents deposit
                  it into your Hive ahead of time.</li>
            </ul>
            <p className="mt-3">
              You&apos;ll see pending requests on your Wallet page. Usually approved within a day.
            </p>
          </>
        }
      />

      {/* Tips */}
      <h2 className="font-nunito font-black text-xl mb-3 mt-7">Smart money tips</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
        <TipCard emoji="💼" title="Business money" body="If you run a Kaya business, your sales land right in your Treasury Reserve — ready to cash out." />
        <TipCard emoji="🎯" title="Set a goal" body="Picking something to save toward (a toy, a trip) makes the wait easier. Use Goals to track it." />
        <TipCard emoji="🗓️" title="Plan your month" body="Decide ahead what you'll save vs. spend on snacks vs. give. Use Plan." />
        <TipCard emoji="📊" title="Check your streaks" body="Insights shows how steady your earning is. Steady > big spikes." />
        <TipCard emoji="🤝" title="Ask first" body="If you want a big spend, talk to a parent before submitting — saves an awkward decline." />
      </div>

      {/* Back link */}
      <div className="text-center pt-2">
        <Link
          href="/hive"
          className="inline-flex items-center gap-2 h-12 px-6 bg-hive-honey hover:bg-hive-honey-dk text-white rounded-hive-pill font-nunito font-black text-sm no-underline shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)] transition-colors"
        >
          ← Back to my Treasury Reserve
        </Link>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function ThingCard({
  icon, label, tagline, desc, color,
}: { icon: ReactNode; label: string; shortLabel: ReactNode; tagline: string; desc: string; color: string }) {
  return (
    <div className={`rounded-hive border p-4 ${color}`}>
      <p className="text-3xl leading-none flex items-center">{icon}</p>
      <p className="font-nunito font-black text-[15px] mt-2">{label}</p>
      <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-honey-dk mt-0.5">{tagline}</p>
      <p className="text-[12px] text-hive-ink/80 mt-2 leading-relaxed">{desc}</p>
    </div>
  );
}

function FlowStep({ emoji, label, tone }: { emoji: ReactNode; label: string; tone: 'hp' | 'honey' | 'cash' }) {
  const bg = tone === 'hp'
    ? 'bg-[#F4F7FB] border-[#D5DEE9]'
    : tone === 'honey'
      ? 'bg-hive-honey-soft border-hive-honey'
      : 'bg-[#E6F7EE] border-[#8FD3AB]';
  return (
    <div className={`flex-shrink-0 w-16 h-20 rounded-hive border flex flex-col items-center justify-center gap-1 ${bg}`}>
      <span className="text-2xl leading-none flex items-center justify-center">{emoji}</span>
      <span className="font-nunito font-black text-[11px]">{label}</span>
    </div>
  );
}

function ArrowWithLabel({ label }: { label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center min-w-0 px-1">
      <span className="text-hive-honey-dk text-lg leading-none">→</span>
      <span className="text-[10px] font-nunito font-extrabold text-hive-muted mt-1 text-center leading-tight">{label}</span>
    </div>
  );
}

function Section({
  n, emoji, title, body,
}: { n: number; emoji: string; title: string; body: React.ReactNode }) {
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-hive-honey-soft border border-hive-honey/40 flex items-center justify-center font-nunito font-black text-[14px] text-hive-honey-dk">
          {n}
        </div>
        <h3 className="font-nunito font-black text-lg flex items-center gap-2">
          <span>{emoji}</span>
          <span>{title}</span>
        </h3>
      </div>
      <div className="text-[13px] text-hive-ink/85 leading-relaxed">{body}</div>
    </div>
  );
}

function TipCard({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
      <p className="text-2xl leading-none">{emoji}</p>
      <p className="font-nunito font-black text-[14px] mt-2">{title}</p>
      <p className="text-[12px] text-hive-ink/75 mt-1 leading-relaxed">{body}</p>
    </div>
  );
}
