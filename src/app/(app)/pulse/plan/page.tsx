'use client';

// /pulse/plan — Kaya Pulse · Savings plan (parent-only).
//
// Set a target — either a TZS amount to save per month or a % to cut — and Kaya
// suggests per-bucket caps against a recent-spend baseline. The plan is a
// SAVINGS TARGET and does NOT change the household budget by default (2026-05-23
// decouple); the parent can opt in to push the suggested caps to it. Then track
// against it: saved-so-far (prorated), a run-rate month-end projection vs the
// goal, and per-bucket pacing flags.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import { updateFamily } from '@/lib/firestore';
import {
  type PurchaseRequest, type PurchaseModule,
  subscribeToRecentRequests, MODULE_EMOJI, MODULE_LABEL,
} from '@/lib/purchase';
import { PulseHeader, PulseHero } from '@/components/pulse/ui';
import {
  type PulsePlan, type BudgetSnapshot, resolvePlan, suggestFocusModules, ROUND_STEPS, suggestRoundStep,
  subscribeBudgetSnapshots, ensureBudgetSnapshot,
} from '@/lib/pulse';

const PLAN_MODULES: PurchaseModule[] = ['pantry', 'outdoor', 'drivers', 'utility', 'dineOut', 'home'];
const monthKeyOf = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date = new Date()) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const spendOf = (r: PurchaseRequest) => r.actualTotalCents ?? r.estimatedTotalCents ?? 0;

