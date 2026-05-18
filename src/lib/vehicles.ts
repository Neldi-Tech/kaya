// Household · Vehicles data layer (2026-05-18 verification pass).
//
// One collection: families/{f}/vehicles/{id} — a vehicle the family
// owns or operates (sedan, SUV, pickup, motorbike, etc.). Each Drivers
// module PurchaseRequest pins to ONE vehicle via `request.vehicleId`
// so a "Land Cruiser oil change" line in the Finances ledger always
// names the actual car, not just a generic "Drivers · service".
//
// Mirrors the utilityMeters lib intentionally — same shape, same CRUD,
// same picker pattern. Two reasons:
//   • Familiar mental model for parents who already set up meters.
//   • Reusable picker / banner components when we eventually extract.
//
// Forward-looking: when Kaya Wealth (KW) ships, the source of truth
// for vehicles moves THERE — KW is the asset registry, Drivers reads
// from it. The local Vehicle interface is intentionally narrow (just
// what the request flow needs); KW will own the deeper fields
// (purchase date, mileage history, insurance docs, etc.). For now we
// own the data here; later we'll back this lib with a KW-driven
// adapter and the call sites stay the same.

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  Timestamp, serverTimestamp, onSnapshot, query, orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

/** Vehicle type drives the picker emoji + grouping. Kept short — most
 *  households have a couple of cars + maybe a bike; the long-tail
 *  goes in 'other'. */
export type VehicleType =
  | 'sedan' | 'suv' | 'pickup' | 'van' | 'motorbike' | 'tuktuk' | 'truck' | 'other';

export const VEHICLE_TYPES: { id: VehicleType; emoji: string; label: string }[] = [
  { id: 'sedan',     emoji: '🚗', label: 'Sedan' },
  { id: 'suv',       emoji: '🚙', label: 'SUV / 4x4' },
  { id: 'pickup',    emoji: '🛻', label: 'Pickup' },
  { id: 'van',       emoji: '🚐', label: 'Van' },
  { id: 'motorbike', emoji: '🏍️', label: 'Motorbike' },
  { id: 'tuktuk',    emoji: '🛺', label: 'Tuk-tuk / bajaji' },
  { id: 'truck',     emoji: '🚚', label: 'Truck / lorry' },
  { id: 'other',     emoji: '🚘', label: 'Other' },
];

export interface Vehicle {
  id: string;
  type: VehicleType;
  /** Human label — what the family calls the car. "Diana's RAV4",
   *  "School pickup", "The Hilux", "Boda 1". Picker shows this. */
  label: string;
  /** Plate number / registration. Optional. Shown as a secondary
   *  identifier on the picker + banner. */
  plate?: string;
  /** Make + model in one string (e.g. "Toyota RAV4 2018"). Optional;
   *  the label is enough for everyday picking, this is just nice-to-
   *  have so the request audit trail is unambiguous. */
  makeModel?: string;
  /** Manufacture year. Helps the helper at the workshop ("which
   *  generation?"). Optional. */
  year?: number;
  /** Body colour. Useful when the family has two of the same make. */
  color?: string;
  /** Photo url (Storage). Helps a new helper identify which vehicle
   *  is which when there are several. Optional. */
  photoUrl?: string;
  /** Pause without deleting. Inactive vehicles don't show in the
   *  picker but their history stays for Finances. */
  active: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

const vehiclesCol = (familyId: string) =>
  collection(db, 'families', familyId, 'vehicles');

const vehicleDoc = (familyId: string, id: string) =>
  doc(db, 'families', familyId, 'vehicles', id);

/** Subscribe to all vehicles for a family. Ordered by type → label so
 *  similar vehicles group naturally in the picker (all sedans together,
 *  all bikes together). */
export function subscribeToVehicles(
  familyId: string,
  cb: (vehicles: Vehicle[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(vehiclesCol(familyId), orderBy('type'), orderBy('label'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Vehicle)));
  });
}

export async function addVehicle(
  familyId: string,
  data: Omit<Vehicle, 'id' | 'createdAt' | 'active'> & { active?: boolean },
): Promise<string> {
  if (isGuestActive()) return 'guest-vehicle';
  const ref = await addDoc(vehiclesCol(familyId), {
    ...data,
    active: data.active ?? true,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateVehicle(
  familyId: string,
  vehicleId: string,
  patch: Partial<Omit<Vehicle, 'id' | 'createdAt'>>,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(vehicleDoc(familyId, vehicleId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function removeVehicle(familyId: string, vehicleId: string): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(vehicleDoc(familyId, vehicleId));
}

/** Look up vehicle type emoji — convenience for chip rendering. */
export function vehicleEmoji(type: VehicleType): string {
  return VEHICLE_TYPES.find((t) => t.id === type)?.emoji ?? '🚗';
}

export function vehicleTypeLabel(type: VehicleType): string {
  return VEHICLE_TYPES.find((t) => t.id === type)?.label ?? 'Vehicle';
}
