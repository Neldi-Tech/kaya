// Household · Budget v3 composer (2026-05-19).
//
// Replaces the flat "one number per module" cap with a structured
// list of line items in their natural cadence. The composer's job
// is to make the cap LEGIBLE — every dollar in the cap is traceable
// to a named line. Months later, a parent can look at "why is my
// pantry cap $580?" and see the four lines that compose it.
//
// On save, we normalize each line to per-month cents and write the
// computed total to `Family.householdBudgets[module]` so every
// existing consumer (progress bars, finances roll-up, the budget
// page itself) keeps working with no code changes.

import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import type { PurchaseModule, PurchaseRequest } from './purchase';
import { roundUpDisplay } from '@/components/pantry/format';

// ── Types ──────────────────────────────────────────────────────

/** Cadence options for budget line items. The sub-monthly cadences
 *  (day / week / 2×-week / 2×-month) each carry a default "times per
 *  month" count that the parent can override per line — see
 *  `DEFAULT_PERIODS_PER_MONTH` + `BudgetLine.periodsPerMonth`. */
export type BudgetCadence = 'day' | 'week' | '2x-week' | 'month' | '2x-month' | 'year';

/** One structured line in a module's budget — e.g. "Fresh staples,
 *  $80/wk" or "Toyota RAV4 fuel, $40/wk". The label is free-form
 *  so families can use whatever names they think in. */
export interface BudgetLine {
  id: string;
  label: string;
  emoji?: string;
  /** Unit price per cadence period, in cents. Multiplied by `qty`
   *  (default 1) to get the per-period spend. */
  amountCents: number;
  /** How many units per period. Default 1 (treat amountCents as the
   *  whole per-period figure). Surfaced in the Drivers composer so a
   *  parent can budget "2 × TZS 75,000 fuel/wk". (2026-05-20) */
  qty?: number;
  cadence: BudgetCadence;
  /** How many times this spend happens per month — overrides the
   *  cadence default (day 25, week 4, 2×-week 8, 2×-month 2). Lets a
   *  parent tune "/day × 26" vs "× 30" inline. Ignored for month (×1)
   *  and year (÷12). When unset the cadence default applies. (2026-05-20) */
  periodsPerMonth?: number;
  /** Optional sub-kind for Drivers lines so we can chip them in the
   *  UI without parsing the label string. */
  kind?: 'fuel' | 'service' | 'parts' | 'wash' | 'tolls' | 'other';
}

/** Per-module composer state. Five shapes — most are just a `lines`
 *  array, Drivers/Utility/Payroll have an extra level of structure. */
export interface BudgetComposer {
  pantry?: { lines: BudgetLine[] };
  outdoor?: { lines: BudgetLine[] };
  drivers?: {
    perVehicle?: Record<string, { lines: BudgetLine[] }>;
    other?: { lines: BudgetLine[] };
  };
  utility?: {
    perMeter?: Record<string, BudgetLine>;
  };
  payroll?: {
    perHelper?: Record<string, { monthlySalaryCents: number }>;
    other?: { lines: BudgetLine[] };
  };
  dineOut?: { lines: BudgetLine[] };
  home?: { lines: BudgetLine[] };
}

// ── Cadence math ───────────────────────────────────────────────
//
// We deliberately use clean, explainable "times per month" counts
// instead of calendar-exact averages (4.348 wk/mo, 30.44 d/mo). A
// parent reads "100,000 × 4 = 400,000/mo", not "× 4.348 = 434,821".
// The counts below are sensible defaults; each line can override its
// own count via `BudgetLine.periodsPerMonth` (e.g. /day × 26 or × 30).

/** Default "times per month" for each sub-monthly cadence. */
export const DEFAULT_PERIODS_PER_MONTH: Record<BudgetCadence, number> = {
  day:        25,    // workday-ish default; editable per line
  week:       4,
  '2x-week':  8,     // twice a week ≈ 8×/mo
  month:      1,
  '2x-month': 2,
  year:       1 / 12,
};

