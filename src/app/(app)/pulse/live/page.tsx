'use client';

// /pulse/live — Kaya Pulse · Savings Analytics · Live (this month).
//
// Tab 1 of the Savings Analytics screen (v3 narrated design). Plain-English
// projection of this month's outcome — hero + per-bucket pacing — plus
// three "surprise" affordances: today's allowance pocket, recovery moves
// (one-tap "Try it" sets a 14-day temp cap stored on pulsePlan.tempCapOverrides),
// and a where-it-lands preview of the projected save. Tab 2 ("Plan") routes
// to /pulse/plan (kept as its own page so we don't tangle with parallel work
// editing the planner). Parent-only.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, type PurchaseModule,
  subscribeToRecentRequests, MODULE_EMOJI, MODULE_LABEL,
} from '@/lib/purchase';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import { PulseHeader } from '@/components/pulse/ui';
import { projectMonthSpendCents } from '@/lib/pulse';
import { updateFamily } from '@/lib/firestore';

const NAVY = '#0F1F44';
const GOLD = '#D4A847';
const GOLD_DK = '#B58A2F';
const GREEN = '#2E7D34';
const CORAL = '#E85C5C';
const SOFT = '#9aa3ad';

const LIVE_MODULES: PurchaseModule[] = ['pantry', 'outdoor', 'drivers', 'utility', 'payroll', 'home'];
const monthKeyOf = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthShort = (d: Date = new Date()) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

type Status = 'on' | 'ahead' | 'watch' | 'over';
interface BucketRow {
  m: PurchaseModule;
  spent: number;
  budget: number;       // cap from householdBudgets (or baseline if no cap)
  projected: number;    // run-rate
  projectedSave: number; // budget − projected (can be negative)
  planSave: number;     // baseline − cap (from pulsePlan)
  status: Status;
  leftInBudget: number; // budget − spent (can be negative)
}

function statusFor(projectedSave: number, planSave: number, budget: number, spent: number): Status {
  if (budget > 0 && spent > budget) return 'over';
  if (projectedSave < 0) return 'over';
  if (planSave > 0 && projectedSave < planSave) return 'watch';
  if (planSave > 0 && projectedSave > planSave) return 'ahead';
  return 'on';
}

function statusPill(s: Status): { label: string; bg: string; color: string } {
  if (s === 'over') return { label: 'over cap · trim', bg: '#FDE6E6', color: CORAL };
  if (s === 'watch') return { label: 'trending over', bg: '#FFF3D9', color: '#876009' };
  if (s === 'ahead') return { label: 'ahead', bg: '#E6F4EA', color: GREEN };
  return { label: 'on track', bg: '#E6F4EA', color: GREEN };
}

