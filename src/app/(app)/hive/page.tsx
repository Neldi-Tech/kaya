'use client';

// Hive Home — the Honey Pot dashboard. Read-only in PR-Hive-A.2; the
// "Earn / Save / Goals / Insights" buttons link to placeholder routes
// until PR-Hive-B wires them up. Numbers come from HiveContext, which
// listens to Firestore in real time.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { subscribeToKidBusinesses, readBusinessConfig } from '@/lib/business';
import HoneyPotHero from '@/components/hive/HoneyPotHero';
import HoneyPotIcon from '@/components/hive/HoneyPotIcon';
import WealthCard from '@/components/hive/WealthCard';
import HpValueCommentary from '@/components/hive/HpValueCommentary';
import TransactionRow from '@/components/hive/TransactionRow';
import RatePill from '@/components/hive/RatePill';
import KidSwitcher from '@/components/hive/KidSwitcher';
import PendingRequestBanner from '@/components/hive/PendingRequestBanner';
import PlanSummaryCard from '@/components/hive/PlanSummaryCard';
import { honeyToCashCents } from '@/components/hive/format';

const ACTIONS = [
  { id: 'save',     icon: '🍯', label: 'Save',     desc: 'Convert HP → 🍯',     href: '/hive/convert'  },
  { id: 'spend',    icon: '🛒', label: 'Spend',    desc: 'Request a spend',     href: '/hive/cash-out' },
  { id: 'plan',     icon: '🗓️', label: 'Plan',     desc: 'Budget the month',    href: '/hive/plan'     },
  { id: 'goals',    icon: '🎯', label: 'Goals',    desc: 'Save toward',         href: '/hive/goals'    },
  { id: 'insights', icon: '📊', label: 'Insights', desc: 'How am I doing?',     href: '/hive/insights' },
  { id: 'guide',    icon: '📚', label: 'Guide',    desc: 'How it all works',    href: '/hive/guide'    },
];

export default function HiveHomePage() {
  const { profile } = useAuth();
  const { children, family } = useFamily();
  const wealthRounding = readBusinessConfig(family).displayRounding;
  const { activeKidId, wallet, transactions, config, weeklyEarningsCents, fxUsdToFamily } = useHive();
  const activeKid = children.find((c) => c.id === activeKidId);

  const cashEquivalent = honeyToCashCents(wallet.honeyCoins, config.honeyToCashRate, fxUsdToFamily ?? 1);
  const recent = transactions.slice(0, 5);

  // Sum the kid's business worth (inventory + assets) for the Wealth = A + B view.
  const [businessAssetsCents, setBusinessAssetsCents] = useState(0);
  useEffect(() => {
    if (!profile?.familyId || !activeKidId) { setBusinessAssetsCents(0); return; }
    return subscribeToKidBusinesses(profile.familyId, activeKidId, (bs) =>
      setBusinessAssetsCents(bs.reduce((s, b) => s + (b.stats?.worthCents || 0), 0)));
  }, [profile?.familyId, activeKidId]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">
          {activeKid ? `${activeKid.name}'s Hive` : 'Your Hive'}
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1 leading-tight flex items-center gap-2.5">
          The Honey Pot
          <HoneyPotIcon size={40} className="-mt-1 drop-shadow-[0_3px_8px_rgba(120,70,5,0.25)]" />
        </h1>
      </div>

      <KidSwitcher />

      <PendingRequestBanner />

      <div className="mb-5">
        <HoneyPotHero
          treasuryCents={wallet.treasuryCents || 0}
          honeyCoins={wallet.honeyCoins}
          housePoints={wallet.housePoints}
          minHpReserve={config.minHpReserve}
          cashCents={wallet.cashCents}
          weeklyEarningsCents={weeklyEarningsCents}
          cashEquivalentCents={cashEquivalent}
          currency={config.currency}
        />
      </div>

      <div className="mb-5">
        <WealthCard
          treasuryCents={wallet.treasuryCents || 0}
          honeyCoins={wallet.honeyCoins}
          housePoints={wallet.housePoints}
          cashCents={wallet.cashCents}
          businessAssetsCents={businessAssetsCents}
          hpToHoneyRate={config.hpToHoneyRate}
          honeyToCashRate={config.honeyToCashRate}
          currency={config.currency}
          fxUsdToFamily={fxUsdToFamily ?? 1}
          rounding={wealthRounding}
        />
      </div>

      {/* Quick commentary — the money ladder in one line. */}
      <div className="mb-4 text-center">
        <p className="text-[11px] text-hive-muted leading-relaxed">
          <span className="font-nunito font-extrabold text-hive-honey-dk">⭐ HP</span> → <span className="font-nunito font-extrabold text-hive-honey-dk">🪙 Coins</span> → <span className="font-nunito font-extrabold text-hive-honey-dk">🍯 Honey Pot</span>.{' '}
          You spend from your Pot — a grown-up says yes.{' '}
          <Link href="/hive/guide" className="font-nunito font-extrabold text-hive-honey-dk hover:underline whitespace-nowrap">Read the Guide →</Link>
        </p>
      </div>

      {/* Rate hint — reminds the kid what their family's rates are. */}
      <div className="mb-4 flex justify-center">
        <RatePill
          hpToHoneyRate={config.hpToHoneyRate}
          honeyToCashRate={config.honeyToCashRate}
          currency={config.currency}
          fxUsdToFamily={fxUsdToFamily}
          variant="both"
        />
      </div>

      {/* "What your HP is worth" — translates the abstract HP number into
          a concrete cash estimate at today's rates. Keeps points feeling
          valuable, not abstract. */}
      <HpValueCommentary
        housePoints={wallet.housePoints}
        hpToHoneyRate={config.hpToHoneyRate}
        honeyToCashRate={config.honeyToCashRate}
        minHpReserve={config.minHpReserve}
        fxUsdToFamily={fxUsdToFamily ?? 1}
        currency={config.currency}
      />

      {/* This-month spending plan summary (or "+ Set up a plan" prompt). */}
      <PlanSummaryCard />

      {/* Action grid — 6 items in a 2x3 layout. Guide sits last so kids
          who already know the system don't have to scan past it. */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {ACTIONS.map((a) => (
          <Link
            key={a.id}
            href={a.href}
            className="bg-hive-paper border border-hive-line rounded-hive p-4 flex flex-col gap-1 hover:border-hive-honey transition-colors no-underline text-inherit"
          >
            <span className="text-2xl leading-none">{a.icon === '🍯' ? <HoneyPotIcon size={26} /> : a.icon}</span>
            <span className="font-nunito font-extrabold text-[15px] mt-1">{a.label}</span>
            <span className="text-[11px] text-hive-muted">{a.desc}</span>
          </Link>
        ))}
      </div>

      {/* Recent activity */}
      <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 mb-6">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-nunito font-extrabold text-[14px]">Recent activity</h3>
          <Link href="/hive/wallet" className="text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
            See all →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-[12px] text-hive-muted py-6 text-center">
            No activity yet. Earn House Points and they&apos;ll start showing up here.
          </p>
        ) : (
          <div>
            {recent.map((t) => (
              <TransactionRow key={t.id} tx={t} currency={config.currency} showLayerBadge />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
