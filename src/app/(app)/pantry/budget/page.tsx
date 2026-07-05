'use client';

// /pantry/budget — Household → Per-module Budget (v3, 2026-05-19).
//
// Five module caps + their rolling current-month spend, derived from
// every CLOSED PurchaseRequest. Each card opens a per-module COMPOSER
// (/pantry/budget/compose/{module}) instead of a flat number input —
// the cap is now built up from structured line items in their natural
// cadence (Pantry: weekly × 4 staples; Drivers: per-vehicle; …).
//
// v1 only rendered Pantry; v2 added the other four. v3 (this pass)
// replaces the inline cap editor with the composer + adds an
// auto-suggest "starter pack" CTA at the top for first-time setup.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, type PurchaseModule, subscribeToRecentRequests,
  budgetMonthKeyFor,
} from '@/lib/purchase';
import { subscribeToSpendLedger, type SpendLedgerEntry } from '@/lib/spendLedger';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import {
  buildStarterComposer, saveFullComposer, computeModuleMonthly,
  recentMonthlyAverage, suggestCapAdjustment,
  type StarterInput,
} from '@/lib/budgetComposer';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { subscribeToChildren, type Child } from '@/lib/firestore';
import { subscribeToVehicles, type Vehicle } from '@/lib/vehicles';
import { subscribeToMeters, type UtilityMeter } from '@/lib/utilityMeters';
import { listHelpers } from '@/lib/helpers';
import type { HelperLink } from '@/lib/firestore';

const monthKey = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date = new Date()) =>
  d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// Per-module visual + label config. Tints follow the rest of the app:
// leaf for Pantry + Outdoor, honey for Utility, blue for Drivers, purple
// for Payroll. Over-budget swaps to a rose tint for every module so the
// danger signal is consistent.
const MODULE_CARDS: {
  id: PurchaseModule;
  emoji: string;
  label: string;
  tint: string;
  border: string;
  eyebrow: string;
}[] = [
  { id: 'pantry',  emoji: '🛒', label: 'Pantry',   tint: 'bg-pantry-leaf-soft', border: 'border-pantry-leaf',           eyebrow: 'text-pantry-leaf-dk' },
  { id: 'outdoor', emoji: '🌿', label: 'Outdoor',  tint: 'bg-[#E6F2EC]',         border: 'border-pantry-leaf',           eyebrow: 'text-pantry-leaf-dk' },
  { id: 'drivers', emoji: '🚗', label: 'Drivers',  tint: 'bg-[#E5EFF8]',         border: 'border-[#B5CFE5]',             eyebrow: 'text-hive-blue'      },
  { id: 'utility', emoji: '⚡', label: 'Utility',  tint: 'bg-[#FFF3D9]',         border: 'border-hive-honey',            eyebrow: 'text-hive-honey-dk'  },
  { id: 'payroll', emoji: '🤝', label: 'Payroll',  tint: 'bg-[#F4EFFB]',         border: 'border-[#C9B8E5]',             eyebrow: 'text-[#5E4A8F]'      },
  { id: 'dineOut', emoji: '🍽️', label: 'Dine Out', tint: 'bg-[#FBEAE0]',         border: 'border-[#E8C3AE]',             eyebrow: 'text-[#C2562E]'      },
  { id: 'home',    emoji: '🛋️', label: 'Home & Wellness', tint: 'bg-[#F6EBDD]', border: 'border-[#E0C4A3]', eyebrow: 'text-[#9B6B3F]' },
  // Subs + Contribs surfaced 2026-05-27. Spend comes from spend_ledger
  // (sub cycles marked paid; contributions logged), NOT purchaseRequests
  // — see spentByModule below. The composer for these is the flat
  // dineOut/home shape (single monthly number).
  { id: 'subscriptions', emoji: '🔁', label: 'Subscriptions', tint: 'bg-pulse-cream',   border: 'border-pulse-navy/20', eyebrow: 'text-pulse-navy' },
  { id: 'contributions', emoji: '🤲', label: 'Contributions', tint: 'bg-pulse-gold/10', border: 'border-pulse-gold/35', eyebrow: 'text-pulse-gold' },
];

