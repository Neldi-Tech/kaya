// Drivers v2 — odometer bridge between the Drivers request flow and
// the Pulse readings ledger (2026-07-05).
//
// ONE source of truth: the vehicle's odometer lives as a Pulse
// trackable (type 'odometer', linked via `vehicleId`) whose readings
// sit in the append-only `families/{f}/readings` ledger. The Drivers
// request flow is just a second DOOR into that ledger:
//   • read side (this file, client) — find the vehicle's odometer
//     trackable + latest reading so the request form can show
//     "Last: 84,120 km" and validate monotonic + jump-band entry.
//   • write side (/api/drivers/odometer, Admin SDK) — append the
//     reading at send time. Server-side because Firestore rules gate
//     `trackables` creates to parents and `readings` creates to
//     pulse-granted helpers; a driver with only `household:drivers`
//     must still be able to log at the pump.

import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import { getLatestReading, type TrackableDoc } from './pulse';

export interface VehicleOdometerInfo {
  /** The odometer trackable's id — null when the vehicle has none yet
   *  (the API route will auto-create it on first log). */
  trackableId: string | null;
  /** Latest ledger reading, km. Null when no reading exists yet. */
  lastKm: number | null;
  /** When that reading was captured (ms). */
  capturedAtMs: number | null;
}

/** Find the vehicle's odometer trackable + latest reading. Read-only,
 *  client-safe (trackables + readings are family-readable). */
export async function fetchVehicleOdometer(
  familyId: string,
  vehicleId: string,
): Promise<VehicleOdometerInfo> {
  const empty: VehicleOdometerInfo = { trackableId: null, lastKm: null, capturedAtMs: null };
  if (isGuestActive()) return empty;
  try {
    const q = query(
      collection(db, 'families', familyId, 'trackables'),
      where('vehicleId', '==', vehicleId),
    );
    const snap = await getDocs(q);
    const odo = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as TrackableDoc))
      .find((t) => t.type === 'odometer' && t.active !== false);
    if (!odo) return empty;
    const latest = await getLatestReading(familyId, odo.id);
    return {
      trackableId: odo.id,
      lastKm: latest ? latest.value : null,
      capturedAtMs: latest?.capturedAt ? latest.capturedAt.toMillis() : null,
    };
  } catch {
    // A read hiccup must never block the request flow — the form just
    // renders without the "Last:" line and skips monotonic validation.
    return empty;
  }
}

export interface OdometerStats extends VehicleOdometerInfo {
  /** Average km/day over the recent reading window — the run-rate
   *  that projects "expected 24-Jul at your pace". Null when fewer
   *  than two readings exist. */
  kmPerDay: number | null;
}

/** Latest reading + km/day run-rate for a vehicle. One extra readings
 *  fetch vs fetchVehicleOdometer — use where the projection matters
 *  (service card, health card, nudge). */
export async function fetchOdometerStats(
  familyId: string,
  vehicleId: string,
): Promise<OdometerStats> {
  const empty: OdometerStats = { trackableId: null, lastKm: null, capturedAtMs: null, kmPerDay: null };
  if (isGuestActive()) return empty;
  try {
    const tq = query(
      collection(db, 'families', familyId, 'trackables'),
      where('vehicleId', '==', vehicleId),
    );
    const tSnap = await getDocs(tq);
    const odo = tSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as TrackableDoc))
      .find((t) => t.type === 'odometer' && t.active !== false);
    if (!odo) return empty;
    const rq = query(
      collection(db, 'families', familyId, 'readings'),
      where('trackableId', '==', odo.id),
    );
    const rSnap = await getDocs(rq);
    const readings = rSnap.docs
      .map((d) => {
        const data = d.data() as { value?: number; capturedAt?: { toMillis(): number }; event?: string };
        return {
          value: Number(data.value) || 0,
          atMs: data.capturedAt?.toMillis?.() ?? 0,
          event: data.event ?? 'normal',
        };
      })
      .filter((r) => r.event !== 'rollback' && r.atMs > 0 && r.value > 0)
      .sort((a, b) => a.atMs - b.atMs);
    if (readings.length === 0) return { ...empty, trackableId: odo.id };
    const last = readings[readings.length - 1];
    // Run-rate over the recent window (≤90 days back from the latest
    // reading) so an old first-ever reading doesn't dilute the pace.
    const windowStart = last.atMs - 90 * 24 * 60 * 60 * 1000;
    const windowed = readings.filter((r) => r.atMs >= windowStart);
    const first = windowed[0];
    let kmPerDay: number | null = null;
    if (windowed.length >= 2 && last.atMs > first.atMs && last.value > first.value) {
      const days = (last.atMs - first.atMs) / (24 * 60 * 60 * 1000);
      if (days >= 1) kmPerDay = (last.value - first.value) / days;
    }
    return { trackableId: odo.id, lastKm: last.value, capturedAtMs: last.atMs, kmPerDay };
  } catch {
    return empty;
  }
}

/** Append an odometer reading to the Pulse ledger via the Admin
 *  route. Fire-and-forget from the send path — a logging failure
 *  must not block the request itself. */
export async function logOdometerReading(args: {
  familyId: string;
  vehicleId: string;
  requestId?: string;
  valueKm: number;
  capturedBy: string;
  capturedByKind: 'parent' | 'helper' | 'kid';
}): Promise<{ ok: boolean }> {
  if (isGuestActive()) return { ok: false };
  try {
    const res = await fetch('/api/drivers/odometer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