/** Resolve how many times a line's spend lands per month. Month is
 *  always ×1 and year always ÷12 (not overridable); the sub-monthly
 *  cadences honour the per-line override, falling back to the default. */
export function periodsPerMonth(line: BudgetLine): number {
  if (line.cadence === 'month') return 1;
  if (line.cadence === 'year') return 1 / 12;
  const override = line.periodsPerMonth;
  return override && override > 0 ? override : DEFAULT_PERIODS_PER_MONTH[line.cadence];
}

/** Normalize one line to per-month cents. Always returns a whole
 *  integer (rounded) so downstream `formatCents` displays cleanly.
 *  Negative or zero amounts return 0 — we never want a line to
 *  reduce the cap. monthly = (unit price × qty) × times-per-month. */
export function toMonthlyCents(line: BudgetLine): number {
  if (line.amountCents <= 0) return 0;
  const perPeriod = line.amountCents * Math.max(1, line.qty ?? 1);
  return Math.round(perPeriod * periodsPerMonth(line));
}

/** Sum a list of lines to monthly cents. */
export function sumMonthlyCents(lines: BudgetLine[]): number {
  return lines.reduce((acc, l) => acc + toMonthlyCents(l), 0);
}

/** Compute the monthly cap for a module from its composer state.
 *  Mirrors what the composer UI shows in the header, so the saved
 *  cap = the user's last-seen total. */
export function computeModuleMonthly(
  module: PurchaseModule,
  composer: BudgetComposer,
): number {
  switch (module) {
    case 'pantry':  return sumMonthlyCents(composer.pantry?.lines ?? []);
    case 'outdoor': return sumMonthlyCents(composer.outdoor?.lines ?? []);
    case 'drivers': {
      const d = composer.drivers;
      if (!d) return 0;
      const perV = Object.values(d.perVehicle ?? {})
        .reduce((acc, v) => acc + sumMonthlyCents(v.lines), 0);
      const other = sumMonthlyCents(d.other?.lines ?? []);
      return perV + other;
    }
    case 'utility': {
      const u = composer.utility;
      if (!u) return 0;
      return Object.values(u.perMeter ?? {})
        .reduce((acc, l) => acc + toMonthlyCents(l), 0);
    }
    case 'payroll': {
      const p = composer.payroll;
      if (!p) return 0;
      const perH = Object.values(p.perHelper ?? {})
        .reduce((acc, h) => acc + (h.monthlySalaryCents ?? 0), 0);
      const other = sumMonthlyCents(p.other?.lines ?? []);
      return perH + other;
    }
    case 'dineOut': return sumMonthlyCents(composer.dineOut?.lines ?? []);
    case 'home':    return sumMonthlyCents(composer.home?.lines ?? []);
  }
}

// ── Persistence ────────────────────────────────────────────────

/** Save a module's composer state + write the computed monthly cap
 *  back to `householdBudgets[module]` in one atomic update. Callers
 *  use this from the per-module composer's "Save cap" button. */
export async function saveModuleComposer(
  familyId: string,
  module: PurchaseModule,
  state: BudgetComposer[PurchaseModule],
  /** Extra monthly cents to add to the computed cap that don't live in
   *  the composer state — used by Utility, where recurring bills are
   *  managed in their own collection but still feed the cap. The cap
   *  written to householdBudgets becomes a SNAPSHOT (composer lines +
   *  bills-at-save-time). (Utilities v2, 2026-05-20) */
  extraMonthlyCents = 0,
): Promise<void> {
  if (isGuestActive()) return;
  const fullComposer = { ...(state ? { [module]: state } : {}) } as BudgetComposer;
  const rawMonthly = computeModuleMonthly(module, fullComposer) + Math.max(0, extraMonthlyCents);
  // Saved cap is rounded UP to a neat budget figure (Elia 2026-05-20:
  // round UP so the cap is never below reality — safer for projection).
  // The composer state keeps exact line amounts; only the cap cache is
  // rounded so progress bars + finances read a clean number.
  const monthlyCents = roundUpDisplay(rawMonthly);
  await updateDoc(doc(db, 'families', familyId), {
    [`budgetComposer.${module}`]: state ?? null,
    [`householdBudgets.${module}`]: monthlyCents,
  });
}