export default function PulseLivePage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const thisMonth = monthKeyOf();

  useEffect(() => {
    if (profile && profile.role !== 'parent') router.replace('/pulse/today');
  }, [profile, router]);

  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    return subscribeToRecentRequests(profile.familyId, setRecent);
  }, [profile?.familyId, profile?.role]);

  // Recovery "Try it" — busy state per module + a transient flash.
  const [busyRecovery, setBusyRecovery] = useState<PurchaseModule | null>(null);
  const [recoveryFlash, setRecoveryFlash] = useState<string | null>(null);

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - dayOfMonth + 1);
  const todayKey = now.toISOString().slice(0, 10);

  // CASH spend per module this month + today's spend total.
  const { perModuleSpent, spentTotal, spentToday } = useMemo(() => {
    const per: Partial<Record<PurchaseModule, number>> = {};
    let total = 0;
    let today = 0;
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      const at = r.closedAt?.toDate?.();
      if (!at || monthKeyOf(at) !== thisMonth) continue;
      const m = (r.module ?? 'pantry') as PurchaseModule;
      const cents = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
      per[m] = (per[m] ?? 0) + cents;
      total += cents;
      if (at.toISOString().slice(0, 10) === todayKey) today += cents;
    }
    return { perModuleSpent: per, spentTotal: total, spentToday: today };
  }, [recent, thisMonth, todayKey]);

  const budgets = (family?.householdBudgets ?? {}) as Record<string, number | undefined>;
  const plan = family?.pulsePlan;
  const planTarget = plan?.targetSavingsCents ?? 0;
  const planBaseline = plan?.baselineByModule ?? {};
  const planCaps = plan?.perModuleCapCents ?? {};

  // Recovery overrides — parent-set temporary trims on a module's cap, with
  // a 14-day expiry by default. Stored on pulsePlan.tempCapOverrides so we
  // don't touch family.householdBudgets directly (the cap there stays the
  // "true" plan; this is a time-bounded override the Live tab applies).
  type Override = { capCents: number; until: number; setBy: string; setAt: number; reason?: string };
  const planAny = plan as unknown as { tempCapOverrides?: Record<string, Override> } | undefined;
  const overrides: Record<string, Override> = planAny?.tempCapOverrides ?? {};
  const nowMs = now.getTime();
  const activeOverrideEntries = Object.entries(overrides).filter(([, o]) => o && o.until > nowMs) as Array<[string, Override]>;
  const activeOverridesMap: Record<string, Override> = Object.fromEntries(activeOverrideEntries);

  // Per-bucket rows + totals. Effective cap = active override (if any), else
  // the household budget.
  const rows = useMemo<BucketRow[]>(() => {
    return LIVE_MODULES.map((m) => {
      const spent = perModuleSpent[m] ?? 0;
      const baseCap = budgets[m] ?? 0;
      const ov = activeOverridesMap[m];
      const budget = ov ? ov.capCents : baseCap;
      const projected = projectMonthSpendCents(spent, dayOfMonth, daysInMonth);
      const projectedSave = budget - projected;
      const planSave = Math.max(0, (planBaseline[m] ?? 0) - (planCaps[m] ?? budgets[m] ?? 0));
      const status = statusFor(projectedSave, planSave, budget, spent);
      const leftInBudget = budget - spent;
      return { m, spent, budget, projected, projectedSave, planSave, status, leftInBudget };
    }).filter((r) => r.budget > 0 || r.spent > 0);
  }, [perModuleSpent, budgets, planBaseline, planCaps, dayOfMonth, daysInMonth, activeOverridesMap]);

  // Write a new override (14-day default) or clear one. We patch only
  // pulsePlan.tempCapOverrides — the wider plan stays intact.
  const writeOverrides = async (next: Record<string, Override>): Promise<boolean> => {
    if (!profile?.familyId || !plan) return false;
    try {
      await updateFamily(profile.familyId, { pulsePlan: { ...plan, tempCapOverrides: next } } as Parameters<typeof updateFamily>[1]);
      return true;
    } catch { return false; }
  };
  const tryRecovery = async (m: PurchaseModule, trimmedCapCents: number) => {
    if (busyRecovery) return;
    setBusyRecovery(m); setRecoveryFlash(null);
    const ok = await writeOverrides({ ...overrides, [m]: {
      capCents: Math.max(0, trimmedCapCents),
      until: nowMs + 14 * 24 * 3600 * 1000,
      setBy: profile?.uid ?? '',
      setAt: nowMs,
      reason: 'Recovery move',
    }});
    setRecoveryFlash(ok ? `✓ ${MODULE_LABEL[m]} cap trimmed for 14 days` : '⚠ Could not save — try again');
    setTimeout(() => setRecoveryFlash(null), 3500);
    setBusyRecovery(null);
  };
  const clearOverride = async (m: PurchaseModule) => {
    if (busyRecovery) return;
    setBusyRecovery(m);
    const next = { ...overrides };
    delete next[m];
    const ok = await writeOverrides(next);
    setRecoveryFlash(ok ? `✓ ${MODULE_LABEL[m]} cap restored` : '⚠ Could not save — try again');
    setTimeout(() => setRecoveryFlash(null), 3500);
    setBusyRecovery(null);
  };

  const totalBudget = LIVE_MODULES.reduce((s, m) => s + (budgets[m] ?? 0), 0);
  const totalProjected = projectMonthSpendCents(spentTotal, dayOfMonth, daysInMonth);
  const totalProjectedSave = Math.max(0, totalBudget - totalProjected);
  const pctOfPlan = planTarget > 0 ? Math.min(100, Math.round((totalProjectedSave / planTarget) * 100)) : 0;
  const planGap = Math.max(0, planTarget - totalProjectedSave);
  const totalLeftInBudget = Math.max(0, totalBudget - spentTotal);
  const monthPct = Math.round((dayOfMonth / daysInMonth) * 100);
  const spendPct = totalBudget > 0 ? Math.round((spentTotal / totalBudget) * 100) : 0;
  const buffer = monthPct - spendPct; // +ve = banking a buffer

  // Today's allowance — what's left this month ÷ days left, minus today's spend.
  const todayAllowanceRaw = Math.max(0, Math.round((totalBudget - spentTotal) / daysLeft) - spentToday);
  const todayAllowanceCap = Math.max(1, Math.round((totalBudget - spentTotal) / daysLeft));
  const todayPct = Math.min(100, Math.round((spentToday / todayAllowanceCap) * 100));

  // Recovery moves — top overshooting buckets. Carries `cap` so "Try it"
  // can compute the trimmed cap = round(cap * 0.9). Skips buckets that
  // already have an active override (they're listed in the banner above).
  const recoveries = useMemo(() => {
    return rows
      .filter((r) => (r.status === 'watch' || r.status === 'over') && !activeOverridesMap[r.m])
      .sort((a, b) => (b.projected - b.budget) - (a.projected - a.budget))
      .slice(0, 3)
      .map((r) => {
        const overBy = Math.max(0, r.projected - r.budget);
        return {
          m: r.m,
          cap: r.budget,
          title: `${MODULE_EMOJI[r.m]} Trim ${MODULE_LABEL[r.m]} cap by 10%`,
          impact: Math.round(r.projected * 0.10),
          note: overBy > 0 ? `clears ≈ ${formatCents(Math.min(overBy, r.projected * 0.10), currency)} of the overshoot` : 'tightens pace before it slips',
        };
      });
  }, [rows, currency, activeOverridesMap]);

  // Where it lands — 80/15/5 default split of projected save.
  const landing = useMemo(() => {
    const t = totalProjectedSave;
    return {
      wealth: Math.round(t * 0.80),
      rollover: Math.round(t * 0.15),
      reserve: Math.round(t * 0.05),
    };
  }, [totalProjectedSave]);

  if (profile && profile.role !== 'parent') {
    return <div className="mx-auto max-w-md px-4 pt-16 text-center text-hive-muted text-sm">Redirecting…</div>;
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <PulseHeader
        back={{ href: '/pulse', label: 'Dashboard' }}
        eyebrow="📩 Savings Analytics"
        title="Savings Analytics"
        subtitle={`Sun · ${monthShort()}`}
      />

      {/* Tab strip — Live is this page, Plan navigates to /pulse/plan */}
      <div className="mt-3 flex bg-white border border-pulse-gold/30 rounded-2xl p-1">
        <button className="flex-1 py-2 rounded-xl font-nunito font-black text-[12px]" style={{ background: NAVY, color: GOLD }}>
          📈 Live · this month
        </button>
        <Link href="/pulse/plan" className="flex-1 py-2 rounded-xl font-nunito font-black text-[12px] text-center text-hive-muted no-underline">
          🎯 Plan
        </Link>
      </div>

      {/* HERO — projection (narrated v3) */}
      <div className="mt-3 rounded-2xl p-4 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, #1c3566)` }}>
        <div className="text-[10px] font-black uppercase tracking-[1px]" style={{ color: GOLD }}>
          Projected by {new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} · run-rate
        </div>
        <div className="text-3xl font-nunito font-black mt-1">
          {totalProjectedSave >= planTarget && planTarget > 0
            ? <>Save ≈ {formatCentsBudgetNeat(totalProjectedSave, currency)}</>
            : <>Save ≈ {formatCentsBudgetNeat(totalProjectedSave, currency)}</>}
        </div>
        <p className="text-[12px] mt-2 leading-snug font-bold opacity-95">
          {planTarget > 0 ? (
            <>Your plan is <b style={{ color: GOLD }}>{formatCentsBudgetNeat(planTarget, currency)} / mo</b> — you&apos;re{' '}
              <b style={{ color: GOLD }}>{pctOfPlan}% on track</b>
              {planGap > 0 ? <>, <b>{formatCentsBudgetNeat(planGap, currency)} short</b> of goal. Recovery moves below close the gap.</> : <> — <b>on track ✓</b>.</>}
            </>
          ) : (
            <>No plan target set. <Link href="/pulse/plan" className="underline" style={{ color: GOLD }}>Set one →</Link></>
          )}
        </p>
        {planTarget > 0 && (
          <div className="mt-2 flex h-[18px] rounded-full overflow-hidden text-[9px] font-black">
            <span className="flex items-center justify-center" style={{ background: GOLD, color: '#3a2c08', width: `${pctOfPlan}%` }}>
              {pctOfPlan}% · {formatCentsBudgetNeat(totalProjectedSave, currency)}
            </span>
            {pctOfPlan < 100 && (
              <span className="flex items-center justify-center" style={{ background: 'rgba(255,255,255,.1)', color: '#fff', width: `${100 - pctOfPlan}%` }}>
                {100 - pctOfPlan}% · {formatCentsBudgetNeat(planGap, currency)} short
              </span>
            )}
          </div>
        )}
        <p className="text-[9.5px] font-bold opacity-80 mt-2">
          Day {dayOfMonth} of {daysInMonth} · {monthPct}% of month elapsed · spent {spendPct}% of budget{' '}
          <span style={{ color: '#aab4c1' }}>({formatCentsBudgetNeat(totalLeftInBudget, currency)} left to spend)</span>
          {buffer > 0 ? <> — banking a small buffer.</> : buffer < 0 ? <> — running ahead of pace.</> : null}
        </p>
      </div>

      {/* SURPRISE #1 — TODAY'S ALLOWANCE */}
      <div className="mt-3 rounded-2xl p-3 relative" style={{ background: '#FFF3D9', border: '1px solid #F0D38A' }}>
        <span className="absolute -top-2 right-3 text-[8px] font-black px-2 py-[2px] rounded-full text-white" style={{ background: 'linear-gradient(135deg,#9B5DE5,#FF6B6B)' }}>✨ NEW</span>
        <div className="text-[10px] font-black uppercase tracking-[1px]" style={{ color: GOLD_DK }}>Today&apos;s allowance · live</div>
        <p className="text-[12px] font-bold mt-1 leading-snug" style={{ color: NAVY }}>
          You can still spend <b>{formatCentsBudgetNeat(todayAllowanceRaw, currency)}</b> today and stay on plan.
          {spentToday > 0 && <> Already spent <b>{formatCentsBudgetNeat(spentToday, currency)}</b> today.</>}
        </p>
        <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: '#F0D38A' }}>
          <div className="h-full rounded-full" style={{ width: `${todayPct}%`, background: GOLD }} />
        </div>
        <p className="text-[9.5px] font-bold mt-1" style={{ color: '#876009' }}>Resets at midnight · unspent rolls into tomorrow.</p>
      </div>

      {/* PER BUCKET — narrated v3 */}
      <div className="text-[10px] font-black uppercase tracking-[1px] mt-4 mb-2 text-pulse-navy">Per bucket · plain English</div>
      {rows.length === 0 ? (
        <div className="bg-white border border-pulse-gold/30 rounded-2xl p-5 text-center text-sm text-hive-muted">
          No closed spend yet this month — projections appear once requests start closing.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const sp = statusPill(r.status);
            const left = r.leftInBudget; // can be negative
            const isOver = r.status === 'over' || r.status === 'watch';
            return (
              <div key={r.m} className="bg-white rounded-xl p-3" style={{ border: '1px solid #E8DEC9', borderLeftWidth: '4px', borderLeftStyle: 'solid', borderLeftColor: sp.color }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base flex-shrink-0">{MODULE_EMOJI[r.m]}</span>
                  <span className="font-nunito font-black text-[13px] text-pulse-navy">{MODULE_LABEL[r.m]}</span>
                  <span className="ml-auto text-[9px] font-black px-2 py-1 rounded-full uppercase tracking-wide" style={{ background: sp.bg, color: sp.color }}>
                    {sp.label}
                  </span>
                </div>
                <p className="text-[11.5px] leading-snug font-semibold" style={{ color: NAVY }}>
                  Spent <b>{formatCentsBudgetNeat(r.spent, currency)}</b> of <b>{r.budget > 0 ? formatCentsBudgetNeat(r.budget, currency) : 'no cap'}</b> budgeted.
                  {' '}At this pace → projected spend <b>{formatCentsBudgetNeat(r.projected, currency)}</b>
                  {r.budget > 0 && (
                    <span style={{ color: SOFT, fontWeight: 600 }}> ({formatCentsBudgetNeat(Math.max(0, left), currency)} {isOver ? 'left in budget' : 'left to spend'})</span>
                  )}
                  {r.projectedSave >= 0 ? (
                    <>, save <b style={{ color: GREEN }}>{formatCentsBudgetNeat(r.projectedSave, currency)}</b>.</>
                  ) : (
                    <> — <b style={{ color: CORAL }}>over by {formatCentsBudgetNeat(-r.projectedSave, currency)}</b>.</>
                  )}
                </p>
                {r.planSave > 0 && (
                  <p className="text-[11px] leading-snug font-semibold mt-1" style={{ color: '#5C6975' }}>
                    Plan: save <b style={{ color: NAVY }}>{formatCentsBudgetNeat(r.planSave, currency)}</b> →{' '}
                    {r.projectedSave >= r.planSave ? (
                      <b style={{ color: GREEN }}>
                        {r.projectedSave > r.planSave
                          ? `ahead by ${formatCentsBudgetNeat(r.projectedSave - r.planSave, currency)} (+${Math.round(((r.projectedSave - r.planSave) / r.planSave) * 100)}%)`
                          : 'on track (+0%)'}
                      </b>
                    ) : (
                      <b style={{ color: CORAL }}>{formatCentsBudgetNeat(r.planSave - Math.max(0, r.projectedSave), currency)} off plan</b>
                    )}
                    {r.status === 'over' && <> · Top of the Recovery list.</>}
                    {r.status === 'watch' && <> · See Recovery below.</>}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Active recovery moves — parent-set temp caps with days remaining +
          Clear button. Sits ABOVE the suggestions so it's clear what's on. */}
      {activeOverrideEntries.length > 0 && (
        <div className="mt-3 rounded-2xl p-3" style={{ background: '#FFF8E0', border: '1px solid #F0D38A' }}>
          <div className="text-[10px] font-black uppercase tracking-[1px]" style={{ color: GOLD_DK }}>Active recovery moves</div>
          <div className="mt-2 flex flex-col gap-1.5">
            {activeOverrideEntries.map(([m, ov]) => {
              const daysLeft = Math.max(1, Math.ceil((ov.until - nowMs) / (24 * 3600 * 1000)));
              const mk = m as PurchaseModule;
              return (
                <div key={m} className="flex items-center gap-2 bg-white rounded-xl px-2.5 py-2" style={{ border: '1px solid #F0D38A' }}>
                  <span className="text-base flex-shrink-0">{MODULE_EMOJI[mk]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-black" style={{ color: NAVY }}>{MODULE_LABEL[mk]} cap → {formatCentsBudgetNeat(ov.capCents, currency)}</div>
                    <div className="text-[9px] font-bold text-hive-muted">{daysLeft}d remaining · ends {new Date(ov.until).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => clearOverride(mk)}
                    disabled={busyRecovery === mk}
                    className="text-[10px] font-black px-2.5 py-1 rounded-full bg-white disabled:opacity-50"
                    style={{ color: GOLD_DK, border: '1px solid #F0D38A' }}
                  >
                    {busyRecovery === mk ? '…' : 'Clear'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Flash banner — success/failure on Try-it or Clear. */}
      {recoveryFlash && (
        <div className="mt-3 rounded-xl px-3 py-2 text-[12px] font-bold" style={{ background: '#FFF8E0', color: GOLD_DK, border: '1px solid #F0D38A' }}>
          {recoveryFlash}
        </div>
      )}

      {/* SURPRISE #2 — RECOVERY MOVES · suggestions */}
      {recoveries.length > 0 && (
        <div className="mt-4 rounded-2xl p-3 relative" style={{ background: '#FDE6E6', border: '1px solid #F3BCBC' }}>
          <span className="absolute -top-2 right-3 text-[8px] font-black px-2 py-[2px] rounded-full text-white" style={{ background: 'linear-gradient(135deg,#9B5DE5,#FF6B6B)' }}>✨ NEW</span>
          <div className="text-[10px] font-black uppercase tracking-[1px]" style={{ color: CORAL }}>
            Recovery moves{planGap > 0 ? ` · close the ${formatCentsBudgetNeat(planGap, currency)} gap` : ''}
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {recoveries.map((rec) => (
              <div key={rec.m} className="bg-white rounded-xl px-3 py-2.5" style={{ border: '1px dashed #F3BCBC' }}>
                <p className="text-[11.5px] font-semibold leading-snug" style={{ color: NAVY }}>
                  <b>{rec.title}</b> · saves ≈ <b style={{ color: GREEN }}>{formatCentsBudgetNeat(rec.impact, currency)}</b> · {rec.note}.
                </p>
                <div className="mt-1.5">
                  <button
                    type="button"
                    onClick={() => tryRecovery(rec.m, Math.round(rec.cap * 0.9))}
                    disabled={busyRecovery === rec.m}
                    className="inline-block text-[10px] font-black px-3 py-1.5 rounded-full text-white disabled:opacity-50"
                    style={{ background: CORAL }}
                  >
                    {busyRecovery === rec.m ? 'Saving…' : 'Try it ›'}
                  </button>
                  <span className="ml-2 text-[9px] font-bold" style={{ color: SOFT }}>14d temp cap · clearable above</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SURPRISE #3 — WHERE IT LANDS */}
      {totalProjectedSave > 0 && (
        <div className="mt-3 rounded-2xl p-3 relative" style={{ background: '#EEF3FB', border: '1px solid #CFDDEC' }}>
          <span className="absolute -top-2 right-3 text-[8px] font-black px-2 py-[2px] rounded-full text-white" style={{ background: 'linear-gradient(135deg,#9B5DE5,#FF6B6B)' }}>✨ NEW</span>
          <div className="text-[10px] font-black uppercase tracking-[1px]" style={{ color: '#264B6E' }}>
            On {new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} · where it lands
          </div>
          <p className="text-[11px] font-semibold mt-1 leading-snug" style={{ color: NAVY }}>
            Your <b>{formatCentsBudgetNeat(totalProjectedSave, currency)} projected save</b> sweeps into:
          </p>
          <div className="mt-2 flex flex-col gap-1">
            <LandingRow icon="💎" name="Kaya Wealth deposit" sub="80% · auto-sweep" amount={landing.wealth} currency={currency} />
            <LandingRow icon="🗓️" name={`Rollover · ${new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'long' })} buffer`} sub="15% · cushion for fixed bills" amount={landing.rollover} currency={currency} />
            <LandingRow icon="🛟" name="Emergency reserve" sub="5% · safety top-up" amount={landing.reserve} currency={currency} />
          </div>
          <p className="text-[9.5px] mt-2" style={{ color: SOFT }}>Editable destination split coming next.</p>
        </div>
      )}
    </div>
  );
}

function LandingRow({ icon, name, sub, amount, currency }: { icon: string; name: string; sub: string; amount: number; currency: string }) {
  return (
    <div className="flex items-center gap-2 bg-white rounded-xl px-2.5 py-2 border border-[#CFDDEC]">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#EEF3FB] text-sm flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-black text-pulse-navy">{name}</div>
        <div className="text-[9px] font-bold text-hive-muted">{sub}</div>
      </div>
      <div className="text-[12px] font-black" style={{ color: GREEN }}>+{formatCentsBudgetNeat(amount, currency)}</div>
    </div>
  );
}
