'use client';

// /pulse/analytics — Kaya Pulse · Savings Analytics (parent-only).
//
// Everything on this page anchors on TWO numbers so the cards always reconcile:
//   • your BUDGET   = household caps (all 7 purchase buckets) + fixed monthly
//                     commitments (Subscriptions + Contributions)
//   • your TARGET   = pulsePlan.targetSavingsCents — always the user's own
//                     number, never hard-coded.
//
// Layout (approved mock):
//   1. Money at a glance (full household budget) + what-if slider
//   2. Per-category budget vs save — ALL categories. Savings only spread across
//      DISCRETIONARY buckets; Payroll / Subscriptions / Contributions are fixed
//      (0 save) because you can't "cut" a commitment.
//   3. Savings vs plan (target line labelled) + spend vs budget + compares
//   4. Kaya Wealth projection (compounds your monthly target)
//   5. Ask Kaya advisor · per-bucket pacing
//
// Savings come only from the discretionary purchase budget, so the historical
// trend stays on the purchase snapshots; the fixed lines lift the budget total
// but contribute 0 to savings.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import {
  type PurchaseRequest, type PurchaseModule,
  subscribeToRecentRequests, MODULE_EMOJI, MODULE_LABEL,
} from '@/lib/purchase';
import { PulseHeader } from '@/components/pulse/ui';
import AskKaya from '@/components/pulse/AskKaya';
import {
  type BudgetSnapshot, resolvePlan,
  subscribeBudgetSnapshots, ensureBudgetSnapshot,
} from '@/lib/pulse';
import { type Subscription, subscribeToSubscriptions } from '@/lib/subscriptions';
import { type Contribution, subscribeToContributions } from '@/lib/contributions';

// All 7 purchase buckets (Payroll included now). Savings can only come from the
// discretionary ones — Payroll is a fixed commitment, like Subs / Contributions.
const PURCHASE_MODULES: PurchaseModule[] = ['pantry', 'outdoor', 'drivers', 'utility', 'payroll', 'dineOut', 'home'];
const DISCRETIONARY: PurchaseModule[] = ['pantry', 'outdoor', 'drivers', 'utility', 'dineOut', 'home'];
const isDiscretionary = (m: PurchaseModule) => DISCRETIONARY.includes(m);

const monthKeyOf = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date = new Date()) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const monthShort = (mk: string): string => {
  const [y, m] = mk.split('-').map(Number);
  return y && m ? new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' }) : mk;
};
const spendOf = (r: PurchaseRequest) => r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
const compactMajor = (cents: number): string => {
  const v = Math.round(cents / 100);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
};

interface BudgetRow { key: string; emoji: string; label: string; budget: number; save: number; fixed: boolean }