/** Save the entire composer at once + recompute ALL module caps.
 *  Used by the auto-suggest "apply" flow which lands all 5 modules
 *  in one go. */
export async function saveFullComposer(
  familyId: string,
  composer: BudgetComposer,
): Promise<void> {
  if (isGuestActive()) return;
  const modules: PurchaseModule[] = ['pantry', 'outdoor', 'drivers', 'utility', 'payroll', 'dineOut', 'home'];
  const patch: Record<string, unknown> = { budgetComposer: composer };
  for (const m of modules) {
    patch[`householdBudgets.${m}`] = roundUpDisplay(computeModuleMonthly(m, composer));
  }
  await updateDoc(doc(db, 'families', familyId), patch);
}

// ── Starter-pack (auto-suggest) ────────────────────────────────

/** Inputs the auto-suggest reads from the family's existing state.
 *  Parent can edit the counts on the suggest sheet before applying. */
export interface StarterInput {
  adultsCount: number;
  kidsCount: number;
  helpersCount: number;
  /** Vehicles the family has (label + type to pick a fuel default).
   *  Empty list = no Drivers cap. */
  vehicles: { id: string; label: string; type: string }[];
  /** Meters the family has (type drives default cadence). Empty =
   *  no Utility cap. */
  meters: { id: string; type: string; label: string }[];
  helpers: { uid: string; displayName: string }[];
}

/** Per-currency magnitude scaling for starter-pack numbers.
 *  USD is the base (mockup numbers); other currencies scale by a
 *  fixed factor that's "TZ-realistic" rather than 1× FX of the
 *  USD value. Refinement to region-specific presets is Phase 2. */
function currencyScale(currency: string): number {
  switch (currency) {
    case 'TZS': return 2500;   // 1 USD ≈ 2,500 TZS rough purchasing power
    case 'KES': return 130;    // 1 USD ≈ 130 KES
    case 'NGN': return 1500;   // 1 USD ≈ 1,500 NGN
    case 'AED': return 4;      // 1 USD ≈ 3.67 AED, rounded
    case 'EUR': return 1;      // ~parity for budgeting purposes
    case 'GBP': return 1;      // ~parity for budgeting purposes
    case 'INR': return 85;     // 1 USD ≈ 85 INR
    case 'ZAR': return 19;     // 1 USD ≈ 19 ZAR
    default:    return 1;      // USD baseline
  }
}

/** USD baseline numbers (cents) for starter-pack lines. Tweakable
 *  if Elia sees them shipping too low/high. */
const USD_BASE = {
  // Pantry — per-person × per-week
  PANTRY_FRESH_PER_PERSON_WEEK: 1800,  // $18/wk per person — fresh
  PANTRY_DRY_PER_PERSON_WEEK:    800,  //  $8/wk per person — dry
  PANTRY_SNACKS_PER_HOUSEHOLD_WEEK: 1000,  // $10/wk household snacks
  PANTRY_CLEANING_PER_MONTH:     2000,  // $20/mo cleaning + personal
  // Outdoor — household flat with a kuku-bump for big families
  OUTDOOR_GARDEN_MONTH:          3000,  // $30/mo
  OUTDOOR_KUKU_PETS_WEEK:        1000,  // $10/wk
  OUTDOOR_REPAIRS_YEAR:          6000,  // $60/yr = $5/mo
  // Drivers — per vehicle
  DRIVERS_FUEL_PER_VEHICLE_WEEK: 3000,  // $30/wk fuel typical
  DRIVERS_SERVICE_PER_VEHICLE_YEAR: 24000,  // $240/yr service prorated
  DRIVERS_PARTS_PER_VEHICLE_YEAR:    9600,  // $96/yr parts prorated
  // Utility — per meter type, monthly default
  UTIL_POWER_WEEK:               2000,  // $20/wk (top-up culture)
  UTIL_WATER_MONTH:              3000,  // $30/mo
  UTIL_GAS_MONTH:                3000,  // $30/mo
  UTIL_INTERNET_MONTH:           4000,  // $40/mo
  UTIL_TV_MONTH:                 1500,  // $15/mo
  UTIL_SECURITY_MONTH:           2000,  // $20/mo
  UTIL_RENT_MONTH:               80000, // $800/mo placeholder
  UTIL_OTHER_MONTH:              1000,  // $10/mo
  // Payroll
  PAYROLL_PER_HELPER_MONTH:      30000, // $300/mo per helper (override)
  PAYROLL_OTHER_MONTH:            5000, // $50/mo other costs
};