export default function PulsePlanPage() {
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
  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    return subscribeToRecentRequests(profile.familyId, setRecent);
  }, [profile?.familyId, profile?.role]);

  // Frozen month-end snapshots (Phase 2). Once a month is snapshotted its
  // savings is permanent — a later cap change can't move it.
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>([]);
  const [snapsLoaded, setSnapsLoaded] = useState(false);
  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    return subscribeBudgetSnapshots(profile.familyId, (s) => { setSnapshots(s); setSnapsLoaded(true); });
  }, [profile?.familyId, profile?.role]);
  const snapByMonth = useMemo(() => {
    const m: Record<string, BudgetSnapshot> = {};
    for (const s of snapshots) m[s.monthKey] = s;
    return m;
  }, [snapshots]);

  // Baseline = recent average monthly spend per module (prior full months).
  const baseline = useMemo(() => {
    const byMonth: Record<string, Partial<Record<PurchaseModule, number>>> = {};
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      const at = r.closedAt?.toDate?.();
      if (!at) continue;
      const mk = monthKeyOf(at);
      if (mk === thisMonth) continue; // exclude the current partial month
      const m = (r.module ?? 'pantry') as PurchaseModule;
      byMonth[mk] = byMonth[mk] || {};
      byMonth[mk][m] = (byMonth[mk][m] ?? 0) + spendOf(r);
    }
    const months = Object.keys(byMonth);
    const out: Partial<Record<PurchaseModule, number>> = {};
    const caps = family?.householdBudgets ?? {};
    for (const m of PLAN_MODULES) {
      const total = months.reduce((s, mk) => s + (byMonth[mk]?.[m] ?? 0), 0);
      const avg = months.length ? Math.round(total / months.length) : 0;
      out[m] = avg || (caps as Record<string, number | undefined>)[m] || 0;
    }
    return out;
  }, [recent, thisMonth, family?.householdBudgets]);

  // Spend so far this month per module.
  const spentThisMonth = useMemo(() => {
    const out: Partial<Record<PurchaseModule, number>> = {};
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      const at = r.closedAt?.toDate?.();
      if (!at || monthKeyOf(at) !== thisMonth) continue;
      const m = (r.module ?? 'pantry') as PurchaseModule;
      out[m] = (out[m] ?? 0) + spendOf(r);
    }
    return out;
  }, [recent, thisMonth]);

  const plan = family?.pulsePlan;

  // Savings history (Phase 2): use the FROZEN snapshot for a month when one
  // exists; otherwise compute live (current caps − spend) — those months get
  // snapshotted on load (backfill below). Completed months only.
  const savings = useMemo(() => {
    const caps = (family?.householdBudgets ?? {}) as Record<string, number | undefined>;
    const spend: Record<string, Partial<Record<PurchaseModule, number>>> = {};
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      const at = r.closedAt?.toDate?.();
      if (!at) continue;
      const mk = monthKeyOf(at);
      if (mk === thisMonth) continue; // completed months only
      const m = (r.module ?? 'pantry') as PurchaseModule;
      (spend[mk] ||= {})[m] = (spend[mk]![m] ?? 0) + spendOf(r);
    }
    const months = Array.from(new Set([...Object.keys(spend), ...Object.keys(snapByMonth)]))
      .sort((a, b) => b.localeCompare(a)).slice(0, 6); // newest first

    // The plan target the family has set now — used for months that don't yet
    // carry a frozen target (so the trend's plan line still has a value).
    const curTarget = family?.pulsePlan?.targetSavingsCents ?? 0;

    const monthly = months.map((mk) => {
      const snap = snapByMonth[mk];
      if (snap) return { mk, spent: snap.totalSpentCents, saved: snap.savingsCents, target: snap.planTargetCents ?? curTarget };
      let spent = 0, saved = 0;
      for (const m of PLAN_MODULES) { const sp = spend[mk]?.[m] ?? 0; spent += sp; saved += Math.max(0, (caps[m] ?? 0) - sp); }
      return { mk, spent, saved, target: curTarget };
    });

    const byModule = PLAN_MODULES.map((m) => {
      const cap = caps[m] ?? 0;
      const perMonth = months.map((mk) => {
        const pm = snapByMonth[mk]?.perModule?.[m];
        if (pm) return { mk, spent: pm.spentCents, saved: Math.max(0, pm.capCents - pm.spentCents) };
        const sp = spend[mk]?.[m] ?? 0;
        return { mk, spent: sp, saved: Math.max(0, cap - sp) };
      });
      return {
        m, cap,
        totalSaved: perMonth.reduce((s, x) => s + x.saved, 0),
        totalSpent: perMonth.reduce((s, x) => s + x.spent, 0),
        perMonth,
      };
    }).filter((x) => x.cap > 0 || x.totalSpent > 0).sort((a, b) => b.totalSaved - a.totalSaved);

    // Completed months with spend but no frozen snapshot → backfill payloads.
    const toBackfill = Object.keys(spend).filter((mk) => !snapByMonth[mk]).map((mk) => {
      const perModule: BudgetSnapshot['perModule'] = {};
      let totalSpentCents = 0, totalCapCents = 0, savingsCents = 0;
      for (const m of PLAN_MODULES) {
        const sp = spend[mk]?.[m] ?? 0;
        const cap = caps[m] ?? 0;
        if (sp === 0 && cap === 0) continue;
        perModule[m] = { spentCents: sp, capCents: cap, deltaPct: cap > 0 ? Math.round(((sp - cap) / cap) * 100) : 0 };
        totalSpentCents += sp; totalCapCents += cap; savingsCents += Math.max(0, cap - sp);
      }
      return { monthKey: mk, totalSpentCents, totalCapCents, perModule, savingsCents, planTargetCents: curTarget, finalized: true } as Omit<BudgetSnapshot, 'id' | 'finalizedAt'>;
    });

    return { monthly, byModule, toBackfill };
  }, [recent, thisMonth, family?.householdBudgets, family?.pulsePlan?.targetSavingsCents, snapByMonth]);

  // Running Wealth balance = all frozen snapshots, all-time.
  const wealthBalanceCents = useMemo(() => snapshots.reduce((s, x) => s + (x.savingsCents ?? 0), 0), [snapshots]);

  // Freeze completed months not yet snapshotted (idempotent; the lib also
  // guards with a read so a frozen month is never rewritten).
  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent' || !snapsLoaded) return;
    for (const payload of savings.toBackfill) {
      void ensureBudgetSnapshot(profile.familyId, payload).catch(() => {});
    }
  }, [savings.toBackfill, snapsLoaded, profile?.familyId, profile?.role]);

  // "Where the money went" — top items by total spend across closed shops.
  const itemSpend = useMemo(() => {
    const byItem: Record<string, number> = {};
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      for (const it of r.items ?? []) {
        const name = (it.name || '').trim();
        if (!name) continue;
        const cents = (it.actualCents ?? it.estimatedCents ?? 0) * (it.actualQty ?? it.qty ?? 1);
        byItem[name] = (byItem[name] ?? 0) + cents;
      }
    }
    return Object.entries(byItem)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, cents]) => ({ name, cents }));
  }, [recent]);

  // Use the plan's frozen baseline only if it actually carries data; otherwise
  // the live baseline (which itself falls back to the budget caps). This stops
  // the analytics from rendering empty just because the plan was created before
  // any spend history existed.
  const planBaseline = (() => {
    const b = plan?.baselineByModule;
    const sum = b ? Object.values(b).reduce((s: number, v) => s + (v ?? 0), 0) : 0;
    return sum > 0 && b ? b : baseline;
  })();
  // The monthly amount the Wealth projection compounds — the goal the parent
  // actually set (amount mode), else the resolved target from the baseline.
  const monthlySaveTarget = plan ? (plan.targetSavingsCents || resolvePlan(plan, planBaseline).targetSavingsCents) : 0;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <PulseHeader back={{ href: '/pulse', label: 'Dashboard' }} eyebrow="Savings plan" title="Save with a plan" subtitle="Set a monthly target, then track against it." />

      {plan && <PlanTracking plan={plan} caps={family?.householdBudgets} spent={spentThisMonth} currency={currency} />}

      {plan && <BudgetVsSave plan={plan} baseline={planBaseline} currency={currency} />}

      <PlanSetup
        familyId={profile?.familyId ?? ''}
        baseline={baseline}
        existing={plan}
        currentCaps={family?.householdBudgets}
        currency={currency}
      />

      {wealthBalanceCents > 0 && (
        <div className="mt-5 bg-pulse-navy text-pulse-gold rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[1px] font-black opacity-85">💰 Wealth saved to date</div>
            <div className="text-2xl font-nunito font-black mt-0.5">{formatCentsBudgetNeat(wealthBalanceCents, currency)}</div>
          </div>
          <div className="text-[11px] font-bold opacity-85 text-right leading-tight">{snapshots.length} month{snapshots.length === 1 ? '' : 's'}<br />frozen</div>
        </div>
      )}

      {plan && <WealthProjection monthlyCents={monthlySaveTarget} currency={currency} />}

      <SavingsTrend monthly={savings.monthly} currency={currency} />
      <SavingsByModule rows={savings.byModule} currency={currency} />
      <SpendByItem items={itemSpend} currency={currency} />
    </div>
  );
}

