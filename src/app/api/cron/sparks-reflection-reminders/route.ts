// Slice 7m · Daily Reflection reminders + parent miss alerts.
//
// Hourly sweep:
//   · For every family · every kid with reflection_reminders.kid_reminders_enabled:
//       - if today is an active day, the picked hour:minute window matches "now",
//         and today's sparks_reflections doc is missing → write a 🔔 in-app
//         notification to the kid's user doc.
//   · For every family · every kid with reflection_reminders.parent_alert_enabled:
//       - walk back active days counting consecutive misses; if missed ≥ N
//         and we haven't already alerted today (lastParentAlertOn ≠ today) →
//         🔔 in-app + 📧 email to every parent in the family.
//
// Admin SDK throughout (bypasses rules). Secured by CRON_SECRET when set.
// TZ-aware via TZ env (default Africa/Dar_es_Salaam) for the "today" key.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { dayKeyInTZ } from '@/lib/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

type DayOfWeek = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DOW_KEYS: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface ReflectionReminderSettings {
  kid_reminders_enabled: boolean;
  kid_reminder_hour: number;
  kid_reminder_minute: 0 | 30;
  active_days: DayOfWeek[];
  parent_alert_enabled: boolean;
  parent_alert_after_n_days: number;
}

/** Local-day key (YYYY-MM-DD) for a Date in the configured TZ. */
function localDayKey(d: Date): string {
  return dayKeyInTZ(d, TZ);
}

/** Local hour + dow for a Date in the configured TZ. */
function localHourDow(d: Date): { hour: number; minute: number; dow: DayOfWeek } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');
  const wd = parts.find((p) => p.type === 'weekday')?.value || 'Sun';
  const mapKey = (wd.slice(0, 3).toLowerCase() as DayOfWeek);
  const dow = DOW_KEYS.includes(mapKey) ? mapKey : 'sun';
  return { hour: hour % 24, minute, dow };
}

/** Walk back from `from` counting consecutive ACTIVE-day misses. Stops when
 *  it finds the first day where the kid logged a reflection, or when the
 *  window of active days has been exhausted (capped at 30 lookback). */