/** Apply the currency scaling to a USD-base number. */
function scaled(usdCents: number, currency: string): number {
  return Math.round(usdCents * currencyScale(currency));
}

/** Region-specific overrides — pure magnitude scaling (USD × FX-ish)
 *  works for most lines but underestimates regional differences in
 *  labor markets + utility tariffs. Where the actual local figure
 *  differs from "1× USD × FX," provide it directly here. (2026-05-19
 *  Phase 2 of the Budget Composer.)
 *
 *  Each entry overrides one or more starter-pack values for a given
 *  currency. Values are in LOCAL cents (already scaled to the
 *  currency), so they replace `scaled()` not pre-scale through it.
 *
 *  Coverage focus: PAYROLL (single biggest divergence), POWER_WEEK
 *  (prepaid culture in TZ/KE/NG differs from US/EU monthly billing),
 *  and RENT. Other lines fall through to magnitude scaling.
 *
 *  Sources: Elia's own household numbers (TZ) + rough comparable
 *  market rates (Numbeo / Glassdoor-equiv) for the rest. Refine
 *  with real-user data once Kaya has more families per region. */
type RegionOverrides = {
  PAYROLL_PER_HELPER_MONTH?: number;
  UTIL_POWER_WEEK?: number;
  UTIL_RENT_MONTH?: number;
};
const REGION_OVERRIDES: Record<string, RegionOverrides> = {
  // Tanzania — labor cost ≈ TZS 350k/mo per helper (nanny/cook),
  // power TZS 10k/wk prepaid top-up typical, rent varies wildly so
  // we keep magnitude-scaled $800 as placeholder.
  TZS: {
    PAYROLL_PER_HELPER_MONTH: 35_000_000, // TZS 350,000/mo
    UTIL_POWER_WEEK:          1_000_000,  // TZS 10,000/wk
  },
  // Kenya — comparable wage ratio, KES 18,000/mo per helper.
  KES: {
    PAYROLL_PER_HELPER_MONTH: 1_800_000,  // KES 18,000/mo
    UTIL_POWER_WEEK:            50_000,   // KES 500/wk
  },
  // Nigeria — NGN 80,000/mo per helper typical Lagos.
  NGN: {
    PAYROLL_PER_HELPER_MONTH: 8_000_000,  // NGN 80,000/mo
  },
  // UAE — high cost-of-living, AED 1,500/mo per helper visa-sponsored.
  AED: {
    PAYROLL_PER_HELPER_MONTH:   150_000,  // AED 1,500/mo
    UTIL_RENT_MONTH:          400_000_0,  // AED 4,000/mo rent (placeholder)
  },
  // India — INR 12,000/mo per helper urban average.
  INR: {
    PAYROLL_PER_HELPER_MONTH: 1_200_000,  // INR 12,000/mo
  },
  // South Africa — ZAR 4,500/mo per helper.
  ZAR: {
    PAYROLL_PER_HELPER_MONTH:   450_000,  // ZAR 4,500/mo
  },
  // EUR / GBP / USD — leave as magnitude-scaled USD baselines.
};

/** Lookup helper: returns the region-override value if present, else
 *  falls back to magnitude-scaled USD baseline. */
