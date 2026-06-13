// Slice 7q · Daily digest sweep for parent submission alerts.
//
// Runs every 30 minutes. For each family, finds parents whose digest
// hour:minute matches the current local time AND who have undelivered
// rows in sparks_email_queue. Bundles all queued items into one email
// per parent, marks delivered, fires 🔔 in-app.
//
// Also flushes quietDeferred=true rows once we're past quiet_end —
// these are instant emails that landed during quiet hours and have
// been waiting for the allowed window.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue, type Query } from 'firebase-admin/firestore';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

function localHourMin(d: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value || '0') % 24,
    minute: Number(parts.find((p) => p.type === 'minute')?.value || '0'),
  };
}

function isPastQuietEnd(nowHour: number, qStart: number, qEnd: number): boolean {
  if (qStart === qEnd) return true;
  if (qStart < qEnd) return nowHour >= qEnd || nowHour < qStart;
  return nowHour >= qEnd && nowHour < qStart;
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
  const { hour, minute } = localHourMin(now);
  const minuteSlot = minute < 30 ? 0 : 30;

  let families = 0, digestEmails = 0, quietFlushed = 0;

  const famSnap = await db.collection('families').get();
  for (const famDoc of famSnap.docs) {
    families++;
    try {
      const usersSnap = await db.collection('users').where('familyId', '==', famDoc.id).get();
      const parents = usersSnap.docs
        .filter((u) => (u.data().role || '') === 'parent')
        .map((u) => ({ uid: u.id, email: (u.data().email as string | undefined) || undefined }));
      if (parents.length === 0) continue;

      // Collect per-parent settings (use first kid's settings as proxy —
      // typical SMB family case where both parents pick once per kid).
      const profilesSnap = await famDoc.ref.collection('sparks_profiles').get();

      for (const p of parents) {
        // Find this parent's preferred digest hour from any kid's profile.
        let digestHour = 6, digestMinute: 0 | 30 = 30, quietStart = 22, quietEnd = 6;
        for (const prof of profilesSnap.docs) {
          const settings = (prof.data().email_alerts ?? {}) as Record<string, {
            digest_hour?: number; digest_minute?: 0 | 30;
            quiet_start?: number; quiet_end?: number;
          }>;
          const s = settings[p.uid];
          if (s) {
            digestHour = s.digest_hour ?? 6;
            digestMinute = (s.digest_minute === 30 ? 30 : 0) as 0 | 30;
            quietStart = s.quiet_start ?? 22;
            quietEnd = s.quiet_end ?? 6;
            break;
          }
        }

        const queueQ: Query = famDoc.ref.collection('sparks_email_queue')
          .where('forParentUid', '==', p.uid)
          .where('delivered', '==', false);
        const queueSnap = await queueQ.get();
        if (queueSnap.empty) continue;

        type QueueItem = {
          id: string;
          forParentUid?: string;
          kidId?: string;
          kidName?: string;
          area?: string;
          title?: string;
          summary?: string;
          link?: string;
          quietDeferred?: boolean;
          delivered?: boolean;
        };
        const items: QueueItem[] = queueSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<QueueItem, 'id'>) }));

        // Split quiet-deferred (instant emails that should fire NOW
        // if we're past quiet_end) from regular digest items.
        const quietPending = items.filter((it) => it.quietDeferred === true);
        const digestPending = items.filter((it) => it.quietDeferred !== true);

        // QUIET-DEFERRED FLUSH: each row gets its own email (these
        // were originally instants).
        if (quietPending.length > 0 && isPastQuietEnd(hour, quietStart, quietEnd)) {
          for (const it of quietPending) {
            if (resend && p.email) {
              await resend.emails.send({
                from: FROM,
                to: [p.email],
                subject: `${itemEmoji(String(it.area))} ${String(it.kidName)} · ${String(it.title)}`,
                html: oneEmail({
                  kidName: String(it.kidName),
                  area: String(it.area),
                  title: String(it.title),
                  summary: String(it.summary || ''),
                  link: String(it.link || ''),
                  appUrl: APP_URL,
                }),
              }).catch(() => {});
            }
            await famDoc.ref.collection('sparks_email_queue').doc(String(it.id))
              .update({ delivered: true, deliveredAt: FieldValue.serverTimestamp() })
              .catch(() => {});
            quietFlushed++;
          }
        }

        // DIGEST: only at the parent's picked hour:minute.
        const isDigestSlot = hour === digestHour && minuteSlot === digestMinute;
        if (isDigestSlot && digestPending.length > 0) {
          const subject = `🌅 Yesterday in Sparks · ${digestPending.length} ${digestPending.length === 1 ? 'item' : 'items'}`;
          const html = digestEmail({ items: digestPending.map((it) => ({
            kidName: String(it.kidName), area: String(it.area), title: String(it.title),
            summary: String(it.summary || ''), link: String(it.link || ''),
          })), appUrl: APP_URL });

          if (resend && p.email) {
            await resend.emails.send({ from: FROM, to: [p.email], subject, html }).catch(() => {});
            digestEmails++;
          }
          await famDoc.ref.collection('notifications').add({
            type: 'sparks-digest',
            title: `🌅 ${digestPending.length} new in Sparks`,
            message: digestPending.slice(0, 3)
              .map((it) => `${String(it.kidName)} · ${String(it.title)}`).join(' · ')
              .slice(0, 160),
            read: false,
            forUserId: p.uid,
            link: '/sparks',
            createdAt: FieldValue.serverTimestamp(),
          }).catch(() => {});

          // Mark all digested items delivered.
          for (const it of digestPending) {
            await famDoc.ref.collection('sparks_email_queue').doc(String(it.id))
              .update({ delivered: true, deliveredAt: FieldValue.serverTimestamp() })
              .catch(() => {});
          }
        }
      }
    } catch {
      continue;
    }
  }

  return NextResponse.json({ ok: true, families, digestEmails, quietFlushed });
}

