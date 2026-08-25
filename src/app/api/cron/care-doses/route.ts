// 💊 v5 — hourly Care sweep (approved Logic closes #1/#2, 25-Aug-2026).
// Three jobs in one route, all idempotent:
//   1. MISSED-DOSE LADDER (every run): a dose unticked at slot+30 → nudge
//      the giver(s); +60 → ping the parents; +90 → stamp `missed` + the
//      instant 🚨 email (watchMissedEmail). Rungs recorded per-slot in
//      DoseEntry.ladder — each fires exactly once. A late ✓ still flips
//      the record honestly. Self-care gets rung 1 only (privacy).
//   2. EVENING SUMMARY (20:00 local): one 📧 per active kid-care schedule
//      per day — "💊 All 3 given ✅ — Earlnathan, day 2 of 7". Idempotent
//      via firedKeys `care-summary:{day}`.
//   3. COURSE COMPLETE (20:00 local, last day): 🏁 email + bell, once,
//      via firedKeys `care-complete`. (PR E adds the 🛡 badge mint here.)
//
// Auth: CRON_SECRET bearer (unset = open for manual test, like siblings).
// TZ: Africa/Dar_es_Salaam — same reference as the daily reminders cron.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminMessaging } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import {
  occursOn, doseKeyFor, careEndDate, slotIcon,
  type ReminderEvent, type DoseEntry,
} from '@/lib/reminders';
import { renderCareSummaryEmail, renderCareMissedEmail, renderCareCompleteEmail } from '@/lib/careEmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const resend = apiKey ? new Resend(apiKey) : null;

const TZ = 'Africa/Dar_es_Salaam';
const SUMMARY_HOUR = 20;
const LADDER_MINS = [30, 60, 90] as const;

function nowInTZ(): { dayKey: string; minutes: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  const hour = parseInt(get('hour'), 10) % 24;
  const minutes = hour * 60 + parseInt(get('minute'), 10);
  return { dayKey: `${get('year')}-${get('month')}-${get('day')}`, minutes, hour };
}

