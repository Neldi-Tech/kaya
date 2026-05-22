// Kaya Pulse — finance-intelligence data layer.
//
// Pulse is folded INTO this app (not a standalone Flutter app — see the
// 2026-05-22 design proposal). It turns household consumption into priced,
// structured data and drives savings into Kaya Wealth.
//
// Conventions inherited from the rest of the app:
//   • money is integer CENTS; display currency = family.hiveConfig.currency
//   • date keys are 'YYYY-MM-DD' (local-time boundaries), months 'YYYY-MM'
//   • ledgers (readings) are immutable + append-only, like Hive tx
//
// Two money lenses (the core architectural rule — do not blend them):
//   • CONSUMPTION  = readings × price → the intelligence layer (daily cost,
//     anomalies, run-rate). Not real cash on prepaid meters.
//   • CASH         = closed purchaseRequests vs householdBudgets → real money.
//     Savings → Wealth is computed from the CASH lens only.

import { collection, doc } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { Role } from './firestore';
import type { PurchaseModule } from './purchase';
import type { UtilityMeter } from './utilityMeters';
import { meterEmoji } from './utilityMeters';

/* ============================================================
   OWNERS — Pulse references real people, never a synthetic id
   ============================================================ */
/** A kid is identified by their Child id; a helper by their Firebase UID.
 *  There is no "memberId" in this app — never invent one. */
export type OwnerKind = 'kid' | 'helper';

/* ============================================================
   TRACKABLES — what gets measured
   ============================================================ */
/** Reading direction (Elia, 2026-05-22):
 *  • 'down' = prepaid / depleting (LUKU electricity, gas cylinder, tank).
 *    The reading IS the remaining balance; it ticks toward 0, and a jump UP
 *    means a top-up/refill (not consumption). Balance + threshold + the
 *    auto-top-up seam apply here.
 *  • 'up'  = postpaid / cumulative totalizer (TZ city water, odometer,
 *    generator hours). The reading only climbs; consumption = curr − prev;
 *    a backward reading is the anomaly. No balance/threshold — the recurring
 *    bill is the cash side. */
export type MeterDirection = 'up' | 'down';

/** Where a trackable physically lives. Utility trackables reuse the existing
 *  utilityMeters collection (which already carries pricePerUnitCents + unit
 *  from the 21-May groundwork); everything else is the new `trackables`
 *  collection. One view-model (`Trackable`) merges both for the UI. */
export type TrackableSource = 'meter' | 'trackable';

export type NonMeterTrackableType = 'fuel' | 'generator' | 'odometer' | 'gas' | 'custom';

export const NON_METER_TYPES: { id: NonMeterTrackableType; emoji: string; label: string }[] = [
  { id: 'fuel', emoji: '⛽', label: 'Fuel' },
  { id: 'generator', emoji: '⚙️', label: 'Generator' },
  { id: 'odometer', emoji: '🚗', label: 'Odometer' },
  { id: 'gas', emoji: '🔥', label: 'Gas cylinder' },
  { id: 'custom', emoji: '📦', label: 'Custom' },
];

export function nonMeterEmoji(t: NonMeterTrackableType): string {
  return NON_METER_TYPES.find((x) => x.id === t)?.emoji ?? '📦';
}

