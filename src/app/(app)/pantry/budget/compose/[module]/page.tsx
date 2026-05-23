'use client';

// /pantry/budget/compose/[module] — Budget composer (v3, 2026-05-19).
//
// Per-module structured cap editor. Each module has its own shape:
//   pantry / outdoor — free-form lines (Fresh staples, Dry, Snacks…)
//   drivers          — per-vehicle block, each with fuel + service…
//   utility          — per-meter line with cadence
//   payroll          — per-helper monthly salary + "Other" lines
//
// On save we write the structured state to family.budgetComposer.{module}
// AND the computed monthly cap to family.householdBudgets[module]. The
// latter is a denormalized cache so every existing consumer (progress
// bars, finances roll-up) keeps working unchanged.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { formatCents, roundUpDisplay } from '@/components/pantry/format';
import NumberInput from '@/components/hive/NumberInput';
import { currencyAllowsDecimals } from '@/lib/hive';
import { type PurchaseModule, type PurchaseRequest, subscribeToRecentRequests } from '@/lib/purchase';
import {
  type BudgetLine, type BudgetCadence,
  saveModuleComposer, sumMonthlyCents, toMonthlyCents, emptyDefaults,
  recentMonthlyAverage, DEFAULT_PERIODS_PER_MONTH, periodsPerMonth,
} from '@/lib/budgetComposer';
import { subscribeToVehicles, vehicleEmoji, type Vehicle } from '@/lib/vehicles';
import { subscribeToMeters, meterEmoji, meterLabel, type UtilityMeter } from '@/lib/utilityMeters';
import { listHelpers } from '@/lib/helpers';
import type { HelperLink } from '@/lib/firestore';
import {
  type Utility, type Cadence, subscribeToUtilities, sumMonthlyUtilities, isUtilityBill,
  monthlyEquivalentCents, CADENCE_SHORT,
} from '@/lib/pantry';

const MODULE_LABELS: Record<PurchaseModule, { emoji: string; label: string; tint: string; border: string; eyebrow: string }> = {
  pantry:  { emoji: '🛒', label: 'Pantry',  tint: 'bg-pantry-leaf-soft', border: 'border-pantry-leaf', eyebrow: 'text-pantry-leaf-dk' },
  outdoor: { emoji: '🌿', label: 'Outdoor', tint: 'bg-[#E6F2EC]',         border: 'border-pantry-leaf', eyebrow: 'text-pantry-leaf-dk' },
  drivers: { emoji: '🚗', label: 'Drivers', tint: 'bg-[#E5EFF8]',         border: 'border-[#B5CFE5]',   eyebrow: 'text-hive-blue'      },
  utility: { emoji: '⚡', label: 'Utility', tint: 'bg-[#FFF3D9]',         border: 'border-hive-honey',  eyebrow: 'text-hive-honey-dk'  },
  payroll: { emoji: '🤝', label: 'Payroll', tint: 'bg-[#F4EFFB]',         border: 'border-[#C9B8E5]',   eyebrow: 'text-[#5E4A8F]'      },
  home:    { emoji: '🛋️', label: 'Home',    tint: 'bg-[#F6EBDD]',         border: 'border-[#E0C4A3]',   eyebrow: 'text-[#9B6B3F]'      },
};

const CADENCE_LABELS: Record<BudgetCadence, string> = {
  day: 'day', week: 'wk', '2x-week': '2×/wk', month: 'mo', '2x-month': '2×/mo', year: 'yr',
};

/** Map a utility-meter `Cadence` (rich: incl 2×/wk + 2×/mo) to the
 *  composer's simpler `BudgetCadence` (day/week/month/year) for the
 *  per-meter line SEED. The 2× cadences map to their base period —
 *  the parent enters the amount, so precision lands on the figure they
 *  type, not the seed. (Utilities v2, 2026-05-20) */