const slotMins = (t: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
};

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });
  const messaging = getAdminMessaging();

  const { dayKey: today, minutes: nowMins, hour } = nowInTZ();
  let families = 0, scanned = 0, rungs = 0, missedStamped = 0, summaries = 0, completions = 0, emailed = 0;

  async function push(uid: string, title: string, body: string, url: string, tag: string) {
    if (!messaging || !uid || uid === 'system') return;
    try {
      const toks = await db!.collection('users').doc(uid).collection('fcmTokens').get();
      const tokens = toks.docs.map((d) => d.id).filter(Boolean);
      if (!tokens.length) return;
      await messaging.sendEachForMulticast({
        tokens,
        data: { title, body: body.slice(0, 160), url, tag },
      });
    } catch { /* push is best-effort */ }
  }

  async function bell(familyRef: FirebaseFirestore.DocumentReference, uid: string, title: string, message: string) {
    if (!uid || uid === 'system') return;
    await familyRef.collection('notifications').add({
      type: 'reminder', title, message, read: false, forUserId: uid,
      link: '/reminders', createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
  }

  const famSnap = await db.collection('families').get();
  for (const famDoc of famSnap.docs) {
    families++;
    try {
      const careSnap = await famDoc.ref.collection('reminders')
        .where('type', 'in', ['medicine', 'routine']).get();
      if (careSnap.empty) continue;

      // Parents once per family (targets for rungs 2–3 + emails).
      let parents: Array<{ uid: string; email?: string }> | null = null;
      async function getParents() {
        if (parents) return parents;
        const ps = await db!.collection('users')
          .where('familyId', '==', famDoc.id).where('role', '==', 'parent').get();
        parents = ps.docs.map((d) => ({ uid: d.id, email: (d.data().email as string | undefined) }));
        return parents;
      }

      for (const d of careSnap.docs) {
        const ev = { id: d.id, ...(d.data() as Record<string, unknown>) } as ReminderEvent;
        scanned++;
        const care = ev.care;
        if (!care || !occursOn(ev, today)) continue;
        const kid = care.forName || ev.title;
        const isSelf = care.forKind === 'self';
        const log: DoseEntry[] = (ev.doseLog || []).slice();
        const fired = new Set(ev.firedKeys || []);
        let logChanged = false;
        const newFired: string[] = [];

        // ── 1 · Missed-dose ladder ──────────────────────────────────────
        for (let i = 0; i < care.slots.length; i++) {
          const slot = care.slots[i];
          const icon = slot.icon || slotIcon(slot.time);
          const overdue = nowMins - slotMins(slot.time);
          if (overdue < LADDER_MINS[0]) continue;
          const key = doseKeyFor(today, i);
          let idx = log.findIndex((x) => x.key === key);
          if (idx >= 0 && log[idx].status) continue; // given/late/skipped/missed — done
          if (idx < 0) { log.push({ key }); idx = log.length - 1; }
          const entry = { ...log[idx] };
          const done = new Set(entry.ladder || []);
          const maxRung = isSelf ? 1 : 3; // self-care: private, rung 1 only

          for (let rung = 1; rung <= maxRung; rung++) {
            if (overdue < LADDER_MINS[rung - 1] || done.has(rung)) continue;
            if (rung === 1) {
              const targets = isSelf ? [ev.ownerUid] : (care.giverUids || []);
              for (const uid of targets) {
                await bell(famDoc.ref, uid, `⏰ ${icon} ${slot.time} — ${isSelf ? 'your dose is waiting' : `${kid}'s dose is waiting`}`, `${care.dose} · tap ✓ when given`);
                await push(uid, `⏰ ${icon} ${slot.time} dose waiting`, isSelf ? care.dose : `${kid} · ${care.dose}`, '/my-day', `care-${ev.id}-${key}-1`);
              }
            } else if (rung === 2) {
              for (const p of await getParents()) {
                if ((care.giverUids || []).includes(p.uid)) continue;
                await bell(famDoc.ref, p.uid, `👀 ${kid}'s ${icon} dose isn't ticked yet`, `${slot.time} + 1 hour · the giver was reminded`);
                await push(p.uid, `👀 ${kid}'s ${icon} dose unticked`, `${slot.time} + 1 hour`, '/reminders', `care-${ev.id}-${key}-2`);
              }
            } else {
              entry.status = 'missed';
              missedStamped++;
              for (const p of await getParents()) {
                await bell(famDoc.ref, p.uid, `🚨 Missed: ${kid}'s ${icon} ${slot.time} dose`, 'Recorded as missed — a late ✓ from the giver corrects it honestly.');
              }
              if (care.watchMissedEmail !== false && resend) {
                const to = (await getParents()).map((p) => p.email).filter((e): e is string => !!e);
                if (to.length) {
                  const { subject, html } = renderCareMissedEmail({ event: { ...ev, doseLog: log }, dateKey: today, slotIndex: i, appUrl: APP_URL });
                  await resend.emails.send({ from: FROM, to, subject, html }).catch(() => {});
                  emailed += to.length;
                }
              }
            }
            done.add(rung);
            rungs++;
          }
          entry.ladder = Array.from(done).sort((a, b) => a - b);
          log[idx] = entry;
          logChanged = true;
        }

        // ── 2+3 · Evening summary / course complete (kid-care only) ────
        if (!isSelf && hour === SUMMARY_HOUR) {
          const evNow = { ...ev, doseLog: log };
          const isLastDay = careEndDate(ev) === today;
          const summaryKey = `care-summary:${today}`;
          if (care.watchSummaryEmail !== false && !fired.has(summaryKey) && resend) {
            const to = (await getParents()).map((p) => p.email).filter((e): e is string => !!e);
            if (to.length) {
              const { subject, html } = isLastDay
                ? renderCareCompleteEmail({ event: evNow, dateKey: today, appUrl: APP_URL })
                : renderCareSummaryEmail({ event: evNow, dateKey: today, appUrl: APP_URL });
              await resend.emails.send({ from: FROM, to, subject, html }).catch(() => {});
              emailed += to.length;
              summaries++;
            }
            newFired.push(summaryKey);
          }
          if (isLastDay && !fired.has('care-complete')) {
            completions++;
            for (const p of await getParents()) {
              await bell(famDoc.ref, p.uid, `🏁 Course complete — ${kid}! 🎉`, `${ev.title} · the full trail is in Reminders.`);
            }
            newFired.push('care-complete');
          }
        }

        if (logChanged || newFired.length) {
          await d.ref.update({
            ...(logChanged ? { doseLog: log.slice(-270) } : {}),
            ...(newFired.length ? { firedKeys: FieldValue.arrayUnion(...newFired) } : {}),
          }).catch(() => {});
        }
      }
    } catch {
      continue; // one broken family never blocks the sweep
    }
  }

  return NextResponse.json({ ok: true, today, hour, families, scanned, rungs, missedStamped, summaries, completions, emailed });
}
