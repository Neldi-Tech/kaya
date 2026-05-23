'use client';

// /pulse/plan — Kaya Pulse · Savings plan (parent-only).
//
// Set a target — either a TZS amount to save per month or a % to cut — and Kaya
// resolves it to per-bucket caps (written to householdBudgets) against a recent-
// spend baseline. Then track against it: saved-so-far (prorated), a run-rate
// month-end projection vs the goal, and per-bucket pacing flags.

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
import { type PulsePlan, resolvePlan, suggestFocusModules, ROUND_STEPS, suggestRoundStep } from '@/lib/pulse';

const PLAN_MODULES: PurchaseModule[] = ['pantry', 'outdoor', 'drivers', 'utility', 'home'];
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

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <PulseHeader back={{ href: '/pulse', label: 'Dashboard' }} eyebrow="Savings plan" title="Save with a plan" subtitle="Set a monthly target, then track against it." />

      {plan && <PlanTracking plan={plan} caps={family?.householdBudgets} spent={spentThisMonth} currency={currency} />}

      <PlanSetup
        familyId={profile?.familyId ?? ''}
        baseline={baseline}
        existing={plan}
        currentCaps={family?.householdBudgets}
        currency={currency}
      />
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
        householdBudgets: { ...(currentCaps ?? {}), ...caps },
        pulsePlan: nextPlan,
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

      <button onClick={save} disabled={saving} className="w-full mt-3 bg-pulse-navy text-pulse-gold rounded-2xl py-3 font-nunito font-black text-sm disabled:opacity-50">
        {saving ? 'Saving…' : saved ? '✓ Plan saved' : 'Save plan'}
      </button>
      <p className="text-[10px] text-hive-muted text-center mt-2 leading-snug">
        Caps write to your <Link href="/pantry/budget" className="text-pulse-gold-dk font-bold underline">household budget</Link>; tracking uses real spend vs these caps.
      </p>
    </div>
  );
}