function meterFreqToBudgetCadence(c: Cadence): BudgetCadence {
  switch (c) {
    case 'daily':       return 'day';
    case 'weekly':
    case 'biweekly':    return 'week';   // 2×/wk → week base
    case 'yearly':      return 'year';
    case 'semimonthly':
    case 'monthly':
    case 'quarterly':
    case 'as-needed':
    default:            return 'month';
  }
}

export default function ComposeBudgetPage() {
  const params = useParams();
  const router = useRouter();
  const moduleParam = (params?.module as string) || 'pantry';
  const module = (['pantry', 'outdoor', 'drivers', 'utility', 'payroll', 'home'].includes(moduleParam)
    ? moduleParam
    : 'pantry') as PurchaseModule;
  const meta = MODULE_LABELS[module];

  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const isParent = profile?.role === 'parent';

  // Bounce non-parents back — same policy as the Budget home.
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry');
  }, [profile, router]);

  // Per-module state. Five shapes:
  //   pantry / outdoor → BudgetLine[]
  //   drivers          → Record<vehicleId, BudgetLine[]>
  //   utility          → Record<meterId, BudgetLine>
  //   payroll          → Record<helperUid, monthlySalaryCents> + other[]
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [perVehicle, setPerVehicle] = useState<Record<string, BudgetLine[]>>({});
  const [perMeter, setPerMeter] = useState<Record<string, BudgetLine>>({});
  const [perHelper, setPerHelper] = useState<Record<string, number>>({});
  const [otherLines, setOtherLines] = useState<BudgetLine[]>([]);

  // Source data for drivers / utility / payroll (auto-listed)
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [meters, setMeters] = useState<UtilityMeter[]>([]);
  const [helpers, setHelpers] = useState<HelperLink[]>([]);
  // Recurring bills — read-only contributor to the Utility cap. They
  // live in their own collection; the composer shows them + folds their
  // monthly-equivalent into the saved cap. (Utilities v2, 2026-05-20)
  const [bills, setBills] = useState<Utility[]>([]);
  const billsMonthly = useMemo(() => sumMonthlyUtilities(bills), [bills]);

  // Recent closed requests — feeds the "average spend" chip in the
  // header so the parent can see if their draft cap is in line with
  // reality. (Phase 2, 2026-05-19.)
  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    return subscribeToRecentRequests(profile.familyId, setRecent);
  }, [profile?.familyId, profile?.role]);

  const [saving, setSaving] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);

  // Subscribe to vehicles / meters when relevant.
  useEffect(() => {
    if (!profile?.familyId) return;
    if (module === 'drivers') {
      return subscribeToVehicles(profile.familyId, (vs) => setVehicles(vs.filter((v) => v.active !== false)));
    }
    if (module === 'utility') {
      const unsubMeters = subscribeToMeters(profile.familyId, (ms) => setMeters(ms.filter((m) => m.active !== false)));
      // Only true utility BILLS feed the cap — salaries + guard are
      // people costs that belong to Payroll, not Utilities.
      const unsubBills = subscribeToUtilities(profile.familyId, (bs) => setBills(bs.filter((b) => b.active && isUtilityBill(b))));
      return () => { unsubMeters(); unsubBills(); };
    }
  }, [profile?.familyId, module]);
  useEffect(() => {
    if (!profile?.familyId || module !== 'payroll') return;
    (async () => {
      try {
        const list = await listHelpers(profile.familyId!);
        setHelpers(list.filter((h) => h.status !== 'removed'));
      } catch { setHelpers([]); }
    })();
  }, [profile?.familyId, module]);

  // Hydrate state from family.budgetComposer once (and again if module
  // changes). `bootstrapped` flag avoids re-hydrating after user edits.
  useEffect(() => {
    if (!family) return;
    if (bootstrapped) return;
    const c = family.budgetComposer;
    if (module === 'pantry') {
      setLines(c?.pantry?.lines ?? emptyDefaults('pantry'));
    } else if (module === 'outdoor') {
      setLines(c?.outdoor?.lines ?? emptyDefaults('outdoor'));
    } else if (module === 'drivers') {
      const pv: Record<string, BudgetLine[]> = {};
      const existing = c?.drivers?.perVehicle ?? {};
      for (const [k, v] of Object.entries(existing)) pv[k] = v.lines;
      setPerVehicle(pv);
      setOtherLines(c?.drivers?.other?.lines ?? []);
    } else if (module === 'utility') {
      setPerMeter(c?.utility?.perMeter ?? {});
    } else if (module === 'payroll') {
      const ph: Record<string, number> = {};
      const existing = c?.payroll?.perHelper ?? {};
      for (const [k, v] of Object.entries(existing)) ph[k] = v.monthlySalaryCents;
      setPerHelper(ph);
      setOtherLines(c?.payroll?.other?.lines ?? []);
    }
    setBootstrapped(true);
  }, [family, module, bootstrapped]);

  // When drivers vehicles load: ensure every active vehicle has a
  // (possibly empty) entry so the parent can edit them all.
  useEffect(() => {
    if (module !== 'drivers' || vehicles.length === 0) return;
    setPerVehicle((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const v of vehicles) {
        if (!next[v.id]) {
          next[v.id] = [
            { id: `${v.id}-fuel`,    label: 'Fuel',             emoji: '⛽',  amountCents: 0, cadence: 'week',  kind: 'fuel' },
            { id: `${v.id}-service`, label: 'Service',          emoji: '🛠️', amountCents: 0, cadence: 'year',  kind: 'service' },
            { id: `${v.id}-parts`,   label: 'Parts (typical)',  emoji: '🔩', amountCents: 0, cadence: 'year',  kind: 'parts' },
          ];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [module, vehicles]);

  // Same for meters.
  useEffect(() => {
    if (module !== 'utility' || meters.length === 0) return;
    setPerMeter((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const m of meters) {
        if (!next[m.id]) {
          next[m.id] = {
            id: m.id,
            label: m.label,
            emoji: meterEmoji(m.type),
            // Seed the amount from the meter's estimated top-up (editable
            // here). (2026-05-20)
            amountCents: m.estimatedCents ?? 0,
            // Seed cadence from the meter's frequency, mapped to the
            // composer's simpler day/week/month/year scale. Falls back
            // to the type default. (Utilities v2) The parent can fine-
            // tune the amount + cadence on the line itself.
            cadence: m.frequency
              ? meterFreqToBudgetCadence(m.frequency)
              : (m.type === 'electric' ? 'week' : 'month'),
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [module, meters]);

  // Same for helpers.
  useEffect(() => {
    if (module !== 'payroll' || helpers.length === 0) return;
    setPerHelper((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const h of helpers) {
        if (next[h.uid] == null) {
          next[h.uid] = 0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [module, helpers]);

  // ── Computed monthly ────────────────────────────────────────
  const monthlyCents = useMemo(() => {
    if (module === 'pantry' || module === 'outdoor') return sumMonthlyCents(lines);
    if (module === 'drivers') {
      const perV = Object.values(perVehicle).reduce((acc, ls) => acc + sumMonthlyCents(ls), 0);
      return perV + sumMonthlyCents(otherLines);
    }
    if (module === 'utility') {
      // Regular top-ups (meters) + recurring bills both feed the cap.
      const meterTotal = Object.values(perMeter).reduce((acc, l) => acc + toMonthlyCents(l), 0);
      return meterTotal + billsMonthly;
    }
    // payroll
    const perH = Object.values(perHelper).reduce((acc, c) => acc + (c ?? 0), 0);
    return perH + sumMonthlyCents(otherLines);
  }, [module, lines, perVehicle, perMeter, perHelper, otherLines, billsMonthly]);

  // The SAVED + headline cap is rounded up to a neat budget figure
  // (nearest 10/100/1000 by magnitude). The raw sum stays visible in
  // the commentary so the rounding is transparent. (2026-05-20)
  const roundedCap = roundUpDisplay(monthlyCents);
  const wasRounded = roundedCap !== monthlyCents;

  // ── Save ────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!profile?.familyId || !isParent) return;
    setSaving(true);
    try {
      if (module === 'pantry' || module === 'outdoor') {
        await saveModuleComposer(profile.familyId, module, { lines });
      } else if (module === 'drivers') {
        const perVehicleOut: Record<string, { lines: BudgetLine[] }> = {};
        for (const [k, v] of Object.entries(perVehicle)) perVehicleOut[k] = { lines: v };
        await saveModuleComposer(profile.familyId, module, {
          perVehicle: perVehicleOut,
          ...(otherLines.length > 0 ? { other: { lines: otherLines } } : {}),
        });
      } else if (module === 'utility') {
        // Pass billsMonthly as the addend so the saved cap = meter
        // lines + recurring bills (snapshot at save time).
        await saveModuleComposer(profile.familyId, module, { perMeter }, billsMonthly);
      } else if (module === 'payroll') {
        const perHelperOut: Record<string, { monthlySalaryCents: number }> = {};
        for (const [k, v] of Object.entries(perHelper)) perHelperOut[k] = { monthlySalaryCents: v };
        await saveModuleComposer(profile.familyId, module, {
          perHelper: perHelperOut,
          ...(otherLines.length > 0 ? { other: { lines: otherLines } } : {}),
        });
      }
      router.push('/pantry/budget');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[budget-composer] save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  if (profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <p className="text-hive-muted text-sm">Budget is parent-only.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      {/* Back to Budget */}
      <Link href="/pantry/budget" className="text-pantry-leaf-dk font-nunito font-extrabold text-xs">
        ← Back to Budget
      </Link>
      <h1 className="font-nunito font-black text-2xl lg:text-3xl tracking-tight mt-2">
        {meta.emoji} {meta.label} cap
      </h1>
      <p className="text-hive-muted text-sm mt-1">
        Build the cap from line items in their natural rhythm. Every line normalizes to a per-month total at the top.
      </p>

      {/* Computed monthly header */}
      <div className={`mt-4 rounded-hive border-2 p-4 ${meta.tint} ${meta.border}`}>
        <div className="flex items-baseline justify-between gap-2">
          <p className={`text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] ${meta.eyebrow}`}>
            Computed monthly cap
          </p>
          {/* Reality-check chip — recent rolling average for this
              module. Helps the parent see if the draft they're
              composing matches actual spend. (Phase 2, 2026-05-19) */}
          {(() => {
            const avgs = recentMonthlyAverage(recent, { monthsBack: 3 });
            const avg = avgs.averages[module];
            if (!avg || avgs.monthsCounted < 1) return null;
            const draftMatchesAvg = monthlyCents > 0 && Math.abs(monthlyCents - avg) / avg < 0.10;
            return (
              <span
                className={`text-[10px] font-nunito font-extrabold uppercase tracking-[1px] px-2 py-0.5 rounded ${
                  draftMatchesAvg
                    ? 'bg-pantry-leaf-soft text-pantry-leaf-dk'
                    : 'bg-hive-cream text-hive-muted border border-hive-line'
                }`}
                title={`Average of the last ${avgs.monthsCounted} closed month${avgs.monthsCounted === 1 ? '' : 's'}`}
              >
                {avgs.monthsCounted}-mo avg · {formatCents(avg, currency)}
              </span>
            );
          })()}
        </div>
        <p className="font-nunito font-black text-3xl lg:text-4xl text-hive-ink mt-1">
          {formatCents(roundedCap, currency)}
        </p>
        {/* Commentary — makes the cap's logic visible: the raw sum +
            the rounding. (Elia 2026-05-20: "the logic of the monthly
            cap should be visible in the commentary".) */}
        <p className="text-[11px] text-hive-muted font-bold mt-0.5 leading-snug">
          {wasRounded ? (
            <>= {formatCents(monthlyCents, currency)} across all lines, rounded up to a neat cap.</>
          ) : (
            <>= sum of all lines below.</>
          )}
          {' '}Auto-updates as you edit · saved on next tap.
        </p>
      </div>

      {/* Body — module-specific renderer */}
      <div className="mt-4">
        {(module === 'pantry' || module === 'outdoor') && (
          <LineList
            lines={lines}
            setLines={setLines}
            currency={currency}
          />
        )}
        {module === 'drivers' && (
          <DriversComposer
            vehicles={vehicles}
            perVehicle={perVehicle}
            setPerVehicle={setPerVehicle}
            otherLines={otherLines}
            setOtherLines={setOtherLines}
            currency={currency}
          />
        )}
        {module === 'utility' && (
          <UtilityComposer
            meters={meters}
            perMeter={perMeter}
            setPerMeter={setPerMeter}
            bills={bills}
            billsMonthly={billsMonthly}
            currency={currency}
          />
        )}
        {module === 'payroll' && (
          <PayrollComposer
            helpers={helpers}
            perHelper={perHelper}
            setPerHelper={setPerHelper}
            otherLines={otherLines}
            setOtherLines={setOtherLines}
            currency={currency}
          />
        )}
      </div>

      {/* Save */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full mt-5 bg-pantry-leaf text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60"
      >
        {saving ? 'Saving…' : `Save ${meta.label} cap · ${formatCents(roundedCap, currency)}/mo →`}
      </button>
    </div>
  );
}

// ── Free-form line list (Pantry, Outdoor, Drivers "Other", Payroll "Other") ──

function LineList({
  lines, setLines, currency, showQty,
}: {
  lines: BudgetLine[];
  setLines: React.Dispatch<React.SetStateAction<BudgetLine[]>>;
  currency: string;
  showQty?: boolean;
}) {
  const updateLine = (idx: number, patch: Partial<BudgetLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };
  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        label: '',
        emoji: '📦',
        amountCents: 0,
        cadence: 'month',
      },
    ]);
  };

  return (
    <div className="flex flex-col gap-2">
      {lines.map((l, idx) => (
        <LineEditor
          key={l.id}
          line={l}
          currency={currency}
          onChange={(patch) => updateLine(idx, patch)}
          onRemove={() => removeLine(idx)}
          showQty={showQty}
        />
      ))}
      <button
        type="button"
        onClick={addLine}
        className="w-full bg-hive-paper border border-dashed border-hive-line rounded-hive py-2.5 font-nunito font-extrabold text-xs text-pantry-leaf-dk"
      >
        ＋ Add a line
      </button>
    </div>
  );
}

// ── Single line editor — used by every composer flavor ──

function LineEditor({
  line, currency, onChange, onRemove, hideRemove, showQty,
}: {
  line: BudgetLine;
  currency: string;
  onChange: (patch: Partial<BudgetLine>) => void;
  onRemove?: () => void;
  hideRemove?: boolean;
  /** Show a qty stepper + "qty × price" breakdown. Used by Drivers
   *  so a parent can budget "2 × TZS 75,000 fuel/wk". (2026-05-20) */
  showQty?: boolean;
}) {
  const monthly = toMonthlyCents(line);
  const qty = Math.max(1, line.qty ?? 1);
  const perPeriod = line.amountCents * qty;
  const factor = periodsPerMonth(line);
  const isSubMonthly = line.cadence !== 'month' && line.cadence !== 'year';
  const cadences: BudgetCadence[] = ['day', 'week', '2x-week', 'month', '2x-month', 'year'];
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-hive-cream flex items-center justify-center text-base flex-shrink-0">
          {line.emoji ?? '📦'}
        </div>
        <input
          type="text"
          value={line.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Line name (e.g. Fresh staples)"
          className="flex-1 min-w-0 font-nunito font-extrabold text-sm bg-transparent border-b border-hive-line focus:border-pantry-leaf focus:outline-none py-1"
        />
        <span className="font-nunito font-black text-sm text-hive-ink flex-shrink-0">
          {formatCents(monthly, currency)}
        </span>
      </div>

      {/* Qty stepper — only when showQty. Shows "qty × unit price". */}
      {showQty && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] font-nunito font-extrabold uppercase tracking-[1px] text-hive-muted">Qty</span>
          <div className="inline-flex items-center bg-hive-cream border border-hive-line rounded-lg">
            <button
              type="button"
              onClick={() => onChange({ qty: Math.max(1, qty - 1) })}
              className="w-7 h-7 font-nunito font-black text-sm text-hive-muted"
            >−</button>
            <span className="w-8 text-center font-nunito font-black text-sm">{qty}</span>
            <button
              type="button"
              onClick={() => onChange({ qty: qty + 1 })}
              className="w-7 h-7 font-nunito font-black text-sm text-hive-muted"
            >＋</button>
          </div>
          <span className="text-[11px] text-hive-muted font-bold">
            × {formatCents(line.amountCents, currency)} / {CADENCE_LABELS[line.cadence]}
            {qty > 1 ? ` = ${formatCents(line.amountCents * qty, currency)} / ${CADENCE_LABELS[line.cadence]}` : ''}
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1 bg-hive-cream border border-hive-line rounded-lg px-2 py-1.5">
        <span className="text-xs text-hive-muted font-bold">{currency}</span>
        <NumberInput
          value={line.amountCents / 100}
          onChange={(v) => onChange({ amountCents: Math.round(v * 100) })}
          allowDecimal={currencyAllowsDecimals(currency)}
          placeholder="0"
          className="flex-1 bg-transparent font-nunito font-extrabold text-sm focus:outline-none w-0"
        />
        <span className="text-xs text-hive-muted font-bold">
          {showQty ? 'unit price' : `/ ${CADENCE_LABELS[line.cadence]}`}
        </span>
      </div>

      {/* Cadence picker — how often this spend happens. Picking a
          sub-monthly cadence seeds its default times-per-month, which
          the parent can then tune in the commentary line below. */}
      <div className="mt-2 flex flex-wrap gap-1">
        {cadences.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(
              c === 'month' || c === 'year'
                ? { cadence: c }
                : { cadence: c, periodsPerMonth: DEFAULT_PERIODS_PER_MONTH[c] },
            )}
            className={`px-2 py-1 text-[10px] font-nunito font-extrabold uppercase tracking-wide rounded ${
              line.cadence === c ? 'bg-pantry-leaf text-white' : 'bg-hive-cream text-hive-muted'
            }`}
          >
            {CADENCE_LABELS[c]}
          </button>
        ))}
      </div>

      {/* Commentary — shows exactly how the monthly figure is derived.
          For sub-monthly cadences the "times per month" count is an
          editable input so a parent can set /day × 25, 26 or 30, etc. */}
      <div className="mt-2 flex items-center flex-wrap gap-1.5 text-[11px] font-nunito font-bold text-hive-muted">
        <span>{formatCents(perPeriod, currency)}</span>
        {line.cadence === 'month' && <span>/mo</span>}
        {line.cadence === 'year' && <span>/yr ÷ 12</span>}
        {isSubMonthly && (
          <>
            <span>×</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={factor}
              onChange={(e) => {
                const n = Math.max(1, Math.round(parseFloat(e.target.value) || 0));
                onChange({ periodsPerMonth: n });
              }}
              aria-label="Times per month"
              className="w-12 bg-hive-cream border border-hive-line rounded px-1 py-0.5 text-center font-nunito font-extrabold text-[11px] text-hive-ink focus:outline-none focus:ring-1 focus:ring-pantry-leaf/40"
            />
            <span>/mo</span>
          </>
        )}
        <span className="text-hive-ink font-black">= {formatCents(monthly, currency)}/mo</span>
      </div>
      {!hideRemove && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-[10px] text-hive-rose font-nunito font-extrabold mt-2 underline underline-offset-2"
        >
          Remove line
        </button>
      )}
    </div>
  );
}

// ── Drivers composer ──

function DriversComposer({
  vehicles, perVehicle, setPerVehicle, otherLines, setOtherLines, currency,
}: {
  vehicles: Vehicle[];
  perVehicle: Record<string, BudgetLine[]>;
  setPerVehicle: React.Dispatch<React.SetStateAction<Record<string, BudgetLine[]>>>;
  otherLines: BudgetLine[];
  setOtherLines: React.Dispatch<React.SetStateAction<BudgetLine[]>>;
  currency: string;
}) {
  if (vehicles.length === 0) {
    return (
      <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center">
        <div className="text-3xl mb-2">🚗</div>
        <p className="text-sm font-nunito font-bold text-hive-navy">No vehicles set up yet.</p>
        <Link href="/pantry/vehicles" className="text-pantry-leaf-dk font-nunito font-extrabold text-xs underline mt-2 block">
          Add a vehicle →
        </Link>
      </div>
    );
  }

  const updateLine = (vehicleId: string, idx: number, patch: Partial<BudgetLine>) => {
    setPerVehicle((prev) => ({
      ...prev,
      [vehicleId]: (prev[vehicleId] ?? []).map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  };

  return (
    <div className="flex flex-col gap-3">
      {vehicles.map((v) => {
        const ls = perVehicle[v.id] ?? [];
        const vehicleMonthly = sumMonthlyCents(ls);
        return (
          <div key={v.id} className="bg-hive-paper border border-hive-line rounded-hive p-3">
            <div className="flex items-center gap-2 pb-2 border-b border-dashed border-hive-line mb-2">
              <div className="w-9 h-9 rounded-lg bg-[#E5EFF8] flex items-center justify-center text-base flex-shrink-0">
                {vehicleEmoji(v.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-nunito font-black text-sm text-hive-ink truncate">{v.label}</div>
                <div className="text-[10px] text-hive-muted font-bold">
                  {v.year ? `${v.year} · ` : ''}{v.fuel ? `${v.fuel} · ` : ''}{v.plate || ''}
                </div>
              </div>
              <span className="font-nunito font-black text-sm text-hive-blue">
                {formatCents(vehicleMonthly, currency)}/mo
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {ls.map((l, idx) => (
                <LineEditor
                  key={l.id}
                  line={l}
                  currency={currency}
                  onChange={(patch) => updateLine(v.id, idx, patch)}
                  hideRemove
                  showQty
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Drivers "Other" — tolls, parking, recovery — global, not per-vehicle */}
      <div>
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-1">
          Other Drivers costs (optional)
        </p>
        <LineList
          lines={otherLines}
          setLines={setOtherLines}
          currency={currency}
          showQty
        />
      </div>
    </div>
  );
}

// ── Utility composer ──

function UtilityComposer({
  meters, perMeter, setPerMeter, bills, billsMonthly, currency,
}: {
  meters: UtilityMeter[];
  perMeter: Record<string, BudgetLine>;
  setPerMeter: React.Dispatch<React.SetStateAction<Record<string, BudgetLine>>>;
  bills: Utility[];
  billsMonthly: number;
  currency: string;
}) {
  const updateMeterLine = (meterId: string, patch: Partial<BudgetLine>) => {
    setPerMeter((prev) => {
      const current = prev[meterId];
      if (!current) return prev;
      return { ...prev, [meterId]: { ...current, ...patch } };
    });
  };

  // Empty state only when BOTH categories are empty.
  if (meters.length === 0 && bills.length === 0) {
    return (
      <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center">
        <div className="text-3xl mb-2">⚡</div>
        <p className="text-sm font-nunito font-bold text-hive-navy">No utilities set up yet.</p>
        <Link href="/pantry/utility/setup" className="text-pantry-leaf-dk font-nunito font-extrabold text-xs underline mt-2 block">
          Set up utilities →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Recurring bills — read-only. Managed in /pantry/utilities;
          their monthly-equivalent is folded into the cap. (Utilities v2) */}
      {bills.length > 0 && (
        <div className="bg-[#FFF3D9] border border-hive-honey rounded-hive p-3">
          <div className="flex items-baseline justify-between mb-1.5">
            <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-honey-dk">
              🔁 Recurring bills
            </p>
            <span className="font-nunito font-black text-sm text-hive-honey-dk">
              {formatCents(billsMonthly, currency)}/mo
            </span>
          </div>
          <div className="space-y-1">
            {bills.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-[12px]">
                <span className="font-nunito font-bold text-hive-ink truncate">{b.name}</span>
                <span className="text-hive-muted font-nunito font-bold flex-shrink-0">
                  {formatCents(b.amountCents || 0, currency)}{CADENCE_SHORT[b.cadence]} · = {formatCents(monthlyEquivalentCents(b.amountCents || 0, b.cadence), currency)}/mo
                </span>
              </div>
            ))}
          </div>
          <Link href="/pantry/utilities" className="text-[10.5px] text-hive-honey-dk font-nunito font-extrabold underline mt-1.5 inline-block">
            Edit recurring bills →
          </Link>
        </div>
      )}

      {/* Regular top-ups — editable per-meter estimates. */}
      {meters.length > 0 ? (
        <div>
          <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk mb-1.5">
            🔌 Regular top-ups (estimate)
          </p>
          <div className="flex flex-col gap-2">
            {meters.map((m) => {
              const line = perMeter[m.id];
              if (!line) return null;
              const editor: BudgetLine = {
                ...line,
                emoji: meterEmoji(m.type),
                label: m.label || meterLabel(m.type),
              };
              return (
                <LineEditor
                  key={m.id}
                  line={editor}
                  currency={currency}
                  onChange={(patch) => updateMeterLine(m.id, patch)}
                  hideRemove
                />
              );
            })}
          </div>
        </div>
      ) : (
        <Link href="/pantry/utility-meters" className="text-pantry-leaf-dk font-nunito font-extrabold text-xs underline">
          ＋ Add a regular top-up (meter) →
        </Link>
      )}
    </div>
  );
}

// ── Payroll composer ──

function PayrollComposer({
  helpers, perHelper, setPerHelper, otherLines, setOtherLines, currency,
}: {
  helpers: HelperLink[];
  perHelper: Record<string, number>;
  setPerHelper: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  otherLines: BudgetLine[];
  setOtherLines: React.Dispatch<React.SetStateAction<BudgetLine[]>>;
  currency: string;
}) {
  if (helpers.length === 0) {
    return (
      <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center">
        <div className="text-3xl mb-2">🤝</div>
        <p className="text-sm font-nunito font-bold text-hive-navy">No active helpers in your family.</p>
        <Link href="/settings/helpers" className="text-pantry-leaf-dk font-nunito font-extrabold text-xs underline mt-2 block">
          Add a helper →
        </Link>
      </div>
    );
  }

  const updateHelper = (uid: string, cents: number) => {
    setPerHelper((prev) => ({ ...prev, [uid]: cents }));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {helpers.map((h) => {
          const cents = perHelper[h.uid] ?? 0;
          return (
            <div key={h.uid} className="bg-hive-paper border border-hive-line rounded-hive p-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-[#F4EFFB] flex items-center justify-center text-base flex-shrink-0">
                  👤
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-nunito font-black text-sm text-hive-ink truncate">{h.displayName}</div>
                  <div className="text-[10px] text-hive-muted font-bold">Helper · {h.preset ?? 'custom'}</div>
                </div>
                <span className="font-nunito font-black text-sm text-hive-ink flex-shrink-0">
                  {formatCents(cents, currency)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1 bg-hive-cream border border-hive-line rounded-lg px-2 py-1.5">
                <span className="text-xs text-hive-muted font-bold">{currency}</span>
                <NumberInput
                  value={cents / 100}
                  onChange={(v) => updateHelper(h.uid, Math.round(v * 100))}
                  allowDecimal={currencyAllowsDecimals(currency)}
                  placeholder="0"
                  className="flex-1 bg-transparent font-nunito font-extrabold text-sm focus:outline-none w-0"
                />
                <span className="text-xs text-hive-muted font-bold">/ mo</span>
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-1">
          Other monthly costs (optional)
        </p>
        <LineList
          lines={otherLines}
          setLines={setOtherLines}
          currency={currency}
        />
      </div>
    </div>
  );
}
