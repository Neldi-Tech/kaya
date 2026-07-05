// Drivers v2 · daily vehicle-service reminder sweep (Screen D, 2026-07-05).
//
// For EVERY family, every vehicle with a service schedule:
//   1. Recompute due state from the Pulse odometer ledger — km left to
//      dueKm, the usage-projected expected date (km/day run-rate) and
//      the months-based hard stop (lib/vehicleService, same math the
//      app renders).
//   2. UPCOMING — fires ONCE per service cycle when either lock-B
//      threshold trips (≤ N km left OR ≤ N days, per-vehicle overrides,
//      defaults 500 km / 14 days).
//   3. OVERDUE — past due; repeats WEEKLY until a Service request
//      closes (which resets the baseline → new cycle key → clean slate).
//
// Recipients follow lock C (vehicle.remindRecipients, default parents +
// drivers): parents by role; "drivers" = active helpers holding the
// household:drivers grant. In-app bell + Resend email now; WhatsApp
// rides the Neldi pipeline later — same message, wired when it lands.
//
// Idempotency mirrors the birthdays cron: state on the family doc
// (`family.vehicleService[vehicleId]`) keyed by a cycle key
// (baselineDate|baselineKm), merge-upserts, NO rules change. Secured by
// CRON_SECRET when set.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import {
  computeServiceDue, effectiveDueIso, serviceReminderState,
} from '@/lib/vehicleService';
import { toDisplayDate } from '@/lib/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const resend = apiKey ? new Resend(apiKey) : null;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Local YYYY-MM-DD in the family timezone (Phase-1 single-TZ, same as
 *  the reminders cron). */