function itemEmoji(area: string): string {
  switch (area) {
    case 'reflection':     return '📔';
    case 'revision':       return '🎯';
    case 'school_project': return '🎒';
    case 'home_project':   return '🛠';
    case 'achievement':    return '🏅';
    default: return '✨';
  }
}

function oneEmail(a: { kidName: string; area: string; title: string; summary: string; link: string; appUrl: string }): string {
  const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:520px;margin:0 auto;padding:18px">
    <div style="border-radius:16px;padding:22px 18px;text-align:center;color:#fff;background:linear-gradient(135deg,#1B1547,#5A3CB8)">
      <div style="font-size:11px;font-weight:900;letter-spacing:2px;opacity:.85">🪞 KAYA SPARKS</div>
      <div style="font-size:28px;margin-top:6px">${itemEmoji(a.area)}</div>
      <div style="font-size:17px;font-weight:900;margin-top:4px">${safe(a.kidName)}</div>
      <div style="font-size:15px;font-weight:800;margin-top:2px;opacity:.95">${safe(a.title)}</div>
    </div>
    ${a.summary ? `<div style="background:#fff;border:1px solid #ECE4D3;border-radius:14px;padding:14px;margin-top:12px;color:#0F1F44;font-size:13.5px;line-height:1.55">${safe(a.summary)}</div>` : ''}
    <div style="text-align:center;margin-top:14px"><a href="${a.appUrl}${a.link || '/sparks'}" style="display:inline-block;background:#D4A847;color:#3D2E08;font-weight:900;font-size:13.5px;border-radius:999px;padding:10px 24px;text-decoration:none">Open in Kaya →</a></div>
  </div>`;
}

function digestEmail(a: { items: Array<{ kidName: string; area: string; title: string; summary: string; link: string }>; appUrl: string }): string {
  const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const grouped = new Map<string, typeof a.items>();
  for (const it of a.items) {
    const k = it.kidName || '—';
    grouped.set(k, [...(grouped.get(k) ?? []), it]);
  }
  const sections = Array.from(grouped.entries()).map(([kid, items]) => `
    <div style="margin-top:14px">
      <div style="font-weight:900;font-size:14px;color:#1B1547;margin-bottom:6px">${safe(kid)} · ${items.length} item${items.length === 1 ? '' : 's'}</div>
      ${items.map((it) => `
        <div style="background:#FBF7EE;border-radius:10px;padding:9px 12px;margin:6px 0;color:#0F1F44;font-size:13px">
          ${itemEmoji(it.area)} <strong>${safe(it.title)}</strong>
          ${it.summary ? `<br><span style="color:#5A6488;font-size:12px">${safe(it.summary).slice(0, 140)}${it.summary.length > 140 ? '…' : ''}</span>` : ''}
        </div>`).join('')}
    </div>`).join('');
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:520px;margin:0 auto;padding:18px">
    <div style="border-radius:16px;padding:22px 18px;text-align:center;color:#fff;background:linear-gradient(135deg,#FFB627,#FFD93D)">
      <div style="font-size:11px;font-weight:900;letter-spacing:2px;color:#5A4500">🌅 KAYA SPARKS · DAILY DIGEST</div>
      <div style="font-size:17px;font-weight:900;margin-top:6px;color:#5A4500">Yesterday in Sparks</div>
    </div>
    ${sections}
    <div style="text-align:center;margin-top:16px"><a href="${a.appUrl}/sparks" style="display:inline-block;background:#5A3CB8;color:#fff;font-weight:900;font-size:13.5px;border-radius:999px;padding:10px 24px;text-decoration:none">Open Sparks →</a></div>
    <p style="font-size:10.5px;color:#5A6488;margin-top:14px;text-align:center">Change rhythm or switch items to instant from /sparks/setup.</p>
  </div>`;
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
