// Kaya Business · daily stock-take reminders (server cron, Phase 2 · A2).
//
// Runs hourly (see vercel.json). For every active business whose reminder is
// due this hour AND hasn't been stock-taken today, nudges the owner kid +
// the family's parents — in-app notification (Admin Firestore) + best-effort
// web-push (the existing /api/push). reminder.hourUtc is computed client-side
// from the parent's local pick, so no per-family timezone is needed here.
//
// Safe before configuration: no-ops when the Admin SDK isn't set. Secured by
// CRON_SECRET when that env var is present.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

function utcDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const now = new Date();
  const hourUtc = now.getUTCHours();
  const dateKey = utcDateKey(now);

  let families;
  try { families = await db.collection('families').get(); }
  catch (e) { return NextResponse.json({ error: 'families-read-failed', detail: String(e) }, { status: 500 }); }

  let nudged = 0;
  for (const fam of families.docs) {
    const fid = fam.id;
    let bizSnap;
    try { bizSnap = await fam.ref.collection('businesses').get(); }
    catch { continue; }

    const due = bizSnap.docs.filter((d) => {
      const b = d.data() as { status?: string; reminder?: { enabled?: boolean; hourUtc?: number } };
      return b.status === 'active' && b.reminder?.enabled === true && b.reminder?.hourUtc === hourUtc;
    });
    if (due.length === 0) continue;

    // Resolve recipients once per family (parents are shared).
    let parentUids: string[] = [];
    try {
      const ps = await db.collection('users').where('familyId', '==', fid).where('role', '==', 'parent').get();
      parentUids = ps.docs.map((d) => d.id);
    } catch { /* leave empty */ }

    for (const d of due) {
      const biz = d.data() as { ownerId?: string; name?: string };
      const bizId = d.id;
      // Already stock-taken today? skip.
      try {
        const took = await d.ref.collection('stockTakes').doc(dateKey).get();
        if (took.exists) continue;
      } catch { /* fall through — better a maybe-dup nudge than none */ }

      const recipients = new Set<string>(parentUids);
      if (biz.ownerId) {
        try {
          const ks = await db.collection('users').where('familyId', '==', fid).where('childId', '==', biz.ownerId).get();
          ks.docs.forEach((k) => recipients.add(k.id));
        } catch { /* parents still get it */ }
      }
      if (recipients.size === 0) continue;

      const title = '📋 Stock-take time';
      const message = `Update ${biz.name || 'your business'} for today — counts + a photo.`;
      const link = `/business/${bizId}/stocktake`;
      for (const uid of recipients) {
        try {
          await fam.ref.collection('notifications').add({
            type: 'business-stocktake-reminder', title, message, read: false,
            forUserId: uid, link, createdAt: now,
          });
        } catch { /* best-effort */ }
        // Fire-and-forget push.
        void fetch(`${APP_URL}/api/push`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ uid, title, body: message, url: link, tag: `stocktake-${bizId}` }),
        }).catch(() => {});
      }
      nudged++;
    }
  }

  return NextResponse.json({ ok: true, hourUtc, nudged });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