function monthLabelOf(mk: string): string {
  const [y, m] = mk.split('-').map(Number);
  if (!y || !m) return mk;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** Compact amount for tight bar labels (no currency symbol): 685k, 1.2M. */
function compactMajor(cents: number): string {
  const v = Math.round(cents / 100);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
}

interface MonthSaved { mk: string; spent: number; saved: number; target: number }
interface ModuleMonth { mk: string; spent: number; saved: number }
interface ModuleSaved { m: PurchaseModule; cap: number; totalSaved: number; totalSpent: number; perMonth: ModuleMonth[] }

/* Overall savings trendline — bars over the completed months. */
function SavingsTrend({ monthly, currency }: { monthly: MonthSaved[]; currency: string }) {
  if (monthly.length === 0) {
    return (
      <div className="mt-6">
        <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">📈 Savings trend</div>
        <div className="bg-white border border-pulse-gold/40 rounded-2xl p-5 text-center text-[12px] text-hive-muted italic">
          No completed months yet — your savings trend builds as months close.
        </div>
      </div>
    );
  }
  const data = [...monthly].reverse(); // oldest → newest
  const H = 84;
  // Scale to the bigger of saved/target so the (varying) target line fits.
  const max = Math.max(1, ...data.flatMap((d) => [d.saved, d.target]));
  const total = monthly.reduce((s, d) => s + d.saved, 0);
  const withTarget = data.filter((d) => d.target > 0);
  const metOrBeat = withTarget.filter((d) => d.saved >= d.target).length;
  return (
    <div className="mt-6">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">📈 Savings vs your plan</div>
      <div className="bg-white border border-pulse-gold/40 rounded-2xl p-4">
        <div className="flex items-end gap-1.5 sm:gap-2" style={{ height: H + 46 }}>
          {data.map((d) => {
            const barH = Math.max(4, Math.round((d.saved / max) * H));
            const tgtH = d.target > 0 ? Math.round((d.target / max) * H) : 0;
            const beat = d.target > 0 && d.saved >= d.target;
            return (
              <div key={d.mk} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
                <div className={`text-[9px] font-nunito font-black ${beat ? 'text-pulse-green' : 'text-pulse-navy'}`}>{compactMajor(d.saved)}</div>
                {/* fixed-height plot area: saved bar (gold) + dashed target line */}
                <div className="relative w-full" style={{ height: H }}>
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[72%] rounded-t-md bg-pulse-gold" style={{ height: barH }} />
                  {tgtH > 0 && (
                    <div className="absolute left-0 right-0 border-t-2 border-dashed border-pulse-navy/70" style={{ bottom: tgtH }} title={`Plan ${compactMajor(d.target)}`} />
                  )}
                </div>
                <div className="text-[9px] text-hive-muted font-bold truncate w-full text-center">{monthLabelOf(d.mk).split(' ')[0]}</div>
              </div>
            );
          })}
        </div>
        <div className="legend flex gap-4 mt-1">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-hive-muted"><i className="inline-block w-3.5 h-2 rounded-sm bg-pulse-gold"></i> Actual saved</span>
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-hive-muted"><i className="inline-block w-3.5 border-t-2 border-dashed border-pulse-navy/70"></i> Your plan (per month)</span>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-pulse-gold/15">
          <span className="text-[12px] font-nunito font-black text-pulse-navy">
            {withTarget.length > 0 ? `Met/beat plan ${metOrBeat}/${withTarget.length} mo` : `Total saved · ${data.length} mo`}
          </span>
          <span className="text-[15px] font-nunito font-black text-pulse-green">{formatCentsBudgetNeat(total, currency)}</span>
        </div>
      </div>
      <p className="text-[10px] text-hive-muted mt-1.5">Bars = what you actually saved · dashed line = the target you'd set that month (it can change month to month). Each completed month is frozen.</p>
    </div>
  );
}

/* Per category · budget (keep) vs save — Elia update 1. Each bucket's working
   budget alongside the slice routed to savings, with a keep/save split bar. */
function BudgetVsSave({ plan, baseline, currency }: {
  plan: PulsePlan; baseline: Partial<Record<PurchaseModule, number>>; currency: string;
}) {
  const resolved = resolvePlan(plan, baseline);
  const rows = PLAN_MODULES.map((m) => {
    const base = baseline[m] ?? 0;
    const keep = resolved.capsByModule[m] ?? 0;
    return { m, keep, save: Math.max(0, base - keep) };
  }).filter((r) => r.keep > 0 || r.save > 0);
  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">Per category · budget vs save</div>
        <div className="bg-white border border-pulse-gold/40 rounded-2xl p-4 text-center text-[12px] text-hive-muted italic">
          Set budget caps + a savings target to see each bucket&apos;s keep-vs-save split.
        </div>
      </div>
    );
  }
  const totalKeep = rows.reduce((s, r) => s + r.keep, 0);
  const totalSave = rows.reduce((s, r) => s + r.save, 0);
  const renderRow = (key: string, emoji: string, label: string, keep: number, save: number, bold: boolean) => {
    const tot = Math.max(1, keep + save);
    const keepPct = Math.round((keep / tot) * 100);
    return (
      <div key={key} className={`grid grid-cols-2 gap-x-3 gap-y-1.5 items-center py-2 ${bold ? 'border-t-2 border-pulse-navy/30 mt-1' : 'border-t border-pulse-gold/15'}`}>
        <div className="min-w-0">
          <div className="text-[12.5px] font-nunito font-black text-pulse-navy truncate">{emoji} {label}</div>
          <div className="text-[10px] text-hive-muted font-bold">budget {formatCents(keep, currency)}</div>
        </div>
        <div className="text-right">
          <div className="text-[12.5px] font-nunito font-black text-pulse-green">save {formatCents(save, currency)}</div>
          <div className="text-[10px] text-hive-muted font-bold">{100 - keepPct}% of bucket</div>
        </div>
        <div className="col-span-2 h-2.5 rounded-full bg-pulse-cream overflow-hidden flex">
          <div className="h-full bg-pulse-gold" style={{ width: `${keepPct}%` }} />
          <div className="h-full bg-pulse-green" style={{ width: `${100 - keepPct}%` }} />
        </div>
      </div>
    );
  };
  return (
    <div className="mt-4">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">Per category · budget vs save</div>
      <div className="bg-white border border-pulse-gold/40 rounded-2xl p-4">
        {rows.map((r) => renderRow(r.m, MODULE_EMOJI[r.m], MODULE_LABEL[r.m], r.keep, r.save, false))}
        {renderRow('__total', '∑', 'Total', totalKeep, totalSave, true)}
        <div className="flex gap-4 mt-3 pt-2 border-t border-pulse-gold/15">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-hive-muted"><i className="inline-block w-3 h-2 rounded-sm bg-pulse-gold"></i> Keep (budget)</span>
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-hive-muted"><i className="inline-block w-3 h-2 rounded-sm bg-pulse-green"></i> Save → Wealth</span>
        </div>
      </div>
      <p className="text-[10px] text-hive-muted mt-1.5">Each bucket&apos;s working budget vs the slice that goes to savings. Edit the plan to rebalance.</p>
    </div>
  );
}

