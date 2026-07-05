// Family-wide measurement units (Drivers v2 / Household Setup —
// 2026-07-05).
//
// One family-level setting under Household Setup → Units & formats.
// STORAGE IS ALWAYS CANONICAL (distance km, the entered fuel unit is
// recorded on the item); display converts. Changing the unit relabels
// every screen, reminder and report — history is stored raw and
// converted on read, never rewritten.

import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

export type DistanceUnit = 'km' | 'mi';
export type FuelVolumeUnit = 'L' | 'gal';

export interface FamilyUnits {
  distance: DistanceUnit;
  fuelVolume: FuelVolumeUnit;
}

export const DEFAULT_UNITS: FamilyUnits = { distance: 'km', fuelVolume: 'L' };

export function readFamilyUnits(
  family: { units?: Partial<FamilyUnits> } | null | undefined,
): FamilyUnits {
  const u = family?.units || {};
  return {
    distance: u.distance === 'mi' ? 'mi' : 'km',
    fuelVolume: u.fuelVolume === 'gal' ? 'gal' : 'L',
  };
}

/** Persist (parent-only; family-doc rules enforce). */
export async function setFamilyUnits(
  familyId: string,
  patch: Partial<FamilyUnits>,
): Promise<void> {
  if (isGuestActive()) return;
  await setDoc(doc(db, 'families', familyId), { units: patch } as Record<string, unknown>, { merge: true });
}

const MI_PER_KM = 0.621371;

/** Canonical km → display number in the family's unit. */
export function kmToDisplay(km: number, unit: DistanceUnit): number {
  return unit === 'mi' ? Math.round(km * MI_PER_KM) : Math.round(km);
}

/** A number typed in the family's unit → canonical km. */
export function displayToKm(value: number, unit: DistanceUnit): number {
  return unit === 'mi' ? Math.round(value / MI_PER_KM) : Math.round(value);
}

/** "84,560 km" / "52,540 mi" — display string from canonical km. */
export function formatDistance(km: number, unit: DistanceUnit): string {
  return `${kmToDisplay(km, unit).toLocaleString()} ${unit}`;
}
