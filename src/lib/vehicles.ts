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

/** Fuel type — drives request auto-suggestions for fuel prices.
 *  Green (low-emission) tier vs conventional. Petrol/Diesel cover ~95%
 *  of households; the green options are for future-proofing as the EV
 *  + gas-conversion fleet grows in the Kaya markets. (2026-05-19) */
export type VehicleFuel =
  | 'petrol' | 'diesel'
  | 'electric' | 'cng' | 'bio_fuel'
  | 'hybrid';

export const VEHICLE_FUELS: {
  id: VehicleFuel; emoji: string; label: string; group: 'conventional' | 'green';
}[] = [
  // Conventional first — most common for now.
  { id: 'petrol',   emoji: '⛽',  label: 'Petrol',    group: 'conventional' },
  { id: 'diesel',   emoji: '🛢️',  label: 'Diesel',    group: 'conventional' },
  // Green / lower-emission tier.
  { id: 'hybrid',   emoji: '🔋',  label: 'Hybrid',    group: 'green' },
  { id: 'electric', emoji: '⚡',  label: 'Electric',  group: 'green' },
  { id: 'cng',      emoji: '💨',  label: 'CNG',       group: 'green' },
  { id: 'bio_fuel', emoji: '🌱',  label: 'Bio-fuel',  group: 'green' },
];

export function vehicleFuelLabel(fuel: VehicleFuel | undefined): string {
  if (!fuel) return '';
  return VEHICLE_FUELS.find((f) => f.id === fuel)?.label ?? fuel;
}

/** Curated colour palette for the picker. Free text via 'other' for the
 *  long tail (custom wrap, two-tone, dealer-specific shade). The
 *  emoji-as-swatch approach keeps it visual without needing an extra
 *  CSS asset. Hex codes drive a small dot indicator on rows. */
export const VEHICLE_COLORS: { id: string; label: string; hex: string }[] = [
  { id: 'white',  label: 'White',  hex: '#F5F5F5' },
  { id: 'black',  label: 'Black',  hex: '#1F1F1F' },
  { id: 'silver', label: 'Silver', hex: '#C0C0C0' },
  { id: 'grey',   label: 'Grey',   hex: '#6B7280' },
  { id: 'red',    label: 'Red',    hex: '#DC2626' },
  { id: 'blue',   label: 'Blue',   hex: '#2563EB' },
  { id: 'green',  label: 'Green',  hex: '#16A34A' },
  { id: 'brown',  label: 'Brown',  hex: '#92400E' },
  { id: 'beige',  label: 'Beige',  hex: '#D6C7A1' },
  { id: 'gold',   label: 'Gold',   hex: '#D4A017' },
];

/** Resolve a colour string to a hex swatch. Returns null when the
 *  vehicle stored a free-text "other" colour we don't have a swatch for. */
export function vehicleColorHex(color: string | undefined): string | null {
  if (!color) return null;
  const found = VEHICLE_COLORS.find((c) => c.label.toLowerCase() === color.toLowerCase());
  return found ? found.hex : null;
}

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
  /** Body colour. Useful when the family has two of the same make.
   *  Stored as the display label ('White', 'Silver', 'Other: Wrapped
   *  matte black'). UI presents the curated VEHICLE_COLORS palette
   *  with a free-text "Other" fallback. */
  color?: string;
  /** Fuel type — drives request auto-suggestions for fuel prices on
   *  the Drivers request flow. Optional (legacy vehicles don't have
   *  it; the request flow falls back to free-text). Added 2026-05-19. */
  fuel?: VehicleFuel;
  /** Photo url (Storage). Helps a new helper identify which vehicle
   *  is which when there are several. Optional. */
  photoUrl?: string;
  // ── Service schedule (Drivers v2 — 2026-07-05) ──────────────────
  // Due = interval km OR interval months, whichever trips first
  // (locked decision A). Baseline = the odometer + date at the LAST
  // service; closing a Service-kind request auto-resets both. The due
  // math lives in lib/vehicleService.ts.
  /** Service every N km (canonical km; display converts). */
  serviceIntervalKm?: number;
  /** And/or service every N months. */
  serviceIntervalMonths?: number;
  /** Odometer at the last service (km). */
  serviceBaselineKm?: number;
  /** Date of the last service (YYYY-MM-DD, local). */
  serviceBaselineDate?: string;
  // ── Service reminders (per-vehicle; Setup Screen F) ─────────────
  /** Remind when ≤ N km left to due (default 500). */
  remindKmLeft?: number;
  /** Remind when ≤ N days left to due (default 14). */
  remindDaysLeft?: number;
  /** Who gets service reminders (lock C: parents + drivers by
   *  default, adjustable per family). */
  remindRecipients?: { parents?: boolean; drivers?: boolean; allHelpers?: boolean };
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

/** Subscribe to all vehicles for a family. (2026-05-19 — fixed
 *  "vehicle disappears after add" bug: the previous query did
 *  `orderBy('type'), orderBy('label')` which silently requires a
 *  composite Firestore index. The index was never deployed, so the
 *  listener fired its error path on every add and the UI saw an
 *  empty snapshot. Switched to a single `orderBy('type')` — Firestore
 *  handles single-field ordering without an index — and we sort by
 *  label client-side. Vehicle sets are tiny (a few cars per family),
 *  so the sort cost is negligible.) */
export function subscribeToVehicles(
  familyId: string,
  cb: (vehicles: Vehicle[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(vehiclesCol(familyId), orderBy('type'));
  return onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Vehicle));
    // Stable secondary sort by label within each type group so the
    // picker order matches the parent's mental model ("Diana's RAV4"
    // before "Elia's CRV" within SUVs, etc.).
    list.sort((a, b) => {
      if (a.type !== b.type) return 0; // Firestore already grouped by type
      return (a.label || '').localeCompare(b.label || '');
    });
    cb(list);
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
