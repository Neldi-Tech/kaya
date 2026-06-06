// Household · Utility meters data layer.
//
// One collection: families/{f}/utilityMeters/{id} — a meter the family
// tracks (electric LUKU box, water DAWASA meter, gas cylinder, etc.).
// Each Utility module PurchaseRequest pins to ONE meter via
// `request.meterId` so we can roll up consumption per meter.
//
// Per the Tim-family use case in the v3 design (2026-05-18, Decision C):
// 5 electric meters in one home (main house, cottage, workshop, pool,
// garden) — each its own request stream + history.

import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs,
  Timestamp, serverTimestamp, onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import type { Cadence } from './pantry';
// Type-only — pulse.ts imports meterEmoji from here at runtime, so keeping
// this a type import avoids a runtime cycle. (2026-05-22, Kaya Pulse.)
import type { MeterDirection } from './pulse';

/** Meter type drives the emoji + picker chip colour + default
 *  cadence guess. Keep short on purpose — most families have
 *  electric + water + gas; the rest are edge cases. */
export type UtilityMeterType =
  | 'electric' | 'water' | 'gas' | 'internet' | 'security' | 'tv' | 'rent' | 'other';

export const METER_TYPES: { id: UtilityMeterType; emoji: string; label: string }[] = [
  { id: 'electric', emoji: '⚡', label: 'Electricity' },
  { id: 'water',    emoji: '💧', label: 'Water' },
  { id: 'gas',      emoji: '🔥', label: 'Gas' },
  { id: 'internet', emoji: '📶', label: 'Internet' },
  { id: 'security', emoji: '🛡️', label: 'Security' },
  { id: 'tv',       emoji: '📺', label: 'TV / streaming' },
  { id: 'rent',     emoji: '🏠', label: 'Rent' },
  { id: 'other',    emoji: '📦', label: 'Other' },
];