function regional(key: keyof RegionOverrides, currency: string): number {
  const o = REGION_OVERRIDES[currency];
  if (o && o[key] != null) return o[key]!;
  return scaled(USD_BASE[key], currency);
}

/** Build a starter composer state from family-size inputs. Caller
 *  is expected to walk the user through each module before saving
 *  — this is the "kick-starter pack" not the final cap. */
export function buildStarterComposer(
  input: StarterInput,
  currency: string,
): BudgetComposer {
  const people = Math.max(1, input.adultsCount + input.kidsCount);

  // Pantry — line items in /wk + /mo natural cadence.
  const pantry: { lines: BudgetLine[] } = {
    lines: [
      {
        id: 'pantry-fresh',
        label: 'Fresh staples',
        emoji: '🥬',
        amountCents: scaled(USD_BASE.PANTRY_FRESH_PER_PERSON_WEEK, currency) * people,
        cadence: 'week',
      },
      {
        id: 'pantry-dry',
        label: 'Dry staples',
        emoji: '🍚',
        amountCents: scaled(USD_BASE.PANTRY_DRY_PER_PERSON_WEEK, currency) * people,
        cadence: 'week',
      },
      {
        id: 'pantry-snacks',
        label: 'Snacks & drinks',
        emoji: '🍪',
        amountCents: scaled(USD_BASE.PANTRY_SNACKS_PER_HOUSEHOLD_WEEK, currency),
        cadence: 'week',
      },
      {
        id: 'pantry-cleaning',
        label: 'Cleaning & personal',
        emoji: '🧴',
        amountCents: scaled(USD_BASE.PANTRY_CLEANING_PER_MONTH, currency),
        cadence: 'month',
      },
    ],
  };

  // Outdoor — flat + kuku weekly bump
  const outdoor: { lines: BudgetLine[] } = {
    lines: [
      {
        id: 'outdoor-garden',
        label: 'Garden',
        emoji: '🌿',
        amountCents: scaled(USD_BASE.OUTDOOR_GARDEN_MONTH, currency),
        cadence: 'month',
      },
      {
        id: 'outdoor-kuku',
        label: 'Kuku / Pets',
        emoji: '🐔',
        amountCents: scaled(USD_BASE.OUTDOOR_KUKU_PETS_WEEK, currency),
        cadence: 'week',
      },
      {
        id: 'outdoor-repairs',
        label: 'Repairs (typical)',
        emoji: '🔧',
        amountCents: scaled(USD_BASE.OUTDOOR_REPAIRS_YEAR, currency),
        cadence: 'year',
      },
    ],
  };

  // Drivers — one block per vehicle
  const driversPer: Record<string, { lines: BudgetLine[] }> = {};
  for (const v of input.vehicles) {
    driversPer[v.id] = {
      lines: [
        {
          id: `${v.id}-fuel`,
          label: 'Fuel',
          emoji: '⛽',
          amountCents: scaled(USD_BASE.DRIVERS_FUEL_PER_VEHICLE_WEEK, currency),
          cadence: 'week',
          kind: 'fuel',
        },
        {
          id: `${v.id}-service`,
          label: 'Service',
          emoji: '🛠️',
          amountCents: scaled(USD_BASE.DRIVERS_SERVICE_PER_VEHICLE_YEAR, currency),
          cadence: 'year',
          kind: 'service',
        },
        {
          id: `${v.id}-parts`,
          label: 'Parts (typical)',
          emoji: '🔩',
          amountCents: scaled(USD_BASE.DRIVERS_PARTS_PER_VEHICLE_YEAR, currency),
          cadence: 'year',
          kind: 'parts',
        },
      ],
    };
  }

  // Utility — one line per meter, type drives cadence + default amount
  const utilityPer: Record<string, BudgetLine> = {};
  for (const m of input.meters) {
    const { amountCents, cadence, emoji } = utilityDefaultsFor(m.type, currency);
    utilityPer[m.id] = {
      id: m.id,
      label: m.label,
      emoji,
      amountCents,
      cadence,
    };
  }

  // Payroll — one entry per helper at the per-helper monthly baseline,
  // plus a small "Other" line for incidentals.
  const payrollPer: Record<string, { monthlySalaryCents: number }> = {};
  for (const h of input.helpers) {
    payrollPer[h.uid] = {
      monthlySalaryCents: regional('PAYROLL_PER_HELPER_MONTH', currency),
    };
  }

  return {
    pantry,
    outdoor,
    drivers: input.vehicles.length > 0 ? { perVehicle: driversPer } : undefined,
    utility: input.meters.length > 0 ? { perMeter: utilityPer } : undefined,
    payroll: input.helpers.length > 0
      ? {
          perHelper: payrollPer,
          other: {
            lines: [{
              id: 'payroll-other',
              label: 'Other monthly costs',
              emoji: '💸',
              amountCents: scaled(USD_BASE.PAYROLL_OTHER_MONTH, currency),
              cadence: 'month',
            }],
          },
        }
      : undefined,
  };
}