/** New collection: families/{fid}/trackables/{id} — non-meter trackables. */
export interface TrackableDoc {
  id: string;
  name: string;
  type: NonMeterTrackableType;
  unit: string; // "litre", "hour", "km"
  pricePerUnitCents: number;
  direction: MeterDirection;
  /** Links fuel/odometer trackables to an existing vehicles/{id}. */
  vehicleId?: string;
  /** Which budget bucket this consumption rolls into. */
  module: PurchaseModule;
  /** For direction:'down' — units remaining (powers the threshold trigger). */
  balanceUnits?: number;
  /** For direction:'down' — below this, auto-create a top-up request. */
  minUnitsThreshold?: number;
  active: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

/** Unified view-model the UI consumes (utilityMeters + trackables merged). */
export interface Trackable {
  id: string;
  source: TrackableSource;
  name: string;
  emoji: string;
  unit: string;
  pricePerUnitCents: number;
  direction: MeterDirection;
  module: PurchaseModule;
  balanceUnits?: number;
  minUnitsThreshold?: number;
  active: boolean;
}

/* ============================================================
   READINGS — one immutable family-level ledger
   ============================================================ */
export type ReadingEvent = 'normal' | 'topup' | 'rollback';

/** families/{fid}/readings/{id} — create-only (append-only audit). A
 *  correction is a NEW doc pointing at the original via correctionOf. */
export interface PulseReading {
  id: string;
  trackableId: string;
  trackableSource: TrackableSource;
  /** The pulseTask this satisfied; null if logged ad-hoc. */
  taskId?: string;
  /** Raw reading on the meter/counter. */
  value: number;
  /** Computed usage for this reading — always >= 0. */
  consumedUnits: number;
  /** consumedUnits × pricePerUnitCents → integer CENTS. */
  deltaCost: number;
  event: ReadingEvent;
  /** Set when event === 'topup' (a 'down' meter jumped up). */
  toppedUpUnits?: number;
  /** Denormalized for dashboard roll-up by bucket. */
  module: PurchaseModule;
  capturedBy: string;
  capturedByKind: Role; // 'parent' | 'helper' | 'kid'
  capturedAt: Timestamp;
  dayKey: string; // YYYY-MM-DD (local)
  photoUrl?: string;
  isAnomaly: boolean;
  anomalyReason?: string;
  correctionOf?: string;
}

/* ============================================================
   TASK ENGINE — templates (config) → tasks (daily instances)
   ============================================================ */
export type PulseCadence = 'daily' | 'weekly' | 'everyNWeeks' | 'custom';
export type OwnerType = 'fixed' | 'rotating';
export type RotationPeriod = 'weekly' | 'biweekly' | 'monthly';

/** families/{fid}/pulseTemplates/{id} — admin-only writes. */
export interface PulseTemplate {
  id: string;
  trackableId: string;
  trackableSource: TrackableSource;
  cadence: PulseCadence;
  cadenceN?: number; // for everyNWeeks
  ownerKind: OwnerKind;
  ownerType: OwnerType;
  /** fixed: Child id (kid) or helper uid. */
  ownerId?: string;
  /** rotating: Child ids or helper uids. */
  rotationPool?: string[];
  rotationPeriod?: RotationPeriod;
  rotationCurrent?: string;
  rotationNextFlipAt?: Timestamp;
  /** Kid reward → fires existing giveAward(). */
  pointsValue: number;
  /** Helper reward → optional performance metric (default weight 0). */
  perfWeight?: number;
  dueTimeLocal: string; // "20:00"
  active: boolean;
  createdBy: string;
  createdAt: Timestamp;
}

export type PulseTaskStatus = 'pending' | 'logged' | 'review' | 'closed' | 'missed';

/** families/{fid}/pulseTasks/{id} — concrete daily occurrences (cron-generated).
 *  Editing a template never rewrites past tasks (values are snapshotted). */
export interface PulseTask {
  id: string;
  templateId: string;
  trackableId: string;
  trackableSource: TrackableSource;
  ownerKind: OwnerKind;
  ownerId: string;
  dayKey: string; // YYYY-MM-DD (scheduledFor)
  dueAt: Timestamp;
  status: PulseTaskStatus;
  pointsValue: number; // snapshot from template
  readingId?: string;
  loggedAt?: Timestamp;
  loggedBy?: string;
  missedAt?: Timestamp;
  note?: string;
}

/* ============================================================
   SAVINGS → WEALTH
   ============================================================ */
export type WealthStatus = 'pending' | 'approved' | 'deposited' | 'rejected';
export interface WealthAllocation {
  riskFreePct: number;
  bondsPct: number;
  equityPct: number;
}

/** families/{fid}/wealthPool/{YYYY-MM}. */
export interface WealthPool {
  id: string; // monthKey
  monthKey: string;
  savingsCents: number;
  status: WealthStatus;
  approvedBy?: string;
  approvedAt?: Timestamp;
  deposit?: {
    depositedAt?: Timestamp;
    vehicle?: string;
    allocation?: WealthAllocation;
  };
  createdAt: Timestamp;
}

/** families/{fid}/budgetSnapshots/{YYYY-MM} — frozen month-end aggregate so
 *  Wealth + Monthly Review read a stable number (the app otherwise computes
 *  spend live from closed purchaseRequests). */
export interface BudgetSnapshot {
  id: string; // monthKey
  monthKey: string;
  totalSpentCents: number;
  totalCapCents: number;
  perModule: Partial<Record<PurchaseModule, { spentCents: number; capCents: number; deltaPct: number }>>;
  savingsCents: number;
  finalized: boolean;
  finalizedAt?: Timestamp;
}

/* ============================================================
   ALERTS & STREAKS
   ============================================================ */
export type AlertSeverity = 'info' | 'warn' | 'high';

/** families/{fid}/pulseAlerts/{id}. */
export interface PulseAlert {
  id: string;
  readingId: string;
  trackableId: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  createdAt: Timestamp;
}

/** families/{fid}/pulseProfiles/{ownerId} — Pulse-scoped streak so it never
 *  collides with the gameplay Child.streak. ownerId = Child id or helper uid. */
export interface PulseProfile {
  id: string;
  ownerKind: OwnerKind;
  currentStreak: number;
  longestStreak: number;
  lastActiveDayKey?: string;
  lastBonusAwarded?: number; // 7 | 14 | 30
}

/* ============================================================
   SAVINGS PLAN — stored on the Family doc (both % and amount)
   ============================================================ */
export type SavingsMode = 'percent' | 'amount';
export type PlanPeriod = 'monthly';

/** family.pulsePlan — the parent's savings intent (Elia, 2026-05-22: "both
 *  ways should work"). The system auto-suggests focus buckets + a cut %; the
 *  parent overrides with a % to cut/keep OR an absolute amount to save. Both
 *  resolve to per-module target caps written to householdBudgets. */
export interface PulsePlan {
  savingsMode: SavingsMode;
  // ── percent mode ──
  overallCutPct?: number; // 40 = cut 40% (keep 60%)
  perModuleCutPct?: Partial<Record<PurchaseModule, number>>;
  // ── amount mode ──
  targetSavingsCents?: number; // "save 1,000,000/mo"
  perModuleCapCents?: Partial<Record<PurchaseModule, number>>;
  // ── system suggestions (parent accepts/overrides) ──
  suggestedFocusModules?: string[]; // auto top-3 by spend
  source: 'suggested' | 'parent';
  planPeriod: PlanPeriod; // 'monthly' default; horizon below extends the framing
  horizonMonths?: number; // parent's longer-term goal framing (e.g. 6 or 18)
  updatedAt?: Timestamp;
}

/** family.pulseConfig — per-family tunables (no magic numbers in code). */
export interface PulseConfig {
  anomalyMultiplier: number; // usage > N × rolling avg → anomaly
  rollingWindowDays: number;
  streakBonuses: { days: number; points: number }[];
  defaultAllocation: WealthAllocation;
}

export const DEFAULT_PULSE_CONFIG: PulseConfig = {
  anomalyMultiplier: 2,
  rollingWindowDays: 7,
  streakBonuses: [
    { days: 7, points: 25 },
    { days: 14, points: 50 },
    { days: 30, points: 150 },
  ],
  defaultAllocation: { riskFreePct: 50, bondsPct: 30, equityPct: 20 },
};

/* ============================================================
   DELTA ENGINE — pure functions (unit-tested target)
   ============================================================ */
export interface ConsumptionResult {
  consumedUnits: number; // always >= 0
  event: ReadingEvent;
  toppedUpUnits?: number;
}

/** Consumption between two consecutive readings, branching on direction.
 *  'up'   cumulative: usage = curr − prev; a backward reading = rollback (0 usage).
 *  'down' depleting:  usage = prev − curr; a forward reading = top-up  (0 usage). */
export function computeConsumption(
  direction: MeterDirection,
  prev: number | null | undefined,
  curr: number,
): ConsumptionResult {
  if (prev == null) return { consumedUnits: 0, event: 'normal' }; // first reading = baseline
  if (direction === 'up') {
    if (curr >= prev) return { consumedUnits: curr - prev, event: 'normal' };
    return { consumedUnits: 0, event: 'rollback' };
  }
  // direction === 'down'
  if (curr <= prev) return { consumedUnits: prev - curr, event: 'normal' };
  return { consumedUnits: 0, event: 'topup', toppedUpUnits: curr - prev };
}

/** deltaCost in integer cents (rounded to the nearest cent). */
export function computeDeltaCostCents(consumedUnits: number, pricePerUnitCents: number): number {
  return Math.round(consumedUnits * pricePerUnitCents);
}

/** Anomaly when usage exceeds multiplier × rolling average (avg must be meaningful). */
export function detectAnomaly(
  consumedUnits: number,
  rollingAvgUnits: number,
  cfg: Pick<PulseConfig, 'anomalyMultiplier'> = DEFAULT_PULSE_CONFIG,
): { isAnomaly: boolean; reason?: string } {
  if (rollingAvgUnits <= 0) return { isAnomaly: false };
  if (consumedUnits > cfg.anomalyMultiplier * rollingAvgUnits) {
    const x = (consumedUnits / rollingAvgUnits).toFixed(1);
    return { isAnomaly: true, reason: `${x}× recent average` };
  }
  return { isAnomaly: false };
}

/** On a depleting ('down') meter the remaining balance IS the latest reading. */
export function balanceAfterReading(direction: MeterDirection, curr: number): number | undefined {
  return direction === 'down' ? curr : undefined;
}

/** Auto-top-up trigger (the Kaya Plus seam) — depleting meters with a threshold only. */
export function shouldTriggerTopup(
  direction: MeterDirection,
  balanceUnits: number | undefined,
  minUnitsThreshold: number | undefined,
): boolean {
  if (direction !== 'down') return false;
  if (balanceUnits == null || minUnitsThreshold == null) return false;
  return balanceUnits < minUnitsThreshold;
}

/* ============================================================
   SAVINGS PLAN RESOLUTION — pure (% or amount → per-module caps)
   ============================================================ */
export interface ResolvedPlan {
  capsByModule: Partial<Record<PurchaseModule, number>>; // target cap cents per module
  totalCapCents: number;
  targetSavingsCents: number; // baseline − caps
}

/** Resolve a PulsePlan against a per-module spending baseline (recent monthly
 *  average, cents) into concrete per-module target caps. Both input modes
 *  converge on the same output you write to householdBudgets. */
export function resolvePlan(
  plan: PulsePlan,
  baselineByModule: Partial<Record<PurchaseModule, number>>,
): ResolvedPlan {
  const modules = Object.keys(baselineByModule) as PurchaseModule[];
  const totalBaseline = modules.reduce((s, m) => s + (baselineByModule[m] ?? 0), 0);
  const caps: Partial<Record<PurchaseModule, number>> = {};

  if (plan.savingsMode === 'percent') {
    for (const m of modules) {
      const base = baselineByModule[m] ?? 0;
      const cutPct = plan.perModuleCutPct?.[m] ?? plan.overallCutPct ?? 0;
      caps[m] = Math.max(0, Math.round(base * (1 - cutPct / 100)));
    }
  } else if (plan.perModuleCapCents && Object.keys(plan.perModuleCapCents).length > 0) {
    // amount mode, explicit per-module caps
    for (const m of modules) caps[m] = plan.perModuleCapCents[m] ?? baselineByModule[m] ?? 0;
  } else {
    // amount mode, single savings target distributed proportionally across modules
    const target = plan.targetSavingsCents ?? 0;
    const ratio = totalBaseline > 0 ? Math.min(1, target / totalBaseline) : 0;
    for (const m of modules) {
      const base = baselineByModule[m] ?? 0;
      caps[m] = Math.max(0, Math.round(base * (1 - ratio)));
    }
  }

  const totalCap = modules.reduce((s, m) => s + (caps[m] ?? 0), 0);
  return {
    capsByModule: caps,
    totalCapCents: totalCap,
    targetSavingsCents: Math.max(0, totalBaseline - totalCap),
  };
}

/** Auto-suggest the top-N focus buckets by spend (the plan UI's default). */
export function suggestFocusModules(
  spendByModule: Partial<Record<PurchaseModule, number>>,
  n = 3,
): PurchaseModule[] {
  return (Object.keys(spendByModule) as PurchaseModule[])
    .sort((a, b) => (spendByModule[b] ?? 0) - (spendByModule[a] ?? 0))
    .slice(0, n);
}

/** Monthly savings for the Wealth pool = max(0, total caps − actual cash spend).
 *  Cash lens: actual = sum of closed purchaseRequests for the month. */
export function computeMonthSavingsCents(totalCapCents: number, actualSpentCents: number): number {
  return Math.max(0, totalCapCents - actualSpentCents);
}

/* ============================================================
   VIEW-MODEL MAPPERS — meter / trackable → unified Trackable
   ============================================================ */
export function meterToTrackable(m: UtilityMeter): Trackable {
  return {
    id: m.id,
    source: 'meter',
    name: m.label,
    emoji: meterEmoji(m.type),
    unit: m.unit ?? '',
    pricePerUnitCents: m.pricePerUnitCents ?? 0,
    // Sensible default until set in Admin: city water = postpaid totalizer ('up'),
    // everything else (LUKU, gas) = prepaid/depleting ('down').
    direction: m.direction ?? (m.type === 'water' ? 'up' : 'down'),
    module: 'utility',
    balanceUnits: m.balanceUnits,
    minUnitsThreshold: m.minUnitsThreshold,
    active: m.active,
  };
}

export function trackableDocToTrackable(t: TrackableDoc): Trackable {
  return {
    id: t.id,
    source: 'trackable',
    name: t.name,
    emoji: nonMeterEmoji(t.type),
    unit: t.unit,
    pricePerUnitCents: t.pricePerUnitCents,
    direction: t.direction,
    module: t.module,
    balanceUnits: t.balanceUnits,
    minUnitsThreshold: t.minUnitsThreshold,
    active: t.active,
  };
}

/* ============================================================
   COLLECTION REFS
   ============================================================ */
export const trackablesCol = (fid: string) => collection(db, 'families', fid, 'trackables');
export const trackableDoc = (fid: string, id: string) => doc(db, 'families', fid, 'trackables', id);
export const readingsCol = (fid: string) => collection(db, 'families', fid, 'readings');
export const readingDoc = (fid: string, id: string) => doc(db, 'families', fid, 'readings', id);
export const pulseTemplatesCol = (fid: string) => collection(db, 'families', fid, 'pulseTemplates');
export const pulseTemplateDoc = (fid: string, id: string) => doc(db, 'families', fid, 'pulseTemplates', id);
export const pulseTasksCol = (fid: string) => collection(db, 'families', fid, 'pulseTasks');
export const pulseTaskDoc = (fid: string, id: string) => doc(db, 'families', fid, 'pulseTasks', id);
export const wealthPoolCol = (fid: string) => collection(db, 'families', fid, 'wealthPool');
export const wealthPoolDoc = (fid: string, monthKey: string) => doc(db, 'families', fid, 'wealthPool', monthKey);
export const budgetSnapshotsCol = (fid: string) => collection(db, 'families', fid, 'budgetSnapshots');
export const budgetSnapshotDoc = (fid: string, monthKey: string) => doc(db, 'families', fid, 'budgetSnapshots', monthKey);
export const pulseAlertsCol = (fid: string) => collection(db, 'families', fid, 'pulseAlerts');
export const pulseAlertDoc = (fid: string, id: string) => doc(db, 'families', fid, 'pulseAlerts', id);
export const pulseProfileDoc = (fid: string, ownerId: string) => doc(db, 'families', fid, 'pulseProfiles', ownerId);