export interface UtilityMeter {
  id: string;
  type: UtilityMeterType;
  /** Human label — what the family calls the meter. "Main House",
   *  "Cottage LUKU", "Liquid Home fibre" etc. */
  label: string;
  /** Provider-side identifier — meter number, account number, etc.
   *  Optional. Shown on the picker chip + meter detail. */
  providerRef?: string;
  /** Average days between top-ups / payments. Used by the future
   *  Pantry-style Wink ("haven't topped up in 14 days, average is 9")
   *  + by the picker to surface "due now" meters first. Optional. */
  cadenceDays?: number;
  /** How often this regular top-up is bought, as a named cadence
   *  (Utilities v2, 2026-05-20). Replaces the raw `cadenceDays` for the
   *  UI picker — supports "2× a week" (biweekly) + "2× a month"
   *  (semimonthly). Feeds the Budget composer's per-meter estimate.
   *  Optional for back-compat; absent meters fall back to a type
   *  default (electric → weekly, others → monthly). */
  frequency?: Cadence;
  /** Optional photo of the meter (mounted on a wall etc.) — helps
   *  helpers identify which meter is which when there are several. */
  photoUrl?: string;
  // ── Rich registration (2026-05-20) ─────────────────────────────
  /** Preferred supplier this top-up is usually bought from / paid to.
   *  Links to the shared suppliers collection. Surfaces on the picker
   *  + flows into the request. Optional. */
  preferredSupplierId?: string;
  /** Estimated typical top-up amount in cents — the parent's working
   *  figure (editable from time to time). Pre-fills the request
   *  estimate + feeds the Budget composer's per-meter line. Variable
   *  by nature, so it's a guide, not a fixed bill amount. */
  estimatedCents?: number;
  /** Price per unit of consumption, in display-currency cents — e.g.
   *  cents per kWh of electricity, per litre of water. Tariffs change,
   *  so this is editable from time to time. When set, a Utility request
   *  pinned to this meter shows a READ-ONLY "≈ N {unit}" estimate of how
   *  much consumption the top-up buys (request total ÷ pricePerUnitCents),
   *  updating live as the helper edits the amount. Groundwork for the
   *  future Kaya Pulse units-threshold pipeline. Optional. (2026-05-21) */
  pricePerUnitCents?: number;
  /** Unit label paired with `pricePerUnitCents` — "kWh", "litre",
   *  "unit". Drives the "≈ N {unit}" hint. Optional. (2026-05-21) */
  unit?: string;
  /** Days of the month a reminder fires for this top-up (1–31). When
   *  set, Kaya nudges the helper on those days to launch a top-up
   *  request — REMINDER ONLY, never auto-creates a request (top-ups
   *  are variable; the helper enters the actual amount). For a
   *  "2× a month" frequency the form auto-suggests [1, 15] (editable).
   *  Empty = no scheduled reminder (helper tops up as they run low). */
  reminderDays?: number[];
  /** Idempotency guard for the reminder generator — "YYYY-MM-DD" of the
   *  last reminder fired, so a re-open on the same day is a no-op. */
  lastRemindedKey?: string;
  // ── Kaya Pulse (2026-05-22) ─────────────────────────────────────
  /** Reading direction. 'down' = prepaid/depleting (LUKU electricity, gas):
   *  the reading IS the remaining balance, ticks toward 0, and a jump up = a
   *  top-up (not usage). 'up' = postpaid/cumulative totalizer (city water,
   *  odometer): only climbs, consumption = curr − prev. Drives the Pulse
   *  delta engine. Absent on legacy meters → the mapper defaults (water →
   *  'up', everything else → 'down'); the Admin form sets it explicitly. */
  direction?: MeterDirection;
  /** Remaining units on a 'down' meter (= the latest reading value). Pulse
   *  sets this on each reading; powers the auto-top-up threshold. 'down' only. */
  balanceUnits?: number;
  /** When balanceUnits falls below this, Pulse auto-creates a utility top-up
   *  purchaseRequest — the Kaya Plus seam. 'down' meters only. */
  minUnitsThreshold?: number;
  // ── Auto top-up config (Kaya Plus, 2026-06-06) ─────────────────────
  /** Master switch — when on + balanceUnits < minUnitsThreshold, Kaya
   *  auto-creates a pending-approval top-up request for this meter. */
  autoTopUp?: boolean;
  /** Amount source for the auto request: 'last' = repeat the most recent
   *  approved top-up for this meter; 'fixed' = autoTopUpAmountCents. */
  autoTopUpSource?: 'last' | 'fixed';
  /** Fixed top-up amount (display-currency cents) when source = 'fixed'. */
  autoTopUpAmountCents?: number;
  /** Email + notification when an auto top-up fires (default on). */
  autoTopUpAlert?: boolean;
  /** Idempotency: the open auto-request currently outstanding for this
   *  meter. Set by the trigger; cleared when the balance recovers above
   *  the threshold. Prevents re-firing while one is pending. */
  autoTopUpPendingRequestId?: string;
  /** Surfaced as a Kaya Pulse trackable (gets a reading task + history). */
  pulseEnabled?: boolean;
  /** Pause without deleting. False meters don't appear in the
   *  request picker but their history stays for Finances. */
  active: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

const metersCol = (familyId: string) =>
  collection(db, 'families', familyId, 'utilityMeters');

const meterDoc = (familyId: string, id: string) =>
  doc(db, 'families', familyId, 'utilityMeters', id);

/** Subscribe to all meters for a family. Ordered by type → label so
 *  similar meters group naturally in the picker chip row. */
export function subscribeToMeters(
  familyId: string,
  cb: (meters: UtilityMeter[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  // Sort client-side (type → label) instead of a double orderBy: two
  // orderBy fields require a composite index, and a missing index makes
  // the whole subscription fail silently → "No meters yet" even after a
  // meter saves. The meter list is tiny (<30), so JS sort is free + has
  // no index dependency. (2026-05-20 bug fix.) Error callback renders
  // empty rather than hanging on any future permission/index blip.
  return onSnapshot(
    metersCol(familyId),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as UtilityMeter));
      list.sort((a, b) =>
        a.type === b.type ? a.label.localeCompare(b.label) : a.type.localeCompare(b.type));
      cb(list);
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[utilityMeters] subscribe failed:', err);
      cb([]);
    },
  );
}

/** One-shot read of all meters — used by the top-up reminder generator
 *  (runs once on page-load, not as a subscription). (2026-05-20) */
export async function listMeters(familyId: string): Promise<UtilityMeter[]> {
  if (isGuestActive()) return [];
  const snap = await getDocs(metersCol(familyId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as UtilityMeter));
}

export async function addMeter(
  familyId: string,
  data: Omit<UtilityMeter, 'id' | 'createdAt' | 'active'> & { active?: boolean },
): Promise<string> {
  if (isGuestActive()) return 'guest-meter';
  const ref = await addDoc(metersCol(familyId), {
    ...data,
    active: data.active ?? true,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateMeter(
  familyId: string,
  meterId: string,
  patch: Partial<Omit<UtilityMeter, 'id' | 'createdAt'>>,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(meterDoc(familyId, meterId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function removeMeter(familyId: string, meterId: string): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(meterDoc(familyId, meterId));
}

/** Look up meter type emoji — convenience for chip rendering. */
export function meterEmoji(type: UtilityMeterType): string {
  return METER_TYPES.find((t) => t.id === type)?.emoji ?? '⚡';
}

export function meterLabel(type: UtilityMeterType): string {
  return METER_TYPES.find((t) => t.id === type)?.label ?? 'Meter';
}