/** Per-meter-type starter defaults. Cadence reflects the typical
 *  billing/top-up rhythm in Tanzania (power is prepaid weekly
 *  top-ups; water + internet bill monthly). */
function utilityDefaultsFor(type: string, currency: string): {
  amountCents: number; cadence: BudgetCadence; emoji: string;
} {
  switch (type) {
    case 'electric':
      return { amountCents: regional('UTIL_POWER_WEEK', currency), cadence: 'week', emoji: '⚡' };
    case 'water':
      return { amountCents: scaled(USD_BASE.UTIL_WATER_MONTH, currency), cadence: 'month', emoji: '💧' };
    case 'gas':
      return { amountCents: scaled(USD_BASE.UTIL_GAS_MONTH, currency), cadence: 'month', emoji: '🔥' };
    case 'internet':
      return { amountCents: scaled(USD_BASE.UTIL_INTERNET_MONTH, currency), cadence: 'month', emoji: '📶' };
    case 'tv':
      return { amountCents: scaled(USD_BASE.UTIL_TV_MONTH, currency), cadence: 'month', emoji: '📺' };
    case 'security':
      return { amountCents: scaled(USD_BASE.UTIL_SECURITY_MONTH, currency), cadence: 'month', emoji: '🛡️' };
    case 'rent':
      return { amountCents: regional('UTIL_RENT_MONTH', currency), cadence: 'month', emoji: '🏠' };
    default:
      return { amountCents: scaled(USD_BASE.UTIL_OTHER_MONTH, currency), cadence: 'month', emoji: '📦' };
  }
}

// ── Defaults for empty composers (when parent opens cold) ──────

/** When a module composer is opened cold (no existing state), seed
 *  it with empty-but-named lines so the parent knows what shape to
 *  fill in. Different from the starter pack — these are zero-amount
 *  placeholders, not suggested numbers. */
export function emptyDefaults(module: 'pantry' | 'outdoor'): BudgetLine[] {
  if (module === 'pantry') {
    return [
      { id: 'pantry-fresh',    label: 'Fresh staples',       emoji: '🥬', amountCents: 0, cadence: 'week' },
      { id: 'pantry-dry',      label: 'Dry staples',         emoji: '🍚', amountCents: 0, cadence: 'week' },
      { id: 'pantry-snacks',   label: 'Snacks & drinks',     emoji: '🍪', amountCents: 0, cadence: 'week' },
      { id: 'pantry-cleaning', label: 'Cleaning & personal', emoji: '🧴', amountCents: 0, cadence: 'month' },
    ];
  }
  return [
    { id: 'outdoor-garden',  label: 'Garden',            emoji: '🌿', amountCents: 0, cadence: 'month' },
    { id: 'outdoor-kuku',    label: 'Kuku / Pets',       emoji: '🐔', amountCents: 0, cadence: 'week' },
    { id: 'outdoor-repairs', label: 'Repairs (typical)', emoji: '🔧', amountCents: 0, cadence: 'year' },
  ];
}