function consecutiveActiveMisses(
  loggedDays: Set<string>,
  activeMask: Set<DayOfWeek>,
  from: Date,
): number {
  let misses = 0;
  const cursor = new Date(from.getTime());
  for (let i = 0; i < 30; i++) {
    const key = localDayKey(cursor);
    const { dow } = localHourDow(cursor);
    if (activeMask.has(dow)) {
      if (loggedDays.has(key)) break;
      misses++;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return misses;
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });

  const now = new Date();
  const today = localDayKey(now);
  const { hour: nowHour, minute: nowMinute, dow: todayDow } = localHourDow(now);

  let families = 0, kidsScanned = 0, kidReminders = 0, parentAlerts = 0;

  const famSnap = await db.collection('families').get();
  for (const famDoc of famSnap.docs) {
    families++;
    try {
      const profilesSnap = await famDoc.ref.collection('sparks_profiles').get();
      if (profilesSnap.empty) continue;

      // Resolve parents once per family (avoids N+1 lookups).
      const usersSnap = await db.collection('users').where('familyId', '==', famDoc.id).get();
      const parentUsers = usersSnap.docs
        .filter((u) => (u.data().role || '') === 'parent')
        .map((u) => ({ uid: u.id, email: (u.data().email as string | undefined) || undefined }));

      for (const profDoc of profilesSnap.docs) {
        const kidId = profDoc.id;
        const settings = (profDoc.data().reflection_reminders ?? null) as ReflectionReminderSettings | null;
        if (!settings) continue;
        kidsScanned++;

        const activeMask = new Set<DayOfWeek>(settings.active_days || []);
        const todayActive = activeMask.has(todayDow);

        // Pull last 30 days of reflections once per kid.
        const reflSnap = await famDoc.ref.collection('sparks_reflections')
          .where('kidId', '==', kidId)
          .get();
        const loggedDays = new Set<string>(
          reflSnap.docs.map((r) => String(r.data().date || '')).filter((x) => x.length > 0),
        );

        // ── (a) Kid reminder — only at the picked hour:minute, on active days.
        if (
          settings.kid_reminders_enabled
          && todayActive
          && settings.kid_reminder_hour === nowHour
          && (settings.kid_reminder_minute === 30 ? nowMinute >= 30 : nowMinute < 30)
          && !loggedDays.has(today)
        ) {
          // Per-day idempotency: don't fire twice if cron re-runs.
          const flag = settings.kid_reminders_enabled ? `kr-${today}` : '';
          const profData = profDoc.data() as { reminderFiredKeys?: string[] };
          const already = new Set(profData.reminderFiredKeys || []);
          if (flag && !already.has(flag)) {
            await famDoc.ref.collection('notifications').add({
              type: 'sparks-reflection-reminder',
              title: `📔 A line for today?`,
              message: `Even one sentence keeps your streak alive 🔥`,
              read: false,
              forUserId: kidId,
              link: '/sparks',
              createdAt: FieldValue.serverTimestamp(),
            }).catch(() => {});
            await profDoc.ref.update({
              reminderFiredKeys: FieldValue.arrayUnion(flag),
            }).catch(() => {});
            kidReminders++;
          }
        }

        // ── (b) Parent miss alert — once per kid per day, after N missed
        // active days. Walks from yesterday so today's still-unlogged
        // state doesn't double-count.
        if (settings.parent_alert_enabled) {
          const yesterday = new Date(now.getTime());
          yesterday.setDate(yesterday.getDate() - 1);
          const misses = consecutiveActiveMisses(loggedDays, activeMask, yesterday);
          const threshold = Math.max(1, settings.parent_alert_after_n_days || 3);
          if (misses >= threshold) {
            const profData = profDoc.data() as { lastParentAlertOn?: string };
            if (profData.lastParentAlertOn !== today) {
              const kidName = (profDoc.data().displayName as string | undefined)
                || `${kidId.slice(0, 6)}`;
              for (const p of parentUsers) {
                await famDoc.ref.collection('notifications').add({
                  type: 'sparks-reflection-parent-alert',
                  title: `⚠️ ${kidName} missed ${misses} reflection days`,
                  message: `Streak about to slip — want to send a Kaya nudge?`,
                  read: false,
                  forUserId: p.uid,
                  link: '/sparks',
                  createdAt: FieldValue.serverTimestamp(),
                }).catch(() => {});
                if (resend && p.email) {
                  await resend.emails.send({
                    from: FROM,
                    to: [p.email],
                    subject: `⚠️ ${kidName} missed ${misses} Daily Reflection days`,
                    html: parentAlertEmail({ kidName, misses, threshold, appUrl: APP_URL }),
                  }).catch(() => {});
                }
              }
              await profDoc.ref.update({ lastParentAlertOn: today }).catch(() => {});
              parentAlerts++;
            }
          }
        }
      }
    } catch {
      continue;
    }
  }

  return NextResponse.json({ ok: true, today, families, kidsScanned, kidReminders, parentAlerts });
}

function parentAlertEmail(args: { kidName: string; misses: number; threshold: number; appUrl: string }): string {
  const { kidName, misses, threshold, appUrl } = args;
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:480px;margin:0 auto;padding:18px">
    <div style="border-radius:16px;padding:26px 18px;text-align:center;color:#fff;background:linear-gradient(135deg,#1B1547,#5A3CB8)">
      <div style="font-size:11px;font-weight:900;letter-spacing:2px;opacity:.85">🪞 KAYA SPARKS · DAILY REFLECTION</div>
      <div style="font-size:30px;margin-top:8px">⚠️</div>
      <div style="font-size:18px;font-weight:900;margin-top:6px">${kidName} missed ${misses} reflection days</div>
      <div style="font-size:12.5px;opacity:.9;margin-top:3px">You asked us to alert you after ${threshold}.</div>
    </div>
    <div style="background:#fff;border:1px solid #ECE4D3;border-radius:14px;padding:18px;margin-top:14px;color:#0F1F44;font-size:14px;line-height:1.55">
      The streak is about to slip. A quick check-in tonight usually saves it — kids who get nudged about their streak come back to it the next day in our data.
    </div>
    <div style="text-align:center;margin-top:16px">
      <a href="${appUrl}/sparks" style="display:inline-block;background:#D4A847;color:#3D2E08;font-weight:900;font-size:14px;border-radius:999px;padding:11px 28px;text-decoration:none">Open Sparks →</a>
    </div>
    <p style="font-size:10.5px;color:#5A6488;margin-top:16px;text-align:center">You can change the threshold or turn off this alert from /sparks/setup.</p>
  </div>`;
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
