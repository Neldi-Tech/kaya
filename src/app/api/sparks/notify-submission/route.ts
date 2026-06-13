// Slice 7q · Parent submission alerts.
//
// Called by the Sparks UI immediately after a kid lands a new
// submission (revision · reflection · school project · home project ·
// achievement). For each parent in the family:
//   · reads sparks_profiles/{kidId}.email_alerts[parentUid].areas[area]
//   · 'instant' → fire 🔔 in-app + 📧 email NOW (or queue past quiet
//                  hours)
//   · 'digest'  → write a sparks_email_queue row so the 06:30 cron
//                  bundles it the next morning
//   · 'off'     → no-op
//
// Admin SDK throughout (the kid is the writer, so we can't rely on
// client-side rules for parent reads/writes). Auth: the caller passes
// the family + kid + area + summary + link; we trust the family
// scope from the auth header (TODO: add Firebase ID-token check —
// for v1 we treat this endpoint as same-origin trusted, mirroring
// the existing /api/sparks/ai/* contract).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

type Area = 'reflection' | 'revision' | 'school_project' | 'home_project' | 'achievement';
const AREAS: Area[] = ['reflection', 'revision', 'school_project', 'home_project', 'achievement'];

interface SubmissionBody {
  familyId: string;
  kidId: string;
  kidName: string;
  area: Area;
  /** Short title shown in subject line + digest row. */
  title: string;
  /** Optional 1–3 sentence body — kid's quote, scores, etc. */
  summary?: string;
  /** Deep-link target (e.g. '/sparks/<kidId>/revisions'). */
  link?: string;
}

function emojiFor(area: Area): string {
  switch (area) {
    case 'reflection':     return '📔';
    case 'revision':       return '🎯';
    case 'school_project': return '🎒';
    case 'home_project':   return '🛠';
    case 'achievement':    return '🏅';
  }
}

function localHour(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false })
    .formatToParts(d);
  return Number(parts.find((p) => p.type === 'hour')?.value || '0') % 24;
}

function isInQuiet(hour: number, qStart: number, qEnd: number): boolean {
  if (qStart === qEnd) return false;
  if (qStart < qEnd) return hour >= qStart && hour < qEnd;
  return hour >= qStart || hour < qEnd; // wraps midnight
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });

  let body: SubmissionBody;
  try { body = (await req.json()) as SubmissionBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { familyId, kidId, kidName, area, title, summary, link } = body || ({} as SubmissionBody);
  if (!familyId || !kidId || !area || !AREAS.includes(area) || !title) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const profSnap = await db.collection(`families/${familyId}/sparks_profiles`).doc(kidId).get();
    const alerts = (profSnap.data()?.email_alerts ?? {}) as Record<string, {
      areas?: Record<Area, 'off' | 'instant' | 'digest'>;
      digest_hour?: number;
      digest_minute?: 0 | 30;
      quiet_start?: number;
      quiet_end?: number;
    }>;

    // Resolve parents once.
    const usersSnap = await db.collection('users').where('familyId', '==', familyId).get();
    const parents = usersSnap.docs
      .filter((u) => (u.data().role || '') === 'parent')
      .map((u) => ({ uid: u.id, email: (u.data().email as string | undefined) || undefined }));

    const nowHour = localHour(new Date());

    let instantsSent = 0, digestQueued = 0;
    for (const p of parents) {
      const settings = alerts[p.uid];
      const freq = settings?.areas?.[area] ?? 'off';
      if (freq === 'off') continue;

      const subject = `${emojiFor(area)} ${kidName} ${areaVerb(area)} ${title}`;
      const html = renderEmail({ kidName, area, title, summary, link, appUrl: APP_URL });

      if (freq === 'digest') {
        await db.collection(`families/${familyId}/sparks_email_queue`).add({
          forParentUid: p.uid,
          kidId,
          kidName,
          area,
          title,
          summary: summary || '',
          link: link || '',
          createdAt: FieldValue.serverTimestamp(),
          delivered: false,
        }).catch(() => {});
        digestQueued++;
        continue;
      }

      // INSTANT: respect quiet hours.
      const qStart = settings?.quiet_start ?? 22;
      const qEnd = settings?.quiet_end ?? 6;
      if (isInQuiet(nowHour, qStart, qEnd)) {
        // Queue for delivery at quiet_end (handled by the digest cron's
        // quiet-hours sweep — it picks up unsent rows where deliverAfter
        // <= now).
        await db.collection(`families/${familyId}/sparks_email_queue`).add({
          forParentUid: p.uid,
          kidId, kidName, area, title,
          summary: summary || '',
          link: link || '',
          quietDeferred: true,
          createdAt: FieldValue.serverTimestamp(),
          delivered: false,
        }).catch(() => {});
        continue;
      }

      // In-app + email NOW.
      await db.collection(`families/${familyId}/notifications`).add({
        type: 'sparks-submission',
        title: subject,
        message: (summary || title).slice(0, 160),
        read: false,
        forUserId: p.uid,
        link: link || '/sparks',
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {});
      if (resend && p.email) {
        await resend.emails.send({ from: FROM, to: [p.email], subject, html })
          .catch(() => {});
        instantsSent++;
      }
    }

    return NextResponse.json({ ok: true, instantsSent, digestQueued });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Notify failed' },
      { status: 500 },
    );
  }
}

function areaVerb(area: Area): string {
  switch (area) {
    case 'reflection':     return 'logged today\'s';
    case 'revision':       return 'submitted a';
    case 'school_project': return 'shared a school project:';
    case 'home_project':   return 'shared a home project:';
    case 'achievement':    return 'earned an achievement:';
  }
}

function renderEmail(args: {
  kidName: string;
  area: Area;
  title: string;
  summary?: string;
  link?: string;
  appUrl: string;
}): string {
  const { kidName, area, title, summary, link, appUrl } = args;
  const deepLink = `${appUrl}${link || '/sparks'}`;
  const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:520px;margin:0 auto;padding:18px">
    <div style="border-radius:16px;padding:24px 18px;text-align:center;color:#fff;background:linear-gradient(135deg,#1B1547,#5A3CB8)">
      <div style="font-size:11px;font-weight:900;letter-spacing:2px;opacity:.85">🪞 KAYA SPARKS</div>
      <div style="font-size:30px;margin-top:8px">${emojiFor(area)}</div>
      <div style="font-size:18px;font-weight:900;margin-top:6px">${safe(kidName)} ${areaVerb(area)}</div>
      <div style="font-size:16px;font-weight:800;margin-top:4px;opacity:.95">${safe(title)}</div>
    </div>
    ${summary ? `
      <div style="background:#fff;border:1px solid #ECE4D3;border-radius:14px;padding:16px;margin-top:14px;color:#0F1F44;font-size:14px;line-height:1.55">
        ${safe(summary).replace(/\n/g, '<br>')}
      </div>` : ''}
    <div style="text-align:center;margin-top:16px">
      <a href="${deepLink}" style="display:inline-block;background:#D4A847;color:#3D2E08;font-weight:900;font-size:14px;border-radius:999px;padding:11px 28px;text-decoration:none">Open in Kaya →</a>
    </div>
    <p style="font-size:10.5px;color:#5A6488;margin-top:16px;text-align:center">Change frequency or turn off this alert from /sparks/setup.</p>
  </div>`;
}