export default function PulseAnalyticsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const thisMonth = monthKeyOf();

  useEffect(() => {
    if (profile && profile.role !== 'parent') router.replace('/pulse');
  }, [profile, router]);

  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>([]);
  const [snapsLoaded, setSnapsLoaded] = useState(false);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [contribs, setContribs] = useState<Contribution[]>([]);
  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    const u1 = subscribeToRecentRequests(profile.familyId, setRecent);
    const u2 = subscribeBudgetSnapshots(profile.familyId, (s) => { setSnapshots(s); setSnapsLoaded(true); });
    const u3 = subscribeToSubscriptions(profile.familyId, setSubs);
    const u4 = subscribeToContributions(profile.familyId, setContribs);
    return () => { u1(); u2(); u3(); u4(); };
  }, [profile?.familyId, profile?.role]);

  const snapByMonth = useMemo(() => {
    const m: Record<string, BudgetSnapshot> = {};
    for (const s of snapshots) m[s.monthKey] = s;
    return m;
  }, [snapshots]);

  const plan = family?.pulsePlan;
  const caps = useMemo(() => (family?.householdBudgets ?? {}) as Record<string, number | undefined>, [family?.householdBudgets]);

  // ── Fixed monthly commitments — folded into the budget, never "saved". ──
  const subMonthly = useMemo(
    () => subs.reduce((s, x) => s + ((x.status === 'active' || x.status === 'trial') ? (x.monthlyEquivalent || 0) : 0), 0),
    [subs],
  );
  const contribMonthly = useMemo(
    () => contribs.reduce((s, c) => s + (c.frequency === 'one_off' ? 0 : (c.monthlyEquivalent || 0)), 0),
    [contribs],
  );
  const fixedMonthly = subMonthly + contribMonthly;

  // ── The real budget: per-module caps → purchase total → + fixed = total. ──
  const capByModule = useMemo(() => {
    const out: Partial<Record<PurchaseModule, number>> = {};
    for (const m of PURCHASE_MODULES) out[m] = caps[m] ?? 0;
    return out;
  }, [caps]);
  const purchaseCap = useMemo(() => PURCHASE_MODULES.reduce((s, m) => s + (capByModule[m] ?? 0), 0), [capByModule]);
  const discretionaryCap = useMemo(() => DISCRETIONARY.reduce((s, m) => s + (capByModule[m] ?? 0), 0), [capByModule]);
  const totalBudget = purchaseCap + fixedMonthly;

  // ── The save target ALWAYS comes from the user's plan (never hard-coded). ──
  const resolved = useMemo(() => (plan ? resolvePlan(plan, capByModule) : null), [plan, capByModule]);
  const saveTarget = plan ? (plan.targetSavingsCents || resolved?.targetSavingsCents || 0) : 0;
  const keepBudget = Math.max(0, totalBudget - saveTarget);

  // ── Per-category budget vs save (all categories). ──
  const budgetRows = useMemo<BudgetRow[]>(() => {
    const rows: BudgetRow[] = [];
    for (const m of PURCHASE_MODULES) {
      const budget = capByModule[m] ?? 0;
      if (budget <= 0) continue;
      const save = isDiscretionary(m) && discretionaryCap > 0
        ? Math.min(budget, Math.round((budget / discretionaryCap) * saveTarget))
        : 0;
      rows.push({ key: m, emoji: MODULE_EMOJI[m], label: MODULE_LABEL[m], budget, save, fixed: !isDiscretionary(m) });
    }
    if (subMonthly > 0) rows.push({ key: '__subs', emoji: '🔄', label: 'Subscriptions', budget: subMonthly, save: 0, fixed: true });
    if (contribMonthly > 0) rows.push({ key: '__contribs', emoji: '🎁', label: 'Contributions', budget: contribMonthly, save: 0, fixed: true });
    return rows;
  }, [capByModule, discretionaryCap, saveTarget, subMonthly, contribMonthly]);

  // ── Completed-month savings history (frozen snapshot, else live caps − spend). ──
  const savings = useMemo(() => {
    const spend: Record<string, Partial<Record<PurchaseModule, number>>> = {};
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      const at = r.closedAt?.toDate?.();
      if (!at) continue;
      const mk = monthKeyOf(at);
      if (mk === thisMonth) continue;
      const m = (r.module ?? 'pantry') as PurchaseModule;
      (spend[mk] ||= {})[m] = (spend[mk]![m] ?? 0) + spendOf(r);
    }
    const months = Array.from(new Set([...Object.keys(spend), ...Object.keys(snapByMonth)]))
      .sort((a, b) => b.localeCompare(a)).slice(0, 6);
    const curTarget = saveTarget;

    const monthly = months.map((mk) => {
      const snap = snapByMonth[mk];
      if (snap) return { mk, spent: snap.totalSpentCents, saved: snap.savingsCents, cap: snap.totalCapCents || purchaseCap, target: snap.planTargetCents ?? curTarget };
      let spent = 0, saved = 0;
      for (const m of PURCHASE_MODULES) { const sp = spend[mk]?.[m] ?? 0; spent += sp; saved += Math.max(0, (capByModule[m] ?? 0) - sp); }
      return { mk, spent, saved, cap: purchaseCap, target: curTarget };
    });

    const byModule = PURCHASE_MODULES.map((m) => {
      const cap = capByModule[m] ?? 0;
      const perMonth = months.map((mk) => {
        const pm = snapByMonth[mk]?.perModule?.[m];
        if (pm) return { mk, spent: pm.spentCents, saved: Math.max(0, pm.capCents - pm.spentCents) };
        const sp = spend[mk]?.[m] ?? 0;
        return { mk, spent: sp, saved: Math.max(0, cap - sp) };
      });
      return { m, cap, totalSaved: perMonth.reduce((s, x) => s + x.saved, 0), totalSpent: perMonth.reduce((s, x) => s + x.spent, 0), perMonth };
    }).filter((x) => x.cap > 0 || x.totalSpent > 0).sort((a, b) => b.totalSaved - a.totalSaved);

    const toBackfill = Object.keys(spend).filter((mk) => !snapByMonth[mk]).map((mk) => {
      const perModule: BudgetSnapshot['perModule'] = {};
      let totalSpentCents = 0, totalCapCents = 0, savingsCents = 0;
      for (const m of PURCHASE_MODULES) {
        const sp = spend[mk]?.[m] ?? 0;
        const cap = capByModule[m] ?? 0;
        if (sp === 0 && cap === 0) continue;
        perModule[m] = { spentCents: sp, capCents: cap, deltaPct: cap > 0 ? Math.round(((sp - cap) / cap) * 100) : 0 };
        totalSpentCents += sp; totalCapCents += cap; savingsCents += Math.max(0, cap - sp);
      }
      return { monthKey: mk, totalSpentCents, totalCapCents, perModule, savingsCents, planTargetCents: curTarget, finalized: true } as Omit<BudgetSnapshot, 'id' | 'finalizedAt'>;
    });

    return { monthly, byModule, toBackfill };
  }, [recent, thisMonth, capByModule, purchaseCap, snapByMonth, saveTarget]);

  const wealthBalanceCents = useMemo(() => snapshots.reduce((s, x) => s + (x.savingsCents ?? 0), 0), [snapshots]);

  // Freeze completed months (idempotent) so analytics works even if the parent
  // never opens the Savings plan page.
  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent' || !snapsLoaded) return;
    for (const payload of savings.toBackfill) void ensureBudgetSnapshot(profile.familyId, payload).catch(() => {});
  }, [savings.toBackfill, snapsLoaded, profile?.familyId, profile?.role]);

  // ── Compare-card aggregates. ──
  const compare = useMemo(() => {
    const withTarget = savings.monthly.filter((d) => d.target > 0);
    const avgSaved = withTarget.length ? withTarget.reduce((s, d) => s + d.saved, 0) / withTarget.length : 0;
    const avgTarget = withTarget.length ? withTarget.reduce((s, d) => s + d.target, 0) / withTarget.length : 0;
    const savingsVsPlanPct = avgTarget > 0 ? Math.round(((avgSaved - avgTarget) / avgTarget) * 100) : 0;
    const withCap = savings.monthly.filter((d) => d.cap > 0);
    const avgSpent = withCap.length ? withCap.reduce((s, d) => s + d.spent, 0) / withCap.length : 0;
    const avgCap = withCap.length ? withCap.reduce((s, d) => s + d.cap, 0) / withCap.length : 0;
    const budgetOver = avgSpent > avgCap + 1; // cents tolerance
    const budgetPctAbs = avgCap > 0 ? Math.max(budgetOver ? 1 : 0, Math.round((Math.abs(avgCap - avgSpent) / avgCap) * 100)) : 0;
    return { savingsVsPlanPct, avgSaved, avgTarget, budgetOver, budgetPctAbs, avgSpent, avgCap, hasTarget: withTarget.length > 0, hasCap: withCap.length > 0 };
  }, [savings.monthly]);

  const askFacts = useMemo(() => {
    const f: Record<string, string | number> = {
      'Monthly save target': saveTarget > 0 ? formatCents(saveTarget, currency) : 'not set',
      'Monthly budget': formatCents(totalBudget, currency),
      'Fixed commitments': formatCents(fixedMonthly, currency),
      'Wealth saved to date': formatCents(wealthBalanceCents, currency),
    };
    if (compare.hasTarget) f['Savings vs plan'] = `${compare.savingsVsPlanPct >= 0 ? '+' : ''}${compare.savingsVsPlanPct}%`;
    if (compare.hasCap) f['Spend vs budget'] = `${compare.budgetPctAbs}% ${compare.budgetOver ? 'over' : 'under'}`;
    return f;
  }, [saveTarget, totalBudget, fixedMonthly, wealthBalanceCents, compare, currency]);

  if (profile && profile.role !== 'parent') {
    return <div className="mx-auto max-w-md px-4 pt-16 text-center text-hive-muted text-sm">Redirecting…</div>;
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <PulseHeader back={{ href: '/pulse', label: 'Dashboard' }} eyebrow="Savings analytics" title="Savings Analytics" subtitle="How your savings track against your plan + your budget — and what they become." />

      {!plan && (
        <div className="mt-4 bg-white border border-pulse-gold/40 rounded-2xl p-5 text-center">
          <div className="text-3xl mb-1">📈</div>
          <div className="font-nunito font-black text-pulse-navy text-[15px]">Set a savings plan to unlock analytics</div>
          <p className="text-[12px] text-hive-muted mt-1">Choose a monthly target and Kaya fills this page with your trends + projections.</p>
          <Link href="/pulse/plan" className="inline-block mt-3 bg-pulse-gold text-pulse-navy rounded-xl px-5 py-2 font-nunito font-black text-[13px] no-underline">Set a plan →</Link>
        </div>
      )}

      {/* 1 · Set the target against what you have */}
      {plan && (
        <>
          <MoneyAtGlance totalBudget={totalBudget} keepCents={keepBudget} saveCents={saveTarget} fixedCents={fixedMonthly} currency={currency} />
          <WhatIf totalBudget={totalBudget} initialTarget={saveTarget} currency={currency} />
          <BudgetVsSave rows={budgetRows} currency={currency} />
        </>
      )}

      {/* 2 · Savings vs plan + spend vs budget + compares */}
      <SavingsTrend monthly={savings.monthly} currency={currency} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <SpendVsBudget monthly={savings.monthly} pctAbs={compare.budgetPctAbs} over={compare.budgetOver} hasCap={compare.hasCap} />
        <div className="flex flex-col gap-3">
          {compare.hasTarget && <CompareCard title="Savings vs plan" big={`${compare.savingsVsPlanPct >= 0 ? '+' : ''}${compare.savingsVsPlanPct}%`} good={compare.savingsVsPlanPct >= 0} pill={compare.savingsVsPlanPct >= 0 ? 'ahead of target' : 'behind target'} note={`avg saved ${formatCentsBudgetNeat(compare.avgSaved, currency)} vs ${formatCentsBudgetNeat(compare.avgTarget, currency)} plan`} />}
          {compare.hasCap && <CompareCard title="Spend vs budget" big={`${compare.budgetPctAbs}% ${compare.budgetOver ? 'over' : 'under'}`} good={!compare.budgetOver} pill={compare.budgetOver ? 'over budget' : 'on track'} note={`used ${formatCentsBudgetNeat(compare.avgSpent, currency)} of ${formatCentsBudgetNeat(compare.avgCap, currency)} cap`} />}
        </div>
      </div>

      {/* 3 · Kaya Wealth projection */}
      <WealthProjection monthlyCents={saveTarget} currency={currency} />

      {/* Ask Kaya · per-bucket pacing */}
      {profile?.familyId && (
        <div className="mt-6">
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">Ask Kaya · savings advisor</div>
          <AskKaya familyId={profile.familyId} monthKey={thisMonth} monthLabel={monthLabel()} currency={currency} facts={askFacts} />
        </div>
      )}
      <PerBucketPacing rows={savings.byModule} currency={currency} />

      {wealthBalanceCents > 0 && (
        <div className="mt-5 bg-pulse-navy text-pulse-gold rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[1px] font-black opacity-85">💰 Wealth saved to date</div>
            <div className="text-2xl font-nunito font-black mt-0.5">{formatCentsBudgetNeat(wealthBalanceCents, currency)}</div>
          </div>
          <div className="text-[11px] font-bold opacity-85 text-right leading-tight">{snapshots.length} month{snapshots.length === 1 ? '' : 's'}<br />frozen</div>
        </div>
      )}
    </div>
  );
}