// ── Reality-check: recent monthly average (Phase 2) ─────────────
//
// Given the family's recent closed requests, compute a per-module
// monthly average. Used by:
//   1. Budget home — surface a banner if a module's recent average
//      diverges from the current cap by >10% ("bump cap?").
//   2. Composer header — show "recent avg: X/mo" so the parent can
//      see if the draft cap matches reality.
//
// Logic: group closed requests by (module, calendar-month), sum
// `actualTotalCents` per group, then average the per-month sums.
// Skip the current calendar month — it's incomplete and would drag
// the average down. Require at least 1 full month of data per
// module; otherwise return null for that module.

export interface MonthlyAverageResult {
  /** Months observed (excluding current). Higher = more reliable. */
  monthsCounted: number;
  /** Per-module average in cents. null = not enough data. */
  averages: Partial<Record<PurchaseModule, number>>;
}

/** Compute per-module rolling-average monthly spend from closed
 *  requests. `monthsBack` caps how far back we look (default 3).
 *  Current month is always excluded because it's partial. */
export function recentMonthlyAverage(
  recentClosed: PurchaseRequest[],
  opts: { monthsBack?: number; nowMs?: number } = {},
): MonthlyAverageResult {
  const monthsBack = opts.monthsBack ?? 3;
  const now = opts.nowMs ? new Date(opts.nowMs) : new Date();
  const currentKey = monthKey(now);

  // Build {module: {monthKey: sum}} so we can average each module
  // independently (a sparse month for one module shouldn't drag
  // another module's average down).
  const buckets: Partial<Record<PurchaseModule, Record<string, number>>> = {};
  const cutoff = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1).getTime();

  for (const r of recentClosed) {
    if (r.status !== 'closed') continue;
    const at = r.closedAt?.toDate?.();
    if (!at) continue;
    if (at.getTime() < cutoff) continue;
    const mk = monthKey(at);
    if (mk === currentKey) continue;             // skip partial month
    const m = (r.module ?? 'pantry') as PurchaseModule;
    const cents = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
    if (!buckets[m]) buckets[m] = {};
    buckets[m]![mk] = (buckets[m]![mk] ?? 0) + cents;
  }

  const averages: Partial<Record<PurchaseModule, number>> = {};
  let maxMonths = 0;
  for (const [mod, monthMap] of Object.entries(buckets)) {
    if (!monthMap) continue;
    const months = Object.values(monthMap);
    if (months.length === 0) continue;
    const total = months.reduce((a, b) => a + b, 0);
    averages[mod as PurchaseModule] = Math.round(total / months.length);
    if (months.length > maxMonths) maxMonths = months.length;
  }
  return { monthsCounted: maxMonths, averages };
}

/** YYYY-MM key for grouping closed requests. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Decide whether the current cap is meaningfully off the rolling
 *  average. Returns null if no signal (too few months) or the cap
 *  is within tolerance. Otherwise returns the suggested new cap +
 *  the direction ("up" / "down"). 10% threshold matches the human
 *  intuition of "noticeably off" without being twitchy. */
export function suggestCapAdjustment(
  currentCapCents: number,
  averageCents: number | undefined,
  monthsCounted: number,
): { direction: 'up' | 'down'; suggestedCapCents: number; deltaPct: number } | null {
  if (!averageCents || averageCents <= 0) return null;
  if (monthsCounted < 1) return null;
  if (currentCapCents <= 0) {
    // No cap set yet — always suggest setting to the average.
    return { direction: 'up', suggestedCapCents: averageCents, deltaPct: 100 };
  }
  const delta = averageCents - currentCapCents;
  const pct = Math.abs(delta) / currentCapCents;
  if (pct < 0.10) return null;                   // within tolerance
  return {
    direction: delta > 0 ? 'up' : 'down',
    suggestedCapCents: averageCents,
    deltaPct: Math.round(pct * 100),
  };
}
