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
  collection, doc, addDoc, updateDoc, deleteDoc,
  Timestamp, serverTimestamp, onSnapshot, query, orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import type { Cadence } from './pantry';

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
  const q = query(metersCol(familyId), orderBy('type'), orderBy('label'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as UtilityMeter)));
  });
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
