// Drivers v2 · log an odometer reading (server, Admin SDK) — 2026-07-05.
//
// POST { familyId, vehicleId, requestId?, valueKm, capturedBy, capturedByKind }
//
// Appends the reading to the SAME Pulse ledger that meter/trackable
// readings use (families/{f}/readings) so the family has exactly one
// odometer history per vehicle — Drivers requests and Pulse routines
// are two doors into the same room. Server-side because rules gate
// `trackables` creates to parents and `readings` creates to
// pulse-granted helpers; a driver with only `household:drivers` must
// still be able to log at the pump.
//
// Find-or-create: the vehicle's odometer trackable is auto-created on
// first log (type 'odometer', direction 'up', module 'drivers',
// unit 'km', zero price — an odometer has no cost per km).

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Local YYYY-MM-DD in the family timezone (Phase-1 single-TZ, same
 *  as the reminders cron — Africa/Dar_es_Salaam). */
function dayKeyDar(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Dar_es_Salaam', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d); // en-CA renders as YYYY-MM-DD
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: {
    familyId?: string; vehicleId?: string; requestId?: string;
    valueKm?: number; capturedBy?: string; capturedByKind?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const familyId = body.familyId;
  const vehicleId = body.vehicleId;
  const valueKm = Number(body.valueKm);
  const capturedBy = typeof body.capturedBy === 'string' ? body.capturedBy : '';
  const capturedByKind = body.capturedByKind === 'helper' || body.capturedByKind === 'kid'
    ? body.capturedByKind : 'parent';
  if (!familyId || !vehicleId || !capturedBy || !Number.isFinite(valueKm) || valueKm <= 0) {
    return NextResponse.json({ error: 'missing-fields' }, { status: 400 });
  }

  // The vehicle must exist in this family — cheap sanity gate.
  const famRef = db.collection('families').doc(familyId);
  const vehicleSnap = await famRef.collection('vehicles').doc(vehicleId).get();
  if (!vehicleSnap.exists) return NextResponse.json({ error: 'vehicle-not-found' }, { status: 404 });
  const vehicleLabel = (vehicleSnap.data()?.label as string) || 'Vehicle';

  // Find-or-create the odometer trackable for this vehicle.
  const trackSnap = await famRef.collection('trackables')
    .where('vehicleId', '==', vehicleId).get();
  let trackableId = trackSnap.docs
    .find((d) => d.data().type === 'odometer' && d.data().active !== false)?.id ?? null;
  if (!trackableId) {
    const created = await famRef.collection('trackables').add({
      name: `Odometer · ${vehicleLabel}`,
      type: 'odometer',
      unit: 'km',
      pricePerUnitCents: 0,
      direction: 'up',
      vehicleId,
      module: 'drivers',
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    trackableId = created.id;
  }

  // Previous reading — single-field query + in-memory sort, mirroring
  // lib/pulseLogApply.server (no composite index needed).
  const prevSnap = await famRef.collection('readings')
    .where('trackableId', '==', trackableId).get();
  let prev: number | null = null;
  let prevAtMs = 0;
  for (const d of prevSnap.docs) {
    const data = d.data();
    const at = data.capturedAt?.toMillis?.() ?? 0;
    if (at >= prevAtMs) { prevAtMs = at; prev = Number(data.value) || 0; }
  }

  // 'up' direction: consumption = curr − prev; a backward entry is a
  // rollback event with zero consumption (append-only — corrections
  // are new docs, never edits).
  const consumedUnits = prev != null && valueKm >= prev ? valueKm - prev : 0;
  const event = prev != null && valueKm < prev ? 'rollback' : 'normal';

  await famRef.collection('readings').add({
    trackableId,
    trackableSource: 'trackable',
    value: valueKm,
    consumedUnits,
    deltaCost: 0,
    event,
    module: 'drivers',
    capturedBy,
    capturedByKind,
    capturedAt: FieldValue.serverTimestamp(),
    dayKey: dayKeyDar(new Date()),
    isAnomaly: false,
    ...(body.requestId ? { requestId: body.requestId } : {}),
  });

  return NextResponse.json({ ok: true, trackableId, prev, consumedUnits, event });
}