function todayDar(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Dar_es_Salaam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Distance in the family's display unit (units.ts logic inlined — the
 *  lib imports the client SDK, which a cron route shouldn't pull in). */
function fmtDist(km: number, unit: 'km' | 'mi'): string {
  const v = unit === 'mi' ? Math.round(km * 0.621371) : Math.round(km);
  return `${v.toLocaleString()} ${unit}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function serviceEmailHtml(args: {
  vehicleLabel: string; overdue: boolean; kmLeftLine: string;
  expectedLine: string; appUrl: string;
}): string {
  const { vehicleLabel, overdue, kmLeftLine, expectedLine, appUrl } = args;
  const grad = overdue
    ? 'linear-gradient(135deg,#8C2B2B 0%,#C0392B 80%)'
    : 'linear-gradient(135deg,#2E5A41 0%,#4C7C59 80%)';
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:520px;margin:0 auto;padding:18px">
    <div style="border-radius:16px;padding:24px 18px;text-align:center;color:#fff;background:${grad}">
      <div style="font-size:28px">🛠️</div>
      <div style="font-size:19px;font-weight:900;margin-top:8px">
        ${esc(vehicleLabel)} — ${overdue ? 'service OVERDUE' : `service due ${esc(kmLeftLine)}`}
      </div>
      <div style="font-size:13px;opacity:.92;margin-top:4px">${esc(expectedLine)}</div>
    </div>
    <div style="text-align:center;margin-top:16px">
      <a href="${appUrl}/pantry/drivers" style="display:inline-block;background:#4C7C59;color:#fff;font-weight:800;font-size:14px;border-radius:999px;padding:11px 24px;text-decoration:none">Create the service request →</a>
      <div style="font-size:11.5px;color:#5C6975;margin-top:12px">Closing the 🛠️ Service request resets the schedule automatically.</div>
    </div>
  </div>`;
}

interface CycleState { cycleKey?: string; upcomingAt?: number; lastOverdueAt?: number }

/** Narrow view of a vehicle doc — only what the sweep reads. */
interface VehicleDocLite {
  id: string;
  label?: unknown;
  active?: unknown;
  serviceIntervalKm?: unknown;
  serviceIntervalMonths?: unknown;
  serviceBaselineKm?: unknown;
  serviceBaselineDate?: unknown;
  nextServiceKm?: unknown;
  nextServiceDate?: unknown;
  remindKmLeft?: unknown;
  remindDaysLeft?: unknown;
  remindRecipients?: unknown;
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });

  const today = todayDar();
  const nowMs = Date.now();
  let families = 0, vehiclesChecked = 0, fired = 0, emailed = 0;

  const famSnap = await db.collection('families').get();
  for (const famDoc of famSnap.docs) {
    families++;
    const famRef = famDoc.ref;
    try {
      const vehiclesSnap = await famRef.collection('vehicles').get();
      const vehicles: VehicleDocLite[] = vehiclesSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as VehicleDocLite))
        .filter((v) => v.active !== false
          && ((typeof v.serviceIntervalKm === 'number' && v.serviceIntervalKm > 0)
            || (typeof v.serviceIntervalMonths === 'number' && v.serviceIntervalMonths > 0)));
      if (vehicles.length === 0) continue;

      const famData = famDoc.data() as Record<string, unknown>;
      const distUnit: 'km' | 'mi' =
        (famData.units as { distance?: string } | undefined)?.distance === 'mi' ? 'mi' : 'km';
      const state = (famData.vehicleService || {}) as Record<string, CycleState>;

      // Members once per family: parents + active drivers-granted helpers.
      const [usersSnap, helpersSnap, trackSnap] = await Promise.all([
        db.collection('users').where('familyId', '==', famDoc.id).get(),
        famRef.collection('helpers').get(),
        famRef.collection('trackables').get(),
      ]);
      const emailByUid: Record<string, string> = {};
      const parentUids: string[] = [];
      const helperUids: string[] = [];
      usersSnap.forEach((d) => {
        const u = d.data() as Record<string, unknown>;
        if (typeof u.email === 'string' && u.email) emailByUid[d.id] = u.email;
        if (u.role === 'parent') parentUids.push(d.id);
        if (u.role === 'helper') helperUids.push(d.id);
      });
      const driverUids: string[] = [];
      helpersSnap.forEach((d) => {
        const h = d.data() as Record<string, unknown>;
        if (h.status !== 'active') return;
        const ma = h.moduleAccess as Record<string, { act?: boolean }> | undefined;
        const modules = Array.isArray(h.modules) ? (h.modules as string[]) : [];
        const canDrive = ma
          ? !!(ma['household:drivers']?.act || ma['household']?.act)
          : (modules.includes('household:drivers') || modules.includes('household'));
        if (canDrive) driverUids.push(d.id);
      });

      // Odometer trackables + latest/run-rate per vehicle.
      const odoByVehicle: Record<string, string> = {};
      trackSnap.forEach((d) => {
        const t = d.data() as Record<string, unknown>;
        if (t.type === 'odometer' && typeof t.vehicleId === 'string' && t.active !== false) {
          odoByVehicle[t.vehicleId] = d.id;
        }
      });

      for (const v of vehicles) {
        vehiclesChecked++;
        let latestKm: number | null = null;
        let kmPerDay: number | null = null;
        const trackableId = odoByVehicle[v.id];
        if (trackableId) {
          const rSnap = await famRef.collection('readings')
            .where('trackableId', '==', trackableId).get();
          const readings = rSnap.docs
            .map((d) => {
              const r = d.data() as Record<string, unknown>;
              return {
                value: Number(r.value) || 0,
                atMs: (r.capturedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0,
                event: String(r.event || 'normal'),
              };
            })
            .filter((r) => r.event !== 'rollback' && r.atMs > 0 && r.value > 0)
            .sort((a, b) => a.atMs - b.atMs);
          if (readings.length > 0) {
            const last = readings[readings.length - 1];
            latestKm = last.value;
            const windowed = readings.filter((r) => r.atMs >= last.atMs - 90 * 24 * 60 * 60 * 1000);
            const first = windowed[0];
            if (windowed.length >= 2 && last.atMs > first.atMs && last.value > first.value) {
              const days = (last.atMs - first.atMs) / (24 * 60 * 60 * 1000);
              if (days >= 1) kmPerDay = (last.value - first.value) / days;
            }
          }
        }

        const due = computeServiceDue({
          intervalKm: typeof v.serviceIntervalKm === 'number' ? v.serviceIntervalKm : undefined,
          intervalMonths: typeof v.serviceIntervalMonths === 'number' ? v.serviceIntervalMonths : undefined,
          baselineKm: typeof v.serviceBaselineKm === 'number' ? v.serviceBaselineKm : undefined,
          baselineDate: typeof v.serviceBaselineDate === 'string' ? v.serviceBaselineDate : undefined,
          nextKmOverride: typeof v.nextServiceKm === 'number' ? v.nextServiceKm : undefined,
          nextDateOverride: typeof v.nextServiceDate === 'string' ? v.nextServiceDate : undefined,
          latestKm, kmPerDay, todayIso: today,
        });
        const reminderState = serviceReminderState(due, {
          kmLeft: typeof v.remindKmLeft === 'number' ? v.remindKmLeft : 500,
          daysLeft: typeof v.remindDaysLeft === 'number' ? v.remindDaysLeft : 14,
        }, today);
        if (reminderState === 'none') continue;

        // ── Idempotency per service cycle ────────────────────────────
        const cycleKey = `${v.serviceBaselineDate ?? ''}|${v.serviceBaselineKm ?? ''}`;
        const st: CycleState = state[v.id]?.cycleKey === cycleKey ? state[v.id] : { cycleKey };
        if (reminderState === 'upcoming' && st.upcomingAt) continue;
        if (reminderState === 'overdue' && st.lastOverdueAt && nowMs - st.lastOverdueAt < WEEK_MS) continue;

        // ── Recipients (lock C) ──────────────────────────────────────
        const recip = (v.remindRecipients ?? {}) as { parents?: boolean; drivers?: boolean; allHelpers?: boolean };
        const uids = new Set<string>();
        if (recip.parents !== false) parentUids.forEach((u) => uids.add(u));
        if (recip.drivers !== false) driverUids.forEach((u) => uids.add(u));
        if (recip.allHelpers === true) helperUids.forEach((u) => uids.add(u));
        if (uids.size === 0) continue;

        // ── Compose ──────────────────────────────────────────────────
        const label = String(v.label || 'Vehicle');
        const overdue = reminderState === 'overdue';
        const kmLeftLine = overdue
          ? (due.overdueKm != null ? `+${fmtDist(due.overdueKm, distUnit)} over` : 'past the due date')
          : (due.kmLeft != null && due.kmLeft >= 0 ? `in ~${fmtDist(due.kmLeft, distUnit)}` : 'soon');
        const eff = effectiveDueIso(due);
        const expectedLine = [
          eff && !overdue ? `Expected ${toDisplayDate(eff)} at your family's pace` : null,
          due.hardStopIso ? `${overdue ? 'was due' : 'hard stop'} ${toDisplayDate(due.hardStopIso)}` : null,
        ].filter(Boolean).join(' · ') || 'Open Kaya → Drivers for details';
        const title = overdue
          ? `🔴 ${label} service OVERDUE`
          : `🛠️ ${label} service coming up`;
        const message = overdue
          ? `${kmLeftLine === 'past the due date' ? 'Past the due date' : kmLeftLine}. ${expectedLine}. Weekly nudge until a Service request closes.`
          : `${kmLeftLine.replace(/^in /, '')} left. ${expectedLine}.`;

        // In-app bell for every recipient.
        for (const uid of uids) {
          await famRef.collection('notifications').add({
            type: 'reminder',
            title,
            message,
            read: false,
            forUserId: uid,
            link: '/pantry/drivers',
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        // Email (Resend) — soft-fail so a mail hiccup never blocks the sweep.
        if (resend) {
          const to = Array.from(new Set(
            Array.from(uids).map((u) => emailByUid[u]).filter(Boolean),
          )).slice(0, 15);
          if (to.length) {
            const html = serviceEmailHtml({
              vehicleLabel: label, overdue, kmLeftLine, expectedLine, appUrl: APP_URL,
            });
            await resend.emails.send({
              from: FROM, to,
              subject: overdue
                ? `🔴 ${label} — service overdue`
                : `🛠️ ${label} — service due ${kmLeftLine}`,
              html,
            }).catch(() => {});
            emailed += to.length;
          }
        }
        // 💬 WhatsApp — same message; wired when the Neldi pipeline lands.

        // Stamp state (merge-upsert on the family doc — no rules change).
        await famRef.set({
          vehicleService: {
            [v.id]: {
              cycleKey,
              ...(overdue
                ? { lastOverdueAt: nowMs, ...(st.upcomingAt ? { upcomingAt: st.upcomingAt } : {}) }
                : { upcomingAt: nowMs }),
            },
          },
        }, { merge: true });
        fired++;
      }
    } catch (e) {
      // One broken family must never block the sweep.
      // eslint-disable-next-line no-console
      console.error('[cron/vehicle-service] family failed:', famDoc.id, e);
    }
  }

  return NextResponse.json({ ok: true, today, families, vehiclesChecked, fired, emailed });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