/* 1 · Money at a glance — full household budget split into keep vs save. */
function MoneyAtGlance({ totalBudget, keepCents, saveCents, fixedCents, currency }: { totalBudget: number; keepCents: number; saveCents: number; fixedCents: number; currency: string }) {
  const tot = Math.max(1, totalBudget);
  const savePct = Math.min(100, Math.round((saveCents / tot) * 100));
  const keepPct = Math.max(0, 100 - savePct);
  return (
    <div className="mt-4 bg-white border border-pulse-gold/40 rounded-2xl p-4">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-1">Your money at a glance</div>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] text-hive-muted font-bold">Monthly budget</span>
        <span className="text-[18px] font-nunito font-black text-pulse-navy">{formatCentsBudgetNeat(totalBudget, currency)}</span>
      </div>
      <div className="h-7 rounded-lg overflow-hidden flex mt-2 border border-pulse-gold/30">
        <div className="h-full bg-pulse-gold flex items-center justify-center text-[10px] font-black text-pulse-navy" style={{ width: `${keepPct}%` }}>{keepPct >= 18 ? `Keep ${compactMajor(keepCents)}` : ''}</div>
        <div className="h-full bg-pulse-green flex items-center justify-center text-[10px] font-black text-white" style={{ width: `${savePct}%` }}>{savePct >= 18 ? `Save ${compactMajor(saveCents)}` : ''}</div>
      </div>
      <div className="flex justify-between mt-3">
        <div><div className="text-[10px] text-hive-muted font-bold">You want to save</div><div className="text-[15px] font-nunito font-black text-pulse-green">{formatCentsBudgetNeat(saveCents, currency)}/mo</div></div>
        <div className="text-right"><div className="text-[10px] text-hive-muted font-bold">That&apos;s a cut of</div><div className="text-[15px] font-nunito font-black text-pulse-navy">{savePct}%</div></div>
      </div>
      {fixedCents > 0 && (
        <div className="text-[10px] text-hive-muted font-bold mt-2 pt-2 border-t border-pulse-gold/15">Budget includes {formatCentsBudgetNeat(fixedCents, currency)}/mo of fixed commitments (subscriptions + contributions).</div>
      )}
    </div>
  );
}

