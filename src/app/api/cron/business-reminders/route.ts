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

// Business 2.0 (R14/R15) — does this business keep countable stock? Mirrors
// keepsStock() in business.ts without importing the client lib into a server
// route: the per-business switch wins, else the model default, else the
// legacy type mapping (only goods counted stock before 2.0).
function bizKeepsStock(b: { stockTaking?: boolean; pricingModel?: string; type?: string }): boolean {
  if (typeof b.stockTaking === 'boolean') return b.stockTaking;
  if (b.pricingModel) return b.pricingModel === 'unit_stocked';
  return b.type === 'goods';
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
      const biz = d.data() as { ownerId?: string; name?: string; stockTaking?: boolean; pricingModel?: string; type?: string };
      const bizId = d.id;
      // Already stock-taken / checked-in today? skip.
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

      // Business 2.0 — wording + destination follow the stock switch (R15).
      const stocked = bizKeepsStock(biz);
      const title = stocked ? '📋 Stock-take time' : '☀️ Check-in time';
      const message = stocked
        ? `Update ${biz.name || 'your business'} for today — counts + a photo.`
        : `How did ${biz.name || 'your business'} go today? Log your sales — it takes a minute.`;
      const link = `/business/${bizId}/${stocked ? 'stocktake' : 'checkin'}`;
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