export default function BudgetPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const isParent = profile?.role === 'parent';

  // Budget is parent-only (household money policy). Helpers shouldn't see
  // spend totals OR the cap. Bounce them back to the Pantry home, and
  // render a polite blocker below for the brief moment between role
  // detection and the redirect firing.
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry');
  }, [profile, router]);

  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [ledger, setLedger] = useState<SpendLedgerEntry[]>([]);
  useEffect(() => {
    if (!profile?.familyId) return;
    if (profile.role !== 'parent') return; // don't subscribe for non-parents
    const u1 = subscribeToRecentRequests(profile.familyId, setRecent);
    // Spend_ledger carries Subscriptions + Contributions (one entry per
    // paid cycle / logged contribution). Mirrors the Finances rollup so
    // the spend bar on those two cards reflects real numbers.
    const u2 = subscribeToSpendLedger(profile.familyId, setLedger);
    return () => { u1(); u2(); };
  }, [profile?.familyId, profile?.role]);

  // Auto-suggest sheet open state. Reads kids / helpers / vehicles /
  // meters reactively; user can tweak the count inputs before applying.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [savingSuggest, setSavingSuggest] = useState(false);

  // Family-size signals — kept in module state because the suggest
  // sheet may bump these manually before generating the starter pack.
  const [kids, setKids] = useState<Child[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [meters, setMeters] = useState<UtilityMeter[]>([]);
  const [helpers, setHelpers] = useState<HelperLink[]>([]);
  // Editable counts on the suggest sheet — start from the auto-detected
  // numbers, then the parent can tweak (e.g. "we have 5 kids actually").
  const [draftAdults, setDraftAdults] = useState(2);
  const [draftKids, setDraftKids] = useState(0);
  const [draftHelpers, setDraftHelpers] = useState(0);

  // Subscribe once the user opens the suggest sheet — avoids paying
  // for these subscriptions for parents who never use auto-suggest.
  useEffect(() => {
    if (!profile?.familyId || !suggestOpen) return;
    const unsubKids = subscribeToChildren(profile.familyId, setKids);
    const unsubVeh = subscribeToVehicles(profile.familyId, (vs) =>
      setVehicles(vs.filter((v) => v.active !== false)));
    const unsubMet = subscribeToMeters(profile.familyId, (ms) =>
      setMeters(ms.filter((m) => m.active !== false)));
    let active = true;
    (async () => {
      try {
        const list = await listHelpers(profile.familyId!);
        if (active) setHelpers(list.filter((h) => h.status !== 'removed'));
      } catch { if (active) setHelpers([]); }
    })();
    return () => { unsubKids(); unsubVeh(); unsubMet(); active = false; };
  }, [profile?.familyId, suggestOpen]);

  // Sync the editable counts when the detected numbers change.
  useEffect(() => {
    setDraftKids(kids.length);
  }, [kids.length]);
  useEffect(() => {
    setDraftHelpers(helpers.length);
  }, [helpers.length]);

  if (profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg">Budget is parent-only</h2>
        <p className="text-hive-muted text-sm mt-2 mb-4">
          Household budgets are visible to parents in the family. Ask a parent to share what's relevant.
        </p>
        <Link href="/pantry" className="text-pantry-leaf-dk font-nunito font-bold text-sm underline">
          ← Back to Pantry
        </Link>
      </div>
    );
  }

  // Only count CLOSED requests in the current month — rejected requests
  // don't move money, and prior months belong to history.
  const thisMonth = monthKey();
  const closedThisMonth = useMemo(
    () => recent.filter((r) => {
      if (r.status !== 'closed') return false;
      return budgetMonthKeyFor(r) === thisMonth;
    }),
    [recent, thisMonth],
  );

  // Spent per module — sum of actualTotalCents (fallback to estimated
  // when actual is missing). Module field defaults to 'pantry' for back-
  // compat with very old docs created before the module discriminator.
  // Subscriptions + Contributions don't go through purchaseRequests; we
  // pull their spend from spend_ledger entries (current month, household-
  // money only — professional expenses excluded).
  const spentByModule = useMemo(() => {
    const acc: Record<PurchaseModule, number> = {
      pantry: 0, outdoor: 0, drivers: 0, utility: 0, payroll: 0, dineOut: 0, home: 0,
      subscriptions: 0, contributions: 0,
    };
    for (const r of closedThisMonth) {
      const m = (r.module ?? 'pantry') as PurchaseModule;
      acc[m] += r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
    }
    for (const e of ledger) {
      if (e.isProfessionalExpense) continue;
      const at = e.occurredOn?.toDate?.();
      if (!at || monthKey(at) !== thisMonth) continue;
      const m = e.sourceModule as PurchaseModule;
      if (m in acc) acc[m] += e.amountHousehold || 0;
    }
    return acc;
  }, [closedThisMonth, ledger, thisMonth]);

  // Rolling-average spend per module — drives the "reality-check"
  // auto-tune banner under each card. (Phase 2, 2026-05-19.)
  const rollingAverages = useMemo(() => recentMonthlyAverage(recent, { monthsBack: 3 }), [recent]);

  /** One-tap apply: bump the module's cap to match the rolling average.
   *  Writes ONLY the cap (householdBudgets) — leaves the composer
   *  state untouched so the parent can later "open the composer" and
   *  rebalance lines manually. We surface this as a fast path for
   *  "yeah just match reality" rather than a structured re-edit. */
  const applyCapAdjustment = async (m: PurchaseModule, newCents: number) => {
    if (!profile?.familyId || isGuest) return;
    await updateDoc(doc(db, 'families', profile.familyId), {
      [`householdBudgets.${m}`]: newCents,
    });
  };

  // Caps map — read from family.householdBudgets, missing keys = 0.
  const caps: Record<PurchaseModule, number> = {
    pantry:        family?.householdBudgets?.pantry        ?? 0,
    outdoor:       family?.householdBudgets?.outdoor       ?? 0,
    drivers:       family?.householdBudgets?.drivers       ?? 0,
    utility:       family?.householdBudgets?.utility       ?? 0,
    payroll:       family?.householdBudgets?.payroll       ?? 0,
    dineOut:       family?.householdBudgets?.dineOut       ?? 0,
    home:          family?.householdBudgets?.home          ?? 0,
    subscriptions: family?.householdBudgets?.subscriptions ?? 0,
    contributions: family?.householdBudgets?.contributions ?? 0,
  };

  // Open the per-module composer route. Each module has its own
  // tailored editor — Pantry/Outdoor by free-form lines, Drivers by
  // vehicle, Utility by meter, Payroll by helper.
  const openComposer = (m: PurchaseModule) => {
    router.push(`/pantry/budget/compose/${m}`);
  };

  // Build + show the starter-pack preview. Numbers are derived from
  // family-size detected automatically (kids, helpers, vehicles, meters)
  // and the user-tweakable adult count.
  const previewStarter = useMemo(() => {
    const input: StarterInput = {
      adultsCount: Math.max(1, draftAdults),
      kidsCount: Math.max(0, draftKids),
      helpersCount: helpers.length,
      vehicles: vehicles.map((v) => ({ id: v.id, label: v.label, type: v.type })),
      meters: meters.map((m) => ({ id: m.id, type: m.type, label: m.label || m.type })),
      helpers: helpers.slice(0, draftHelpers).map((h) => ({ uid: h.uid, displayName: h.displayName })),
    };
    return buildStarterComposer(input, currency);
  }, [draftAdults, draftKids, draftHelpers, helpers, vehicles, meters, currency]);

  const applyStarter = async () => {
    if (!profile?.familyId || isGuest) return;
    setSavingSuggest(true);
    try {
      await saveFullComposer(profile.familyId, previewStarter);
      setSuggestOpen(false);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[budget] applyStarter failed:', e);
    } finally {
      setSavingSuggest(false);
    }
  };

  // Roll-up totals for the header strip.
  const totalSpent = MODULE_CARDS.reduce((sum, m) => sum + spentByModule[m.id], 0);
  const totalCap = MODULE_CARDS.reduce((sum, m) => sum + caps[m.id], 0);
  // Savings as COMMENTARY (decoupled, 2026-05-23): how much the caps sit
  // below the family's recent average — i.e. what the budget plan implies
  // you'll save. Derived only; never changes the caps. (Elia: "given the
  // budget plans, we are to save x".)
  const totalBaseline = MODULE_CARDS.reduce((sum, m) => sum + (rollingAverages.averages[m.id] ?? 0), 0);
  const plannedSavings = Math.max(0, totalBaseline - totalCap);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
            Household · Budget
          </p>
          {/* Household Setup hub — the one gear (Drivers v2, 2026-07-05). */}
          <Link
            href="/pantry/setup"
            className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk bg-hive-paper border border-hive-line rounded-full px-2.5 py-1 no-underline hover:border-pantry-leaf"
          >
            🛠️ Setup
          </Link>
        </div>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          {monthLabel()}
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          Per-module caps roll into Household Finances. Set a cap per module — the spend bar tracks the current month's closed shops.
        </p>
      </div>

      {/* Roll-up strip — only when at least one cap is set. Helps the
          parent see the household's monthly money posture at a glance. */}
      {totalCap > 0 && (
        <div className="mt-4 bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">All modules · this month</p>
            <p className="font-nunito font-black text-lg text-hive-ink mt-0.5">
              {formatCents(totalSpent, currency)}
              <span className="text-hive-muted text-xs font-bold">
                {' '}of {formatCents(totalCap, currency)}
              </span>
            </p>
          </div>
          <div className={`text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] px-2.5 py-1 rounded-full ${
            totalSpent > totalCap ? 'bg-[#FCEAEA] text-hive-rose' : 'bg-pantry-leaf-soft text-pantry-leaf-dk'
          }`}>
            {totalCap > 0 ? Math.round((totalSpent / totalCap) * 100) : 0}%
          </div>
        </div>
      )}

      {/* Savings commentary — derived from the budget, doesn't change it. */}
      {totalCap > 0 && plannedSavings > 0 && rollingAverages.monthsCounted >= 1 && (
        <div className="mt-2 bg-[#f3faf6] border border-[#bfe0d0] rounded-hive p-3">
          <p className="text-[12.5px] font-bold text-pantry-leaf-dk leading-snug">
            💰 Given your budget plans, you’re set to save ≈ <span className="font-nunito font-black">{formatCents(plannedSavings, currency)}/mo</span>
            <span className="text-hive-muted font-bold"> — your caps sit that much below your recent {rollingAverages.monthsCounted}-month average.</span>
          </p>
          <p className="text-[10px] text-hive-muted mt-1">
            A target, not a cap change. Track what you actually save month-by-month in <Link href="/pulse/plan" className="text-pulse-gold-dk font-bold underline">Pulse · Savings</Link>.
          </p>
        </div>
      )}

      {/* Auto-suggest CTA — first thing parents see. Tap opens the
          starter-pack sheet (numbers derived from family-size signals).
          Only shows when at LEAST ONE module is uncapped — once every
          module has a cap, we hide it so the home stays clean. */}
      {isParent && Object.values(caps).some((c) => !c || c <= 0) && (
        <button
          type="button"
          onClick={() => setSuggestOpen(true)}
          className="w-full mt-4 bg-gradient-to-br from-[#FFF3D9] to-[#FCD9A0] border-2 border-hive-honey rounded-hive p-3 text-left flex items-center gap-3"
        >
          <span className="text-2xl">✨</span>
          <div className="flex-1 min-w-0">
            <div className="font-nunito font-black text-sm text-hive-honey-dk">Suggest a starter budget</div>
            <div className="text-[11px] text-hive-ink/80 font-bold mt-0.5">
              Based on your family + helpers + vehicles + meters
            </div>
          </div>
          <span className="font-nunito font-black text-hive-honey-dk text-lg">→</span>
        </button>
      )}

      {/* Per-module cards */}
      <div className="mt-4 flex flex-col gap-3">
        {MODULE_CARDS.map((m) => {
          const cap = caps[m.id];
          const spent = spentByModule[m.id];
          const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
          const over = cap > 0 && spent > cap;
          return (
            <div
              key={m.id}
              className={`rounded-hive border p-4 ${over ? 'bg-[#FCEAEA] border-[#E8B5B5]' : `${m.tint} ${m.border}`}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] ${over ? 'text-hive-rose' : m.eyebrow}`}>
                    {m.emoji} {m.label}
                  </p>
                  <p className="font-nunito font-black text-xl lg:text-2xl text-hive-ink mt-1">
                    {formatCents(spent, currency)}
                    <span className="text-hive-muted text-sm font-bold">
                      {' '}of {cap > 0 ? formatCents(cap, currency) : '—'}
                    </span>
                  </p>
                </div>
                {isParent && (
                  <button
                    onClick={() => openComposer(m.id)}
                    className="text-xs font-nunito font-bold text-pantry-leaf-dk bg-white border border-hive-line rounded-full px-3 py-1.5 flex-shrink-0"
                  >
                    {cap > 0 ? 'Edit cap' : 'Set cap'}
                  </button>
                )}
              </div>

              {/* Progress bar — only meaningful when a cap is set. */}
              {cap > 0 && (
                <div className="mt-3 h-2 bg-white/70 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${over ? 'bg-hive-rose' : 'bg-pantry-leaf-dk'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}

              {/* Auto-tune banner — shows when the rolling 3-month
                  average diverges from the current cap by >10%. The
                  banner offers a one-tap "match reality" bump, OR a
                  deep-link into the composer for a structured re-edit.
                  (Phase 2, 2026-05-19.) */}
              {isParent && (() => {
                const avg = rollingAverages.averages[m.id];
                const advice = suggestCapAdjustment(cap, avg, rollingAverages.monthsCounted);
                if (!advice) return null;
                return (
                  <AutoTuneBanner
                    direction={advice.direction}
                    suggested={advice.suggestedCapCents}
                    average={avg!}
                    currentCap={cap}
                    deltaPct={advice.deltaPct}
                    monthsCounted={rollingAverages.monthsCounted}
                    currency={currency}
                    onApply={() => applyCapAdjustment(m.id, advice.suggestedCapCents)}
                    onOpenComposer={() => openComposer(m.id)}
                  />
                );
              })()}

            </div>
          );
        })}
      </div>

      {/* Auto-suggest sheet — overlay that lets the parent review the
          starter-pack numbers + tweak counts before applying to all 5
          modules at once. (2026-05-19) */}
      {suggestOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end lg:items-center justify-center p-0 lg:p-6"
          onClick={() => !savingSuggest && setSuggestOpen(false)}
        >
          <div
            className="bg-hive-cream w-full max-w-md rounded-t-3xl lg:rounded-hive max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 pb-3 sticky top-0 bg-hive-cream border-b border-hive-line z-10">
              <div className="flex items-baseline justify-between">
                <h2 className="font-nunito font-black text-xl">✨ Starter budget</h2>
                <button
                  type="button"
                  onClick={() => !savingSuggest && setSuggestOpen(false)}
                  className="text-hive-muted text-xl font-nunito font-extrabold"
                  aria-label="Close"
                >×</button>
              </div>
              <p className="text-[12px] text-hive-muted mt-1">
                Based on your family setup. Numbers are editable in each module's composer after you apply.
              </p>
            </div>

            <div className="p-5 pt-3">
              {/* Family-size inputs */}
              <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">
                Your family
              </p>
              <div className="bg-hive-paper border border-hive-line rounded-hive p-3 space-y-2">
                <CountInput
                  label="Adults"
                  value={draftAdults}
                  onChange={setDraftAdults}
                  min={1}
                />
                <CountInput
                  label="Kids"
                  value={draftKids}
                  onChange={setDraftKids}
                  min={0}
                  detected={kids.length}
                />
                <CountInput
                  label="Helpers"
                  value={draftHelpers}
                  onChange={setDraftHelpers}
                  min={0}
                  max={helpers.length}
                  detected={helpers.length}
                />
                <DetectedRow label="Vehicles" count={vehicles.length} />
                <DetectedRow label="Meters" count={meters.length} />
              </div>

              {/* Suggested caps preview */}
              <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mt-4 mb-2">
                Suggested monthly caps
              </p>
              <div className="bg-hive-paper border-2 border-hive-honey rounded-hive p-3">
                {MODULE_CARDS.map((m) => {
                  const v = computeModuleMonthly(m.id, previewStarter);
                  return (
                    <div key={m.id} className="flex items-center justify-between py-1.5 border-b border-hive-line last:border-0 text-sm">
                      <span className="font-nunito font-extrabold">{m.emoji} {m.label}</span>
                      <span className={`font-nunito font-black ${v > 0 ? 'text-hive-ink' : 'text-hive-muted'}`}>
                        {v > 0 ? formatCentsBudgetNeat(v, currency) : '—'}
                      </span>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between pt-2 mt-1 border-t-2 border-hive-line text-sm">
                  <span className="font-nunito font-black">Total monthly</span>
                  <span className="font-nunito font-black text-base">
                    {formatCentsBudgetNeat(MODULE_CARDS.reduce((s, m) => s + computeModuleMonthly(m.id, previewStarter), 0), currency)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={applyStarter}
                disabled={savingSuggest}
                className="w-full mt-4 bg-pantry-leaf text-white rounded-hive py-3 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60"
              >
                {savingSuggest ? 'Applying…' : 'Apply starter pack →'}
              </button>
              <p className="text-[10px] text-hive-muted text-center mt-2">
                Tweak each module's lines after applying — tap any module to open its composer.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Closed requests this month — combined across all modules so the
          parent sees the full month at a glance. */}
      <div className="mt-6">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-2">
          Closed this month · {closedThisMonth.length}
        </p>
        {closedThisMonth.length === 0 ? (
          <div className="bg-hive-paper border border-hive-line rounded-hive p-5 text-center text-hive-muted text-sm">
            No purchases closed yet this month. They'll appear here as soon as a helper reconciles a shop.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {closedThisMonth.map((r) => {
              const total = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
              const m = MODULE_CARDS.find((x) => x.id === (r.module ?? 'pantry'));
              return (
                <Link
                  key={r.id}
                  href={`/pantry/purchase/${r.id}`}
                  className="bg-hive-paper border border-hive-line rounded-hive p-3.5 flex items-center gap-3 no-underline"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base ${m?.tint ?? 'bg-pantry-leaf-soft'}`}>
                    {m?.emoji ?? '🧾'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{r.name}</div>
                    <div className="text-[11px] text-hive-muted font-bold mt-0.5">
                      {m?.label ?? 'Pantry'} · {r.items.length} item{r.items.length === 1 ? '' : 's'} · closed {r.closedAt?.toDate?.().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                  <div className="font-nunito font-black text-sm text-hive-navy">
                    {formatCents(total, currency)}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Suggest-sheet helpers ──────────────────────────────────────

function CountInput({
  label, value, onChange, min, max, detected,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max?: number;
  detected?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 font-nunito font-extrabold text-sm">{label}</span>
      {detected != null && (
        <span className="text-[10px] font-nunito font-extrabold text-hive-muted">
          detected: {detected}
        </span>
      )}
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-7 h-7 rounded-full bg-hive-cream border border-hive-line font-nunito font-black text-sm"
      >−</button>
      <span className="w-8 text-center font-nunito font-black text-sm">{value}</span>
      <button
        type="button"
        onClick={() => onChange(max != null ? Math.min(max, value + 1) : value + 1)}
        className="w-7 h-7 rounded-full bg-hive-cream border border-hive-line font-nunito font-black text-sm"
      >＋</button>
    </div>
  );
}

function DetectedRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 font-nunito font-extrabold text-sm">{label}</span>
      <span className={`text-[11px] font-nunito font-extrabold ${count > 0 ? 'text-pantry-leaf-dk' : 'text-hive-muted'}`}>
        {count} {count === 1 ? 'detected' : 'detected'}
      </span>
    </div>
  );
}

// ── Auto-tune banner ───────────────────────────────────────────
// Surfaces under a module card when the cap is meaningfully off the
// last few months of actual spending. Two one-tap actions:
//   • "Match reality" — write the average to the cap directly
//   • "Edit lines" — open the composer for structured re-edit

function AutoTuneBanner({
  direction, suggested, average, currentCap, deltaPct, monthsCounted, currency,
  onApply, onOpenComposer,
}: {
  direction: 'up' | 'down';
  suggested: number;
  average: number;
  currentCap: number;
  deltaPct: number;
  monthsCounted: number;
  currency: string;
  onApply: () => void;
  onOpenComposer: () => void;
}) {
  const monthsLabel = monthsCounted === 1 ? 'last month' : `last ${monthsCounted} months`;
  const headline = direction === 'up'
    ? `Averaging ${deltaPct}% over cap`
    : `Spending ${deltaPct}% under cap`;
  const sub = direction === 'up'
    ? `Your ${monthsLabel} averaged ${formatCents(average, currency)}/mo — cap is ${formatCents(currentCap, currency)}.`
    : `Your ${monthsLabel} averaged ${formatCents(average, currency)}/mo — cap is ${formatCents(currentCap, currency)}.`;
  const tone = direction === 'up' ? 'bg-[#FCEAEA] border-[#E8B5B5] text-hive-rose' : 'bg-pantry-leaf-soft border-pantry-leaf text-pantry-leaf-dk';
  const buttonTone = direction === 'up' ? 'bg-hive-rose text-white' : 'bg-pantry-leaf text-white';
  return (
    <div className={`mt-3 rounded-xl border p-3 ${tone}`}>
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px]">
        💡 {headline}
      </p>
      <p className="text-[12px] font-nunito text-hive-ink/85 mt-0.5">{sub}</p>
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={onApply}
          className={`flex-1 ${buttonTone} rounded-lg py-2 font-nunito font-black text-xs`}
        >
          {direction === 'up' ? '↑' : '↓'} Match · {formatCents(suggested, currency)}/mo
        </button>
        <button
          type="button"
          onClick={onOpenComposer}
          className="bg-white border border-hive-line rounded-lg py-2 px-3 font-nunito font-extrabold text-xs text-hive-ink"
        >
          Edit lines →
        </button>
      </div>
    </div>
  );
}