/* 1b · What if you save more — explore a target; % + leftover live. */
function WhatIf({ totalBudget, initialTarget, currency }: { totalBudget: number; initialTarget: number; currency: string }) {
  const maxT = Math.max(1, totalBudget);
  const [target, setTarget] = useState(Math.min(initialTarget || Math.round(maxT * 0.25), maxT));
  const cutPct = Math.round((target / maxT) * 100);
  const leftover = Math.max(0, totalBudget - target);
  return (
    <div className="mt-3 bg-white border border-pulse-gold/40 rounded-2xl p-4">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-1">What if you save more?</div>
      <p className="text-[11px] text-hive-muted font-bold mb-2">Slide to explore — see the cut + what&apos;s left to spend.</p>
      <input type="range" min={0} max={maxT} step={Math.max(1, Math.round(maxT / 100))} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-full accent-pulse-gold" />
      <div className="flex justify-between text-[10px] text-hive-muted font-bold"><span>{formatCentsBudgetNeat(0, currency)}</span><span>{formatCentsBudgetNeat(maxT, currency)}</span></div>
      <div className="bg-pulse-cream rounded-xl p-3 mt-2 flex flex-col gap-1.5">
        <div className="flex justify-between text-[12px]"><span className="text-hive-muted font-bold">Save target</span><span className="font-nunito font-black text-pulse-navy">{formatCentsBudgetNeat(target, currency)}/mo</span></div>
        <div className="flex justify-between text-[12px]"><span className="text-hive-muted font-bold">= cut from budget</span><span className="font-nunito font-black text-pulse-navy">{cutPct}%</span></div>
        <div className="flex justify-between text-[12px] pt-1.5 border-t border-pulse-gold/20"><span className="text-hive-muted font-bold">Left to spend</span><span className="font-nunito font-black text-pulse-green">{formatCentsBudgetNeat(leftover, currency)}</span></div>
      </div>
      <Link href="/pulse/plan" className="block text-center text-[11px] font-nunito font-black text-pulse-gold-dk mt-2 no-underline">Set this as your plan →</Link>
    </div>
  );
}

