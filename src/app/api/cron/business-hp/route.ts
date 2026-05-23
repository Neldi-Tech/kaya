// Kaya Business · weekly House-Points auto-award (server cron, Phase 2 · A3).
//
// Runs weekly (see vercel.json). Only acts on families whose
// businessConfig.hpAward.mode === 'auto'. For each kid, awards
// perDayHp × (distinct stock-take days this week), capped at weeklyCapHp,
// posting a normal 'regular' award (Admin SDK → families/{f}/awards + the
// child's running totals — mirrors giveAward). Idempotent per week via a
// marker field on the child.
//
// Families on the default 'parent_review' mode are skipped — the parent awards
// from the console. Safe before configuration: no-ops without admin creds.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  const weekKey = utcDateKey(now);
  const weekDates = new Set<string>();
  for (let i = 0; i < 7; i++) { const d = new Date(now); d.setUTCDate(now.getUTCDate() - i); weekDates.add(utcDateKey(d)); }

  let families;
  try { families = await db.collection('families').get(); }
  catch (e) { return NextResponse.json({ error: 'families-read-failed', detail: String(e) }, { status: 500 }); }

  let awarded = 0;
  for (const fam of families.docs) {
    const hp = (fam.data()?.businessConfig?.hpAward) as
      { mode?: string; cadence?: string; perDayHp?: number; weeklyCapHp?: number; weeklyMinPct?: number } | undefined;
    // Only weekly-cadence auto families. Instant families grant per stock-take
    // (client/route), so the weekly batch must skip them to avoid double-paying.
    if (!hp || hp.mode !== 'auto' || (hp.cadence || 'instant') !== 'weekly') continue;
    const perDay = Number(hp.perDayHp ?? 1);
    const cap = Number(hp.weeklyCapHp ?? 40);
    const minPct = Number(hp.weeklyMinPct ?? 80);
    const needDays = Math.ceil((7 * Math.max(0, Math.min(100, minPct))) / 100);

    let bizSnap;
    try { bizSnap = await fam.ref.collection('businesses').get(); }
    catch { continue; }

    // Group businesses by owner kid.
    const byOwner = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (const d of bizSnap.docs) {
      const ownerId = (d.data() as { ownerId?: string }).ownerId;
      if (!ownerId) continue;
      (byOwner.get(ownerId) ?? byOwner.set(ownerId, []).get(ownerId)!).push(d);
    }

    for (const [ownerId, bizDocs] of byOwner) {
      // Distinct stock-take days this week across the kid's businesses.
      const days = new Set<string>();
      for (const b of bizDocs) {
        try {
          const st = await b.ref.collection('stockTakes').get();
          st.docs.forEach((s) => { const date = (s.data() as { date?: string }).date; if (date && weekDates.has(date)) days.add(date); });
        } catch { /* skip this business */ }
      }
      // Weekly minimum: only pay out if the kid hit the threshold % of days.
      if (days.size < needDays) continue;
      const points = Math.min(cap, days.size * perDay);
      if (points <= 0) continue;

      const childRef = fam.ref.collection('children').doc(ownerId);
      let childSnap;
      try { childSnap = await childRef.get(); } catch { continue; }
      if (!childSnap.exists) continue;
      const child = childSnap.data() as { totalPoints?: number; weeklyPoints?: number; lastBusinessAutoAwardWeek?: string };
      if (child.lastBusinessAutoAwardWeek === weekKey) continue; // already auto-awarded this week

      try {
        await fam.ref.collection('awards').add({
          childId: ownerId, kind: 'regular', points,
          reason: `Kaya Business — stock-take effort this week (${days.size} ${days.size === 1 ? 'day' : 'days'})`,
          category: 'business', awardedBy: 'system', awardedByName: 'Auto-award', senderRole: 'parent',
          createdAt: now,
        });
        await childRef.update({
          totalPoints: (child.totalPoints || 0) + points,
          weeklyPoints: (child.weeklyPoints || 0) + points,
          lastBusinessAutoAwardWeek: weekKey,
        });
        awarded++;
      } catch { /* best-effort per kid */ }
    }
  }

  return NextResponse.json({ ok: true, weekKey, awarded });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
