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
import HoneyCoin from '@/components/hive/HoneyCoin';
import WealthCard from '@/components/hive/WealthCard';
import WishJar from '@/components/hive/WishJar';
import SaverStreakCard from '@/components/hive/SaverStreakCard';
import HpValueCommentary from '@/components/hive/HpValueCommentary';
import TransactionRow from '@/components/hive/TransactionRow';
import RatePill from '@/components/hive/RatePill';
import KidSwitcher from '@/components/hive/KidSwitcher';
import PendingRequestBanner from '@/components/hive/PendingRequestBanner';
import PlanSummaryCard from '@/components/hive/PlanSummaryCard';
import { formatCash, honeyToCashCents } from '@/components/hive/format';

const ACTIONS = [
  { id: 'save',     icon: '🍯', label: 'Save',     desc: 'Convert HP → 🪙',     href: '/hive/convert'  },
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
  const { activeKidId, wallet, transactions, goals, config, weeklyEarningsCents, fxUsdToFamily } = useHive();
  // 🧞 Wish Jar — the kid's pinned wish (cash goals only; ring vs the Pot).
  const wish = goals.find((g) => g.pinned && g.status === 'active' && g.layer === 'cash');
  // 🐝 Bee Bonus chip — interest paid into the Pot in the last 7 days.
  const beeBonusCents = (() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return transactions
      .filter((t) => t.category === 'interest' && t.direction === 'in'
        && ((t.createdAt as any)?.toMillis?.() ?? 0) >= weekAgo)
      .reduce((s, t) => s + t.amount, 0);
  })();
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

      <div className="mb-3">
        <HoneyPotHero
          treasuryCents={wallet.treasuryCents || 0}
          honeyCoins={wallet.honeyCoins}
          housePoints={wallet.housePoints}
          minHpReserve={config.minHpReserve}
          cashCents={wallet.cashCents}
          weeklyEarningsCents={weeklyEarningsCents}
          cashEquivalentCents={cashEquivalent}
          currency={config.currency}
          isParent={profile?.role === 'parent'}
          beeBonusCents={beeBonusCents}
        />
      </div>

      {/* CASH UPGRADE — 💵 Cash card: real money in the kid's hand, the ONLY
          spendable pocket. Tapping opens the cash-filtered statement. */}
      <div className="mb-3 rounded-hive-lg p-5 border-2 border-[#BFE6CF] bg-gradient-to-br from-[#E6F7EE] to-[#F4FBF7]">
        <p className="text-[11px] font-bold uppercase tracking-[3px] text-hive-green">💵 Cash · in your hand</p>
        <Link href="/hive/statement?layer=cash" className="mt-1 flex items-center gap-2 no-underline text-inherit group">
          <span className="font-nunito font-black text-[32px] leading-none text-[#1E6B41] group-hover:opacity-90">
            {formatCash(wallet.cashCents, config.currency)}
          </span>
          <span className="text-hive-green font-black text-lg self-center">›</span>
        </Link>
        <p className="text-[12px] text-hive-muted font-bold mt-1.5">
          Real money you can spend. Get some from your Pot 👇
        </p>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-3">
        <Link
          href="/hive/withdraw"
          className="h-12 rounded-hive bg-hive-honey hover:bg-hive-honey-dk text-white font-nunito font-black text-[14px] flex items-center justify-center no-underline shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)] transition-colors"
        >
          🏧 Withdraw
        </Link>
        <Link
          href="/hive/cash-out"
          className="h-12 rounded-hive bg-hive-green hover:brightness-110 text-white font-nunito font-black text-[14px] flex items-center justify-center no-underline shadow-[0_8px_20px_-8px_rgba(63,175,108,0.5)] transition"
        >
          🛒 Spend
        </Link>
      </div>
      <p className="mb-5 text-center text-[11px] text-hive-muted font-bold">
        You can only spend what&apos;s in 💵 Cash
      </p>

      {wish && (
        <WishJar
          goal={wish}
          potCents={wallet.treasuryCents || 0}
          weeklyEarningsCents={weeklyEarningsCents}
          currency={config.currency}
        />
      )}

      <SaverStreakCard child={activeKid} />

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
          <span className="font-nunito font-extrabold text-hive-honey-dk">⭐ HP</span> → <span className="font-nunito font-extrabold text-hive-honey-dk inline-flex items-center gap-1"><HoneyCoin size={13} /> Coins</span> → <span className="font-nunito font-extrabold text-hive-honey-dk inline-flex items-center gap-1"><HoneyPotIcon size={15} /> Honey Pot</span> → <span className="font-nunito font-extrabold text-hive-green">💵 Cash</span>.{' '}
          Withdraw 🏧 to get real cash — then spend it, a grown-up says yes.{' '}
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
          {/* HIVE PR2 (F2) — "See all" now opens the 📜 Statement (the full
              ledger story), not the wallet balances page. */}
          <Link href="/hive/statement" className="text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
            See all · 📜 Statement →
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