/* 1c · Per category · budget vs save. Save spreads across discretionary buckets
   only; fixed lines (Payroll / Subscriptions / Contributions) carry a tag. */
function BudgetVsSave({ rows, currency }: { rows: BudgetRow[]; currency: string }) {
  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">Per category · budget vs save</div>
        <div className="bg-white border border-pulse-gold/40 rounded-2xl p-4 text-center text-[12px] text-hive-muted italic">Set budget caps + a savings target to see each bucket&apos;s budget-vs-save split.</div>
      </div>
    );
  }
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const totalSave = rows.reduce((s, r) => s + r.save, 0);
  const renderRow = (key: string, emoji: string, label: string, budget: number, save: number, opts: { bold?: boolean; fixed?: boolean }) => {
    const tot = Math.max(1, budget);
    const savePct = Math.min(100, Math.round((save / tot) * 100));
    const keepPct = Math.max(0, 100 - savePct);
    return (
      <div key={key} className={`grid grid-cols-2 gap-x-3 gap-y-1.5 items-center py-2 ${opts.bold ? 'border-t-2 border-pulse-navy/30 mt-1' : 'border-t border-pulse-gold/15'}`}>
        <div className="min-w-0">
          <div className="text-[12.5px] font-nunito font-black text-pulse-navy truncate">{emoji} {label}{opts.fixed && <span className="ml-1.5 text-[8.5px] font-extrabold uppercase tracking-wide text-hive-muted bg-pulse-cream rounded px-1 py-0.5 align-middle">fixed</span>}</div>
          <div className="text-[10px] text-hive-muted font-bold">budget {formatCents(budget, currency)}</div>
        </div>
        <div className="text-right">
          <div className={`text-[12.5px] font-nunito font-black ${save > 0 ? 'text-pulse-green' : 'text-hive-muted'}`}>save {formatCents(save, currency)}</div>
          <div className="text-[10px] text-hive-muted font-bold">{savePct}% of bucket</div>
        </div>
        <div className="col-span-2 h-2.5 rounded-full bg-pulse-cream overflow-hidden flex">
          <div className="h-full bg-pulse-gold" style={{ width: `${keepPct}%` }} />
          <div className="h-full bg-pulse-green" style={{ width: `${savePct}%` }} />
        </div>
      </div>
    );
  };
  return (
    <div className="mt-4">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">Per category · budget vs save</div>
      <div className="bg-white border border-pulse-gold/40 rounded-2xl p-4">
        {rows.map((r) => renderRow(r.key, r.emoji, r.label, r.budget, r.save, { fixed: r.fixed }))}
        {renderRow('__total', '∑', 'Total', totalBudget, totalSave, { bold: true })}
        <div className="flex gap-4 mt-3 pt-2 border-t border-pulse-gold/15">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-hive-muted"><i className="inline-block w-3 h-2 rounded-sm bg-pulse-gold"></i> Keep (budget)</span>
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-hive-muted"><i className="inline-block w-3 h-2 rounded-sm bg-pulse-green"></i> Save → Wealth</span>
        </div>
      </div>
    </div>
  );
}

