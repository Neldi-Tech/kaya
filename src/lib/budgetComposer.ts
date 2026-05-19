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
import type { PurchaseModule } from './purchase';

// ── Types ──────────────────────────────────────────────────────

/** Cadence options for budget line items. */
export type BudgetCadence = 'day' | 'week' | 'month' | 'year';

/** One structured line in a module's budget — e.g. "Fresh staples,
 *  $80/wk" or "Toyota RAV4 fuel, $40/wk". The label is free-form
 *  so families can use whatever names they think in. */
export interface BudgetLine {
  id: string;
  label: string;
  emoji?: string;
  /** Amount per cadence period, in cents. */
  amountCents: number;
  cadence: BudgetCadence;
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
}

// ── Cadence math ───────────────────────────────────────────────

/** Average days per month — 365.25 / 12. Used for /day → /month. */
const DAYS_PER_MONTH = 30.4375;
/** Average weeks per month — 52.1786 / 12. Used for /week → /month. */
const WEEKS_PER_MONTH = 4.348214;

/** Normalize one line to per-month cents. Always returns a whole
 *  integer (rounded) so downstream `formatCents` displays cleanly.
 *  Negative or zero amounts return 0 — we never want a line to
 *  reduce the cap. */
export function toMonthlyCents(line: BudgetLine): number {
  if (line.amountCents <= 0) return 0;
  switch (line.cadence) {
    case 'day':   return Math.round(line.amountCents * DAYS_PER_MONTH);
    case 'week':  return Math.round(line.amountCents * WEEKS_PER_MONTH);
    case 'month': return line.amountCents;
    case 'year':  return Math.round(line.amountCents / 12);
  }
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
): Promise<void> {
  if (isGuestActive()) return;
  const fullComposer = { ...(state ? { [module]: state } : {}) } as BudgetComposer;
  const monthlyCents = computeModuleMonthly(module, fullComposer);
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
  const modules: PurchaseModule[] = ['pantry', 'outdoor', 'drivers', 'utility', 'payroll'];
  const patch: Record<string, unknown> = { budgetComposer: composer };
  for (const m of modules) {
    patch[`householdBudgets.${m}`] = computeModuleMonthly(m, composer);
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
      monthlySalaryCents: scaled(USD_BASE.PAYROLL_PER_HELPER_MONTH, currency),
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
      return { amountCents: scaled(USD_BASE.UTIL_POWER_WEEK, currency), cadence: 'week', emoji: '⚡' };
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
      return { amountCents: scaled(USD_BASE.UTIL_RENT_MONTH, currency), cadence: 'month', emoji: '🏠' };
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
