'use client';

// Kaya Business · Portfolio (kid screen 1). The hub: a kid's total worth,
// this-month profit headed to the Hive, and a card per business. Parents
// view any kid via the shared KidSwitcher and jump to the Family Console.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, HiveSplit, InvestmentHolding, MarketQuote,
  readBusinessConfig, subscribeToKidBusinesses,
  subscribeToInvestments, subscribeToMarketQuotes, holdingValueCents,
} from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import KidSwitcher from '@/components/hive/KidSwitcher';
import NetWorthHero from '@/components/business/NetWorthHero';
import BusinessCard from '@/components/business/BusinessCard';

export default function BusinessPortfolioPage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const { activeKidId, config, totalNetWorthCents, fxUsdToFamily } = useHive();
  const isParent = profile?.role === 'parent';

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [holdings, setHoldings] = useState<InvestmentHolding[]>([]);
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
  const [loading, setLoading] = useState(true);

  const familyId = profile?.familyId;
  useEffect(() => {
    if (!familyId || !activeKidId) { setBusinesses([]); setHoldings([]); setLoading(false); return; }
    setLoading(true);
    const u1 = subscribeToKidBusinesses(familyId, activeKidId, (b) => { setBusinesses(b); setLoading(false); });
    const u2 = subscribeToInvestments(familyId, activeKidId, setHoldings);
    return () => { u1(); u2(); };
  }, [familyId, activeKidId]);
  useEffect(() => subscribeToMarketQuotes(setQuotes), []);

  const fx = fxUsdToFamily ?? 1;
  const investedValue = useMemo(
    () => holdings.reduce((s, h) => s + holdingValueCents(h, quotes[h.symbol], fx), 0),
    [holdings, quotes, fx],
  );

  const activeKid = children.find((c) => c.id === activeKidId);
  const bizConfig = useMemo(() => readBusinessConfig(family), [family]);
  const split = bizConfig.defaultHiveSplit;

  const open = businesses.filter((b) => b.status !== 'closed');
  const businessWorth = open.reduce((s, b) => s + (b.stats?.worthCents ?? 0), 0);
  // Paid sales sweep their full amount into the Hive; that's "earnings". Profit
  // (revenue − costs) is the learning metric shown on each business dashboard.
  const monthEarnings = open.reduce((s, b) => s + (b.stats?.monthRevenueCents ?? 0), 0);

  const counts = useMemo(() => {
    const c = { active: 0, pilot: 0, paused: 0, closed: 0 };
    for (const b of businesses) {
      if (b.status === 'active') c.active++;
      else if (b.status === 'pilot' || b.status === 'idea') c.pilot++;
      else if (b.status === 'paused') c.paused++;
      else if (b.status === 'closed') c.closed++;
    }
    return c;
  }, [businesses]);

  const subParts: string[] = [];
  if (counts.active) subParts.push(`${counts.active} active`);
  if (counts.pilot) subParts.push(`${counts.pilot} pilot`);
  if (counts.paused) subParts.push(`${counts.paused} paused`);
  if (counts.closed) subParts.push(`${counts.closed} closed`);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">
            Kaya Business
          </p>
          <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1 leading-tight">
            {activeKid ? `${activeKid.name}'s businesses` : 'Businesses'}
          </h1>
          {subParts.length > 0 && (
            <p className="text-[13px] text-hive-muted mt-1">{subParts.join(' · ')}</p>
          )}
        </div>
        {isParent && (
          <Link href="/parent/business" className="shrink-0 text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline mt-1">
            Family console →
          </Link>
        )}
      </div>

      <KidSwitcher />

      {!activeKid ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-10 text-center mt-2">
          <div className="text-5xl mb-3">👶</div>
          <p className="font-nunito font-extrabold text-[15px]">No kid selected</p>
          <p className="text-hive-muted text-sm mt-1">Add a child to the family to start a business.</p>
        </div>
      ) : (
        <>
          <div className="mb-3">
            <NetWorthHero
              businessWorthCents={businessWorth}
              hiveWorthCents={totalNetWorthCents}
              investedCents={investedValue}
              businessCount={open.length}
              currency={config.currency}
            />
          </div>

          {/* What "your worth" means — kid-friendly, one card. */}
          <div className="bg-[#F4ECD8] border border-hive-honey/60 rounded-hive p-4 mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="font-nunito font-extrabold text-[14px]">👋 What is &ldquo;your worth&rdquo;?</h3>
              <span className="text-[10px] font-nunito font-black uppercase tracking-wider px-2 py-0.5 rounded-hive-pill bg-hive-navy text-hive-honey-soft">kid-friendly</span>
            </div>
            <p className="text-[13px] leading-relaxed text-hive-navy">
              Your worth is <b>everything you own</b> — your stock and tools, the money in your Hive,
              and any companies you&apos;ve invested in. The bigger it grows, the more <b>options</b> you
              have: to spend, save, give, or grow it more.
            </p>
          </div>

          {/* This-month earnings → Hive (paid sales sweep in full; split advisory). */}
          <div className="rounded-hive p-3.5 mb-4 flex items-center gap-3 bg-hive-navy text-hive-cream">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-honey-soft">
                This month earnings → Hive
              </div>
              <div className="font-nunito font-black text-[18px] mt-0.5">{formatCash(monthEarnings, config.currency)}</div>
              <div className="flex flex-wrap gap-1 mt-1.5 text-[11px] font-nunito font-bold">
                {(['spend', 'save', 'goal', 'invest'] as Array<keyof HiveSplit>).map((k) => (
                  <span key={k} className="px-2 py-0.5 rounded-hive-pill bg-[rgba(245,215,122,0.15)] text-hive-honey-soft capitalize">
                    {k} {split[k]}%
                  </span>
                ))}
              </div>
            </div>
            <div className="text-[30px] leading-none">🐝</div>
          </div>

          {loading ? (
            <p className="text-center text-hive-muted text-sm py-8">Loading…</p>
          ) : businesses.length === 0 ? (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center mb-4">
              <div className="text-5xl mb-3">🌱</div>
              <p className="font-nunito font-extrabold text-[16px]">No businesses yet</p>
              <p className="text-hive-muted text-sm mt-1 mb-4">
                A weekend lemonade stand, a cookie sale, eggs from the coop — every tiny venture becomes a
                real little company with books you can see.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 mb-4">
              {businesses.map((b) => (
                <BusinessCard key={b.id} business={b} currency={config.currency} />
              ))}
            </div>
          )}

          <Link
            href="/business/new"
            className="w-full flex items-center justify-center gap-2 h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] hover:brightness-110 active:scale-[0.99] transition no-underline"
          >
            ＋ Start a new business
          </Link>

          <div className="grid grid-cols-2 gap-2.5 mt-2.5">
            <Link
              href="/business/invest"
              className="flex items-center justify-center gap-2 h-11 rounded-hive bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[13px] hover:bg-hive-cream active:scale-[0.99] transition no-underline"
            >
              📈 Junior Investor
            </Link>
            <Link
              href="/business/projects"
              className="flex items-center justify-center gap-2 h-11 rounded-hive bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[13px] hover:bg-hive-cream active:scale-[0.99] transition no-underline"
            >
              🎨 Kids Projects
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