/* From Kaya Wealth · what your savings become — Elia update 3. Annuity growth
   at an illustrative bond rate; inspires saving by showing the compounded value. */
const PULSE_BOND_RATE = 0.15; // illustrative annual rate — wire to a Kaya Wealth-set rate later
function WealthProjection({ monthlyCents, currency }: { monthlyCents: number; currency: string }) {
  const ratePctEmpty = Math.round(PULSE_BOND_RATE * 100);
  if (!monthlyCents || monthlyCents <= 0) {
    return (
      <div className="mt-6">
        <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">💎 What your savings become</div>
        <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#13234d,#0c1733)' }}>
          <div className="text-[13px] font-bold leading-snug">Set a monthly save target above — Kaya will show what it grows to at a {ratePctEmpty}% bond, in 1, 5 and 10 years.</div>
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
  const ratePct = Math.round(PULSE_BOND_RATE * 100);
  const chips: Array<[string, number, number]> = [['1 year', y1, monthlyCents * 12], ['5 years', y5, monthlyCents * 60], ['10 years', y10, monthlyCents * 120]];
  return (
    <div className="mt-6">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">💎 What your savings become</div>
      <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#13234d,#0c1733)' }}>
        <div className="text-[13.5px] font-bold leading-snug">
          Save <b>{formatCentsBudgetNeat(monthlyCents, currency)}/mo</b> and invest at <span style={{ color: '#D4A847' }}>{ratePct}% (bond)</span> → in 5 years ≈ <span style={{ color: '#D4A847' }}>{formatCentsBudgetNeat(y5, currency)}</span>.
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

/* Drill by budget line (module) — tap to expand per-month. */
function SavingsByModule({ rows, currency }: { rows: ModuleSaved[]; currency: string }) {
  const [open, setOpen] = useState<PurchaseModule | null>(null);
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">By budget line</div>
      <div className="bg-white border border-pulse-gold/40 rounded-2xl overflow-hidden">
        {rows.map((r) => (
          <div key={r.m} className="border-b border-pulse-gold/15 last:border-b-0">
            <button type="button" onClick={() => setOpen(open === r.m ? null : r.m)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left">
              <span className="w-7 h-7 rounded-lg bg-pulse-cream flex items-center justify-center text-sm flex-shrink-0">{MODULE_EMOJI[r.m]}</span>
              <span className="flex-1 text-[12.5px] font-nunito font-black text-pulse-navy min-w-0 truncate">{MODULE_LABEL[r.m]}</span>
              <span className="text-[12.5px] font-nunito font-black text-pulse-green">+{formatCents(r.totalSaved, currency)}</span>
              <span className="text-hive-muted text-[11px] w-3 text-center">{open === r.m ? '▾' : '▸'}</span>
            </button>
            {open === r.m && (
              <div className="px-4 pb-2.5 bg-pulse-cream/40">
                {r.perMonth.map((pm) => (
                  <div key={pm.mk} className="flex items-center text-[11px] py-1">
                    <span className="flex-1 text-hive-muted font-bold">{monthLabelOf(pm.mk)}</span>
                    <span className="text-hive-muted mr-3">spent {formatCents(pm.spent, currency)}</span>
                    <span className="text-pulse-green font-nunito font-black w-20 text-right">+{formatCents(pm.saved, currency)}</span>
                  </div>
                ))}
                <div className="text-[10px] text-hive-muted mt-1">Cap {formatCents(r.cap, currency)}/mo · spent {formatCents(r.totalSpent, currency)} over {r.perMonth.length} mo</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* "Where the money went" — top items by spend (a spend lens, not savings). */
function SpendByItem({ items, currency }: { items: { name: string; cents: number }[]; currency: string }) {
  if (items.length === 0) return null;
  const max = Math.max(1, ...items.map((i) => i.cents));
  return (
    <div className="mt-4">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-2">Where the money went · top items</div>
      <div className="bg-white border border-pulse-gold/40 rounded-2xl p-3 flex flex-col gap-2">
        {items.map((it) => (
          <div key={it.name}>
            <div className="flex items-center justify-between text-[12px] gap-2">
              <span className="font-bold text-pulse-navy truncate flex-1">{it.name}</span>
              <span className="font-nunito font-black text-pulse-navy flex-shrink-0">{formatCents(it.cents, currency)}</span>
            </div>
            <div className="h-1.5 bg-pulse-cream rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-pulse-gold" style={{ width: `${Math.round((it.cents / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-hive-muted mt-1.5">Total spend per item across all closed shops.</p>
    </div>
  );
}

/* ── Tracking: saved-so-far + run-rate projection + per-bucket pacing ── */
function PlanTracking({ plan, caps, spent, currency }: {
  plan: PulsePlan; caps?: Record<string, number | undefined>; spent: Partial<Record<PurchaseModule, number>>; currency: string;
}) {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const pace = now.getDate() / daysInMonth;
  const base = plan.baselineByModule ?? {};
  const goal = plan.targetSavingsCents ?? 0;

  let projSavings = 0;
  let savedSoFar = 0;
  const rows = PLAN_MODULES.map((m) => {
    const b = base[m] ?? 0;
    const cap = (caps as Record<string, number | undefined> | undefined)?.[m] ?? 0;
    const actual = spent[m] ?? 0;
    const projected = pace > 0 ? Math.round(actual / pace) : actual;
    projSavings += Math.max(0, b - projected);
    savedSoFar += Math.max(0, Math.round(b * pace) - actual);
    const over = cap > 0 && actual > cap * pace * 1.05;
    const pct = cap > 0 ? Math.round((actual / cap) * 100) : 0;
    return { m, cap, actual, pct, over };
  });
  const onTrack = goal === 0 ? true : projSavings >= goal * 0.95;

  return (
    <div className="mt-4 mb-6">
      <PulseHero className={onTrack ? '' : ''}>
        <div className="text-[10px] uppercase tracking-[1px] font-black opacity-85">Projected savings this month</div>
        <div className="text-3xl font-nunito font-black mt-1">
          {formatCentsBudgetNeat(projSavings, currency)}
          {goal > 0 && <span className="text-sm opacity-80 font-bold"> / {formatCentsBudgetNeat(goal, currency)} goal</span>}
        </div>
        <div className="text-[12px] opacity-90 mt-1">
          {goal > 0 ? (onTrack ? '✓ On track to hit your goal' : '⚠ Behind your goal — tighten the buckets below') : 'Set a goal below to track against it'}
          {' · '}saved so far {formatCents(savedSoFar, currency)}
        </div>
        {goal > 0 && (
          <div className="h-2 bg-white/20 rounded-full mt-3 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((projSavings / goal) * 100))}%`, background: '#D4A847' }} />
          </div>
        )}
      </PulseHero>

      <div className="text-[11px] font-nunito font-black text-pulse-navy uppercase tracking-[1px] mt-4 mb-2">Per-bucket pacing</div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.m} className="bg-white border border-pulse-gold/30 rounded-2xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-pulse-cream flex items-center justify-center text-base">{MODULE_EMOJI[r.m]}</div>
            <div className="flex-1 min-w-0">
              <div className="font-nunito font-black text-sm text-pulse-navy">{MODULE_LABEL[r.m]}</div>
              <div className="text-[11px] text-hive-muted font-bold">{formatCents(r.actual, currency)}{r.cap > 0 ? ` of ${formatCents(r.cap, currency)} cap` : ' · no cap'}</div>
            </div>
            {r.cap > 0 && (
              <span className={`text-[9px] font-black px-2 py-1 rounded-lg ${r.over ? 'bg-[#fde6e6] text-pulse-coral' : 'bg-[#e3f2e6] text-pulse-green'}`}>
                {r.over ? 'over pace' : 'on track'} · {r.pct}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Setup: amount or % → per-bucket caps ── */
function PlanSetup({ familyId, baseline, existing, currentCaps, currency }: {
  familyId: string; baseline: Partial<Record<PurchaseModule, number>>; existing?: PulsePlan;
  currentCaps?: Record<string, number | undefined>; currency: string;
}) {
  const [mode, setMode] = useState<'amount' | 'percent'>(existing?.savingsMode ?? 'amount');
  const [targetMajor, setTargetMajor] = useState<string>(existing?.targetSavingsCents ? String(existing.targetSavingsCents / 100) : '');
  const [cutPct, setCutPct] = useState<string>(existing?.overallCutPct != null ? String(existing.overallCutPct) : '20');
  const [caps, setCaps] = useState<Partial<Record<PurchaseModule, number>>>(() => {
    const init: Partial<Record<PurchaseModule, number>> = {};
    PLAN_MODULES.forEach((m) => { init[m] = (currentCaps as Record<string, number | undefined>)?.[m] ?? baseline[m] ?? 0; });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(!existing);
  // Round-off step for auto-suggested caps (major units). -1 = Auto
  // (scales with the budget's magnitude). Explicit options come from
  // ROUND_STEPS (0 = None / exact).
  const [roundStep, setRoundStep] = useState<number>(existing?.roundToMajorUnits ?? -1);
  // Decoupled (2026-05-23): the plan is a savings TARGET and no longer
  // rewrites the budget by default. Tick to also push these caps to it.
  const [applyToBudget, setApplyToBudget] = useState(false);

  const totalBaseline = PLAN_MODULES.reduce((s, m) => s + (baseline[m] ?? 0), 0);
  const totalBaselineMajor = Math.round(totalBaseline / 100);
  const autoStep = suggestRoundStep(totalBaselineMajor);
  const effectiveStep = roundStep === -1 ? autoStep : roundStep;
  const focus = useMemo(() => suggestFocusModules(baseline, 3), [baseline]);

  // Recompute suggested caps from the target/cut against the baseline,
  // rounded to `step` (clean numbers). Pass the step explicitly so a
  // selector change can re-distribute before state settles.
  const suggestWith = (step: number) => {
    const draft: PulsePlan = {
      savingsMode: mode,
      overallCutPct: mode === 'percent' ? Number(cutPct) || 0 : undefined,
      targetSavingsCents: mode === 'amount' ? Math.round((Number(targetMajor) || 0) * 100) : undefined,
      roundToMajorUnits: step > 0 ? step : undefined,
      source: 'suggested',
      planPeriod: 'monthly',
    };
    const { capsByModule } = resolvePlan(draft, baseline);
    setCaps(capsByModule);
    setSaved(false);
  };
  const suggest = () => suggestWith(effectiveStep);

  const totalCap = PLAN_MODULES.reduce((s, m) => s + (caps[m] ?? 0), 0);
  const plannedSavings = Math.max(0, totalBaseline - totalCap);

  const save = async () => {
    if (!familyId || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const nextPlan: PulsePlan = {
        savingsMode: mode,
        overallCutPct: mode === 'percent' ? Number(cutPct) || 0 : undefined,
        targetSavingsCents: mode === 'amount' ? Math.round((Number(targetMajor) || 0) * 100) : plannedSavings,
        perModuleCapCents: caps,
        baselineByModule: baseline,
        suggestedFocusModules: focus,
        roundToMajorUnits: effectiveStep,
        source: 'parent',
        planPeriod: 'monthly',
      };
      await updateFamily(familyId, {
        pulsePlan: nextPlan,
        // Opt-in only — the plan no longer silently rewrites the budget.
        ...(applyToBudget ? { householdBudgets: { ...(currentCaps ?? {}), ...caps } } : {}),
      });
      setSaved(true);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (existing && !open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full mt-2 border-2 border-pulse-gold/50 text-pulse-gold-dk rounded-2xl py-3 font-nunito font-black text-sm">
        ✎ Edit savings plan
      </button>
    );
  }

  return (
    <div className="bg-white border border-pulse-gold rounded-2xl p-4 mt-2">
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-3">{existing ? 'Edit plan' : 'Set your target'}</p>

      <div className="flex bg-pulse-cream rounded-xl p-1 mb-3">
        <button onClick={() => { setMode('amount'); setSaved(false); }} className={`flex-1 py-2 rounded-lg text-[12px] font-nunito font-black ${mode === 'amount' ? 'bg-pulse-navy text-pulse-gold' : 'text-hive-muted'}`}>Save an amount</button>
        <button onClick={() => { setMode('percent'); setSaved(false); }} className={`flex-1 py-2 rounded-lg text-[12px] font-nunito font-black ${mode === 'percent' ? 'bg-pulse-navy text-pulse-gold' : 'text-hive-muted'}`}>Cut a %</button>
      </div>

      {mode === 'amount' ? (
        <label className="block mb-2">
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Target savings / month</span>
          <div className="flex items-center gap-1 border border-pulse-gold/40 rounded-lg px-3 py-2 mt-1">
            <span className="text-xs text-hive-muted font-bold">{currency}</span>
            <input type="number" min={0} step="1" value={targetMajor} onChange={(e) => { setTargetMajor(e.target.value); setSaved(false); }} placeholder="e.g. 1000000"
              className="flex-1 text-sm font-nunito font-bold focus:outline-none bg-transparent" />
          </div>
        </label>
      ) : (
        <label className="block mb-2">
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Cut across buckets</span>
          <div className="flex items-center gap-1 border border-pulse-gold/40 rounded-lg px-3 py-2 mt-1">
            <input type="number" min={0} max={90} step="1" value={cutPct} onChange={(e) => { setCutPct(e.target.value); setSaved(false); }}
              className="flex-1 text-sm font-nunito font-bold focus:outline-none bg-transparent" />
            <span className="text-xs text-hive-muted font-bold">%</span>
          </div>
        </label>
      )}

      <button onClick={suggest} className="w-full mb-3 border border-pulse-gold/40 rounded-lg py-2 text-[12px] font-nunito font-black text-pulse-gold-dk">
        ↻ Suggest caps from your usual spend
      </button>

      {/* Round-off — how clean the auto-suggested caps should be. Picking
          one re-distributes immediately. "Auto" scales with the budget. */}
      <div className="mb-3">
        <div className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px] mb-1.5">Round caps to</div>
        <div className="flex flex-wrap gap-1.5">
          {[-1, ...ROUND_STEPS].map((s) => {
            const on = roundStep === s;
            const label = s === -1 ? `Auto · ${autoStep > 0 ? autoStep.toLocaleString() : 'exact'}`
              : s === 0 ? 'None'
              : s.toLocaleString();
            return (
              <button
                key={s}
                type="button"
                onClick={() => { setRoundStep(s); suggestWith(s === -1 ? autoStep : s); }}
                className={`text-[11px] font-nunito font-black px-2.5 py-1 rounded-lg border ${on ? 'bg-pulse-navy text-pulse-gold border-pulse-navy' : 'bg-white text-hive-muted border-pulse-gold/40'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-[9px] text-hive-muted mt-1">
          {effectiveStep > 0
            ? `Suggested caps round to the nearest ${effectiveStep.toLocaleString()} ${currency}.`
            : 'Suggested caps are kept exact (no rounding).'}
        </p>
      </div>

      {focus.length > 0 && (
        <div className="bg-pulse-cream rounded-xl p-2.5 mb-3 text-[11px] text-pulse-navy font-bold">
          💡 Biggest buckets: {focus.map((m) => MODULE_LABEL[m]).join(', ')} — trimming these moves the needle most.
        </div>
      )}

      <div className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px] mb-1">Per-bucket cap (editable)</div>
      <div className="flex flex-col gap-2">
        {PLAN_MODULES.map((m) => {
          const b = baseline[m] ?? 0;
          return (
            <div key={m} className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-pulse-cream flex items-center justify-center text-sm flex-shrink-0">{MODULE_EMOJI[m]}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-nunito font-black text-pulse-navy">{MODULE_LABEL[m]}</div>
                <div className="text-[9px] text-hive-muted font-bold">usually {b > 0 ? formatCents(b, currency) : '—'}</div>
              </div>
              <div className="flex items-center gap-1 border border-pulse-gold/40 rounded-lg px-2 py-1.5 w-32">
                <span className="text-[10px] text-hive-muted font-bold">{currency}</span>
                <input type="number" min={0} step="1" value={caps[m] != null ? Math.round((caps[m] as number) / 100) : ''}
                  onChange={(e) => { setCaps((c) => ({ ...c, [m]: Math.max(0, Math.round(Number(e.target.value) * 100)) })); setSaved(false); }}
                  placeholder="cap" className="flex-1 min-w-0 text-[13px] font-nunito font-bold focus:outline-none bg-transparent" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-[#f3faf6] border border-[#bfe0d0] rounded-xl p-2.5 mt-3 text-[12px] font-nunito font-black text-pulse-green text-center">
        Plan saves ≈ {formatCentsBudgetNeat(plannedSavings, currency)} / month
      </div>

      {/* Opt-in: the plan is a target by default; only changes the budget
          when the parent explicitly asks. (Decouple, 2026-05-23) */}
      <label className="flex items-start gap-2 mt-3 cursor-pointer select-none">
        <input type="checkbox" checked={applyToBudget} onChange={(e) => { setApplyToBudget(e.target.checked); setSaved(false); }} className="w-4 h-4 mt-0.5 accent-pulse-navy flex-shrink-0" />
        <span className="text-[11px] font-bold text-hive-muted leading-snug">Also set these as my budget caps <span className="text-hive-muted/70">— optional; this changes your running budget.</span></span>
      </label>

      <button onClick={save} disabled={saving} className="w-full mt-3 bg-pulse-navy text-pulse-gold rounded-2xl py-3 font-nunito font-black text-sm disabled:opacity-50">
        {saving ? 'Saving…' : saved ? '✓ Plan saved' : 'Save plan'}
      </button>
      <p className="text-[10px] text-hive-muted text-center mt-2 leading-snug">
        Your plan is a <strong>savings target</strong> — it won’t touch your <Link href="/pantry/budget" className="text-pulse-gold-dk font-bold underline">household budget</Link> unless you tick the box. Tracking uses real spend vs your caps.
      </p>
    </div>
  );
}
