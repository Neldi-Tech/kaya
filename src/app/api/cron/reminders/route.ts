// Daily firing sweep for Kaya Reminders. For every family's stored reminder,
// works out which lead-time reminders land TODAY (on the day / 1d / 1wk /
// custom), then for each one not already fired:
//   • 🔔 writes an in-app notification (owner + selected member recipients)
//   • 📧 sends the branded reminder email to the event's recipient list
//   • stamps `${occurrence}:${lead}` into firedKeys (idempotent)
//
// Admin SDK throughout (bypasses rules). Secured by CRON_SECRET when set
// (Vercel sends it as a Bearer token); allowed when unset for manual test.
// Auto-imported family birthdays are NOT fired here — the Birthdays engine
// owns those; this cron only fires stored reminder events.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { dayKeyInTZ } from '@/lib/dates';
import {
  leadFiringsForToday, firedKeyFor, type ReminderEvent,
} from '@/lib/reminders';
import { renderReminderEmail } from '@/lib/reminderEmail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const resend = apiKey ? new Resend(apiKey) : null;

// Kaya's reference timezone for "which calendar day is today" (matches
// Kaya Pulse's daily generators). Reminders are day-granular.
const TZ = 'Africa/Dar_es_Salaam';

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });

  const today = dayKeyInTZ(new Date(), TZ);
  let scanned = 0, fired = 0, emailed = 0, families = 0;

  const famSnap = await db.collection('families').get();
  for (const famDoc of famSnap.docs) {
    families++;
    const familyId = famDoc.id;
    try {
      const remSnap = await famDoc.ref.collection('reminders').get();
      if (remSnap.empty) continue;

      for (const d of remSnap.docs) {
        const ev = { id: d.id, ...(d.data() as Record<string, unknown>) } as ReminderEvent;
        scanned++;
        if (ev.status === 'pending_parent') continue; // not shared yet
        const firings = leadFiringsForToday(ev, today);
        if (!firings.length) continue;

        const already = new Set(ev.firedKeys || []);
        const newKeys: string[] = [];

        for (const f of firings) {
          const key = firedKeyFor(f.occurrenceKey, f.lead);
          if (already.has(key)) continue;
          newKeys.push(key);

          // 🔔 in-app — owner + any selected member recipients.
          if (ev.channels?.inApp !== false) {
            const targets = new Set<string>([ev.ownerUid]);
            for (const r of ev.emailRecipients || []) {
              if (r.kind === 'member' && r.uid) targets.add(r.uid);
            }
            const meta = ev.type;
            for (const uid of targets) {
              if (!uid || uid === 'system') continue;
              await famDoc.ref.collection('notifications').add({
                type: 'reminder',
                title: `${emojiFor(meta)} ${whenWord(f.lead)}: ${ev.title}`,
                message: reminderLine(ev, f.lead),
                read: false,
                forUserId: uid,
                link: '/reminders',
                createdAt: FieldValue.serverTimestamp(),
              }).catch(() => {});
            }
          }

          // 📧 email — to the recipient list.
          if (ev.channels?.email && resend) {
            const to = Array.from(new Set((ev.emailRecipients || []).map((r) => r.email).filter(Boolean))).slice(0, 15);
            if (to.length) {
              const { subject, html } = renderReminderEmail({ event: ev, occurrenceKey: f.occurrenceKey, lead: f.lead, appUrl: APP_URL });
              await resend.emails.send({ from: FROM, to, subject, html }).catch(() => {});
              emailed += to.length;
            }
          }

          fired++;
        }

        if (newKeys.length) {
          await d.ref.update({ firedKeys: FieldValue.arrayUnion(...newKeys) }).catch(() => {});
        }
      }
    } catch {
      // Skip a broken family, keep sweeping the rest.
      continue;
    }
  }

  return NextResponse.json({ ok: true, today, families, scanned, fired, emailed });
}

function emojiFor(type: string): string {
  switch (type) {
    case 'birthday': return '🎂';
    case 'anniversary': return '💍';
    case 'appointment': return '🩺';
    case 'event': return '🎉';
    default: return '📌';
  }
}
function whenWord(lead: number): string {
  if (lead <= 0) return 'Today';
  if (lead === 1) return 'Tomorrow';
  if (lead === 7) return 'In a week';
  return `In ${lead} days`;
}
function reminderLine(ev: ReminderEvent, lead: number): string {
  const bits: string[] = [];
  if (ev.time) bits.push(to12h(ev.time));
  if (ev.withWho) bits.push(`with ${ev.withWho}`);
  if (ev.location) bits.push(ev.location);
  const tail = bits.length ? ` · ${bits.join(' · ')}` : '';
  return `${whenWord(lead)}${tail}`.trim();
}
function to12h(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