interface MonthRow { mk: string; spent: number; saved: number; cap: number; target: number }

/* 2 · Savings vs plan — actual bars vs the monthly (varying) target line. */
function SavingsTrend({ monthly, currency }: { monthly: MonthRow[]; currency: string }) {
  if (monthly.length === 0) {
    return (
      <div className="mt-6">
        <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">📈 Savings vs your plan</div>
        <div className="bg-white border border-pulse-gold/40 rounded-2xl p-5 text-center text-[12px] text-hive-muted italic">Your trend builds as months close.</div>
      </div>
    );
  }
  const data = [...monthly].reverse();
  const H = 84;
  const max = Math.max(1, ...data.flatMap((d) => [d.saved, d.target]));
  const total = monthly.reduce((s, d) => s + d.saved, 0);
  const plannedTotal = monthly.reduce((s, d) => s + d.target, 0);
  const withTarget = data.filter((d) => d.target > 0);
  const metOrBeat = withTarget.filter((d) => d.saved >= d.target).length;
  const lastIdx = data.length - 1;
  return (
    <div className="mt-6">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">📈 Savings vs your plan</div>
      <div className="bg-white border border-pulse-gold/40 rounded-2xl p-4">
        <div className="flex items-end gap-1.5 sm:gap-2" style={{ height: H + 52 }}>
          {data.map((d, i) => {
            const barH = Math.max(4, Math.round((d.saved / max) * H));
            const tgtH = d.target > 0 ? Math.round((d.target / max) * H) : 0;
            const beat = d.target > 0 && d.saved >= d.target;
            return (
              <div key={d.mk} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
                <div className={`text-[9px] font-nunito font-black ${beat ? 'text-pulse-green' : 'text-pulse-navy'}`}>{compactMajor(d.saved)}</div>
                <div className="relative w-full" style={{ height: H }}>
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[72%] rounded-t-md bg-pulse-gold" style={{ height: barH }} />
                  {tgtH > 0 && (
                    <>
                      <div className="absolute left-0 right-0 border-t-2 border-dashed border-pulse-navy/70" style={{ bottom: tgtH }} />
                      {i === lastIdx && (
                        <div className="absolute right-0 text-[8.5px] font-nunito font-black text-pulse-navy/80 leading-none" style={{ bottom: tgtH + 2 }}>plan {compactMajor(d.target)}</div>
                      )}
                    </>
                  )}
                </div>
                <div className="text-[9px] text-hive-muted font-bold truncate w-full text-center">{monthShort(d.mk)}</div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-1">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-hive-muted"><i className="inline-block w-3.5 h-2 rounded-sm bg-pulse-gold"></i> Actual saved</span>
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-hive-muted"><i className="inline-block w-3.5 border-t-2 border-dashed border-pulse-navy/70"></i> Your plan (target/mo)</span>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-pulse-gold/15">
          <span className="text-[12px] font-nunito font-black text-pulse-navy">{withTarget.length > 0 ? `Met/beat plan ${metOrBeat}/${withTarget.length} mo` : `Total saved · ${data.length} mo`}</span>
          <span className="text-right leading-tight">
            <span className="block text-[15px] font-nunito font-black text-pulse-green">{formatCentsBudgetNeat(total, currency)} saved</span>
            {plannedTotal > 0 && <span className="block text-[10px] text-hive-muted font-bold">vs {formatCentsBudgetNeat(plannedTotal, currency)} planned</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

/* 2b · Spend vs budget cap — monthly spend line under the cap line. */
function SpendVsBudget({ monthly, pctAbs, over, hasCap }: { monthly: MonthRow[]; pctAbs: number; over: boolean; hasCap: boolean }) {
  const data = [...monthly].reverse();
  const cap = Math.max(1, ...data.map((d) => d.cap));
  const W = 320, HH = 96;
  const x = (i: number) => data.length <= 1 ? W / 2 : 10 + (i * (W - 20)) / (data.length - 1);
  const y = (v: number) => HH - 16 - (v / cap) * (HH - 28);
  const line = data.map((d, i) => `${Math.round(x(i))},${Math.round(y(d.spent))}`).join(' ');
  const capY = Math.round(y(cap));
  return (
    <div className="bg-white border border-pulse-gold/40 rounded-2xl p-4">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-1">Spend vs budget cap</div>
      <p className="text-[11px] text-hive-muted font-bold mb-1">Under the cap = headroom → savings.</p>
      {data.length === 0 ? (
        <div className="text-[12px] text-hive-muted italic py-6 text-center">Builds as months close.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${HH}`} width="100%" height={HH} role="img" aria-label="Spend vs budget cap">
          <line x1="10" y1={capY} x2={W - 10} y2={capY} stroke="#C0463A" strokeWidth="2" strokeDasharray="6 5" />
          <text x={W - 10} y={capY - 4} textAnchor="end" fontSize="9" fontWeight="700" fill="#C0463A">cap {compactMajor(cap)}</text>
          <polyline fill="none" stroke="#0F1F44" strokeWidth="2.5" strokeLinejoin="round" points={line} />
          {data.map((d, i) => <circle key={d.mk} cx={Math.round(x(i))} cy={Math.round(y(d.spent))} r="3" fill="#0F1F44" />)}
        </svg>
      )}
      {hasCap && (
        <div className={`text-[12px] font-nunito font-black mt-1 ${over ? 'text-pulse-coral' : 'text-pulse-green'}`}>{over ? `⚠️ ${pctAbs}% over cap on average` : `✅ ${pctAbs}% under cap on average`}</div>
      )}
    </div>
  );
}

/* 2c · A small compare card. */
function CompareCard({ title, big, good, pill, note }: { title: string; big: string; good: boolean; pill: string; note: string }) {
  return (
    <div className="bg-white border border-pulse-gold/40 rounded-2xl p-4">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk">{title}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`text-[24px] font-nunito font-black ${good ? 'text-pulse-green' : 'text-pulse-coral'}`}>{big}</span>
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${good ? 'bg-[#e3f2e6] text-pulse-green' : 'bg-[#fde6e6] text-pulse-coral'}`}>{pill}</span>
      </div>
      <div className="text-[11px] text-hive-muted font-bold mt-1">{note}</div>
    </div>
  );
}

/* 3 · From Kaya Wealth · what your savings become. */
const PULSE_BOND_RATE = 0.15; // illustrative annual rate — wire to a Kaya Wealth-set rate later
function WealthProjection({ monthlyCents, currency }: { monthlyCents: number; currency: string }) {
  const ratePct = Math.round(PULSE_BOND_RATE * 100);
  if (!monthlyCents || monthlyCents <= 0) {
    return (
      <div className="mt-6">
        <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">💎 What your savings become</div>
        <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#13234d,#0c1733)' }}>
          <div className="text-[13px] font-bold leading-snug">Set a monthly save target — Kaya will show what it grows to at a {ratePct}% bond, in 1, 5 and 10 years.</div>
        </div>
      </div>
    );
  }
  const i = PULSE_BOND_RATE / 12;
  const fv = (n: number) => Math.round(monthlyCents * ((Math.pow(1 + i, n) - 1) / i));
  const years = Array.from({ length: 10 }, (_, k) => k + 1);
  const valByYear = years.map((y) => fv(y * 12));
  const putByYear = years.map((y) => monthlyCents * 12 * y);
  const maxV = Math.max(1, valByYear[valByYear.length - 1]);
  const pts = (arr: number[]) => arr.map((v, idx) => `${Math.round(30 + idx * (300 / 9))},${Math.round(150 - (v / maxV) * 120)}`).join(' ');
  const y1 = fv(12), y5 = fv(60), y10 = fv(120);
  const doublingYrs = (72 / (PULSE_BOND_RATE * 100)).toFixed(1);
  const chips: Array<[string, number, number]> = [['1 year', y1, monthlyCents * 12], ['5 years', y5, monthlyCents * 60], ['10 years', y10, monthlyCents * 120]];
  return (
    <div className="mt-6">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">💎 What your savings become</div>
      <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#13234d,#0c1733)' }}>
        <div className="text-[13.5px] font-bold leading-snug">
          Save your <b>{formatCentsBudgetNeat(monthlyCents, currency)}/mo</b> target and invest at <span style={{ color: '#D4A847' }}>{ratePct}% (bond)</span> → in 5 years ≈ <span style={{ color: '#D4A847' }}>{formatCentsBudgetNeat(y5, currency)}</span>.
        </div>
        <svg viewBox="0 0 340 168" width="100%" height="150" style={{ marginTop: 8 }} role="img" aria-label="Savings growth at a bond rate">
          <polyline fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="2" strokeDasharray="5 5" points={pts(putByYear)} />
          <polyline fill="none" stroke="#D4A847" strokeWidth="3" strokeLinejoin="round" points={pts(valByYear)} />
          <g fontSize="9" fontWeight="700" fill="rgba(255,255,255,.6)" textAnchor="middle">
            <text x="30" y="164">1y</text><text x="163" y="164">5y</text><text x="330" y="164">10y</text>
          </g>
        </svg>
        <div className="flex gap-4">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold" style={{ color: 'rgba(255,255,255,.75)' }}><i className="inline-block w-3.5 h-1 rounded" style={{ background: '#D4A847' }}></i> Value (with growth)</span>
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold" style={{ color: 'rgba(255,255,255,.75)' }}><i className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: 'rgba(255,255,255,.6)' }}></i> What you put in</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {chips.map(([lbl, val, put]) => (
            <div key={lbl} className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)' }}>
              <div className="text-[9.5px] font-bold uppercase tracking-wide" style={{ opacity: .7 }}>In {lbl}</div>
              <div className="text-[14px] font-nunito font-black" style={{ color: '#D4A847' }}>{formatCentsBudgetNeat(val, currency)}</div>
              <div className="text-[9px]" style={{ opacity: .65 }}>put in {formatCentsBudgetNeat(put, currency)}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl p-3 mt-3 text-[12.5px] leading-snug" style={{ background: 'rgba(212,168,71,.14)', border: '1px solid rgba(212,168,71,.4)' }}>
          ⏳ At {ratePct}%, money <b>doubles in ~{doublingYrs} years</b>. Saving today buys your future self more.
        </div>
        <Link href="/wealth" className="block text-center font-nunito font-black rounded-xl mt-3 py-2.5 text-[13.5px]" style={{ background: '#D4A847', color: '#0F1F44', textDecoration: 'none' }}>See it in Kaya Wealth →</Link>
        <div className="text-[10px] text-center mt-2" style={{ opacity: .6 }}>Illustrative · {ratePct}% bond · not financial advice.</div>
      </div>
    </div>
  );
}

interface ModuleRow { m: PurchaseModule; cap: number; totalSaved: number; totalSpent: number; perMonth: { mk: string; spent: number; saved: number }[] }

/* Per-bucket pacing with a mini saved-trend sparkline each. */
function PerBucketPacing({ rows, currency }: { rows: ModuleRow[]; currency: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">Per-bucket pacing</div>
      <div className="bg-white border border-pulse-gold/40 rounded-2xl overflow-hidden">
        {rows.map((r) => {
          const series = [...r.perMonth].reverse().map((p) => p.saved);
          const max = Math.max(1, ...series);
          const pts = series.map((v, i) => `${series.length <= 1 ? 45 : (i * 90) / (series.length - 1)},${Math.round(22 - (v / max) * 18)}`).join(' ');
          const under = r.totalSpent <= r.cap * r.perMonth.length;
          return (
            <div key={r.m} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-pulse-gold/15 last:border-b-0">
              <span className="w-7 h-7 rounded-lg bg-pulse-cream flex items-center justify-center text-sm flex-shrink-0">{MODULE_EMOJI[r.m]}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-nunito font-black text-pulse-navy truncate">{MODULE_LABEL[r.m]}</div>
                <div className="text-[10px] text-hive-muted font-bold">saved {formatCents(r.totalSaved, currency)} · {r.perMonth.length} mo</div>
              </div>
              <svg width="90" height="26" className="flex-shrink-0"><polyline fill="none" stroke={under ? '#1E7A46' : '#D4A847'} strokeWidth="2" points={pts} /></svg>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${under ? 'bg-[#e3f2e6] text-pulse-green' : 'bg-pulse-cream text-hive-muted'}`}>{under ? 'under' : 'watch'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
