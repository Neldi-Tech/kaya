// HP2 · GET /api/helpers/perf-weeks?helperUid=…&weeks=8
// Helper Performance 2.0, D5 (approved 2026-08-23). Admin gateway for
// the Score tab: last N settled weekly snapshots (write-through
// backfill when missing), the RUNNING week computed live, and a
// 6-month roll-up (mean of each month's settled weeks).
//
// Who may call: a PARENT of the family for any helper; the HELPER
// THEMSELVES when the family allows it (policy.helpersSeeOwnScore) and
// they're tracked — and then the kids' review numbers are stripped
// (D2/Q5). Kids never. Untracked helper → 404 for everyone.
//
// Route files export only handlers/config (Next constraint).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import {
  readPolicy, isTracked, helperLiteFrom, settledWeeks, weekBounds, getOrComputeWeek,
  computeHelperWeek, shareText, type PerfSnapshot,
} from '@/lib/helperPerf.server';
import { ymdLocal } from '@/lib/routineFillCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const helperUid = (req.nextUrl.searchParams.get('helperUid') || '').slice(0, 128);
  const weeksN = Math.max(1, Math.min(26, parseInt(req.nextUrl.searchParams.get('weeks') || '8', 10) || 8));
  const force = req.nextUrl.searchParams.get('force') === '1';
  if (!helperUid) return NextResponse.json({ error: 'helperUid required' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as { familyId?: string; role?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  const isParent = user?.role === 'parent';
  const isSelf = user?.role === 'helper' && uid === helperUid;
  if (!isParent && !isSelf) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const famRef = db.collection('families').doc(familyId);
  const policy = await readPolicy(famRef);
  if (!isTracked(policy, helperUid)) return NextResponse.json({ error: 'not-tracked' }, { status: 404 });
  if (isSelf && !policy.helpersSeeOwnScore) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const hSnap = await famRef.collection('helpers').doc(helperUid).get();
  if (!hSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const helper = helperLiteFrom(helperUid, hSnap.data() as Record<string, unknown>);

  const today = ymdLocal(new Date());
  // Server clock is UTC on Vercel; the family is mostly UTC+3. A settled
  // week is always ≥ 4h old by the time this matters, so UTC dates are
  // safe here (same reasoning as the daily digest).
  const weeksMeta = settledWeeks(today, weeksN);
  const weeks: PerfSnapshot[] = [];
  for (const w of weeksMeta) {
    // Skip weeks entirely before the helper joined — nothing to show.
    if (helper.joinedDate && w.to < helper.joinedDate) break;
    weeks.push(await getOrComputeWeek(db, famRef, helper, policy, w, today, { force }));
  }
  const cur = weekBounds(today);
  const current = await computeHelperWeek(db, famRef, helper, policy, cur.from, cur.to, today);

  // Months: mean of settled weeks by the month of the week's Monday.
  const byMonth = new Map<string, { sum: number; n: number }>();
  for (const w of weeks) {
    if (w.score === null) continue;
    const k = w.from.slice(0, 7);
    const m = byMonth.get(k) ?? { sum: 0, n: 0 };
    m.sum += w.score; m.n++; byMonth.set(k, m);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({ key, pct: Math.round(v.sum / v.n), weeks: v.n }));

  // Strip kid-review detail for the helper-self view (D2 / Q5).
  const strip = (s: PerfSnapshot): PerfSnapshot => isSelf
    ? { ...s, metrics: { ...s.metrics, kidReview: { pct: null, count: 0, eligible: 0 } } }
    : s;

  const famName = ((await famRef.get()).data() as { name?: string } | undefined)?.name;
  const prev = weeks[0] ?? null;
  return NextResponse.json({
    ok: true,
    helper: { uid: helper.uid, name: helper.displayName, preset: helper.preset },
    thresholds: policy.thresholds,
    current: strip(current),
    weeks: weeks.map(strip),
    months,
    share: isParent ? {
      current: shareText(helper.displayName, current, prev, { familyName: famName }),
      weeks: Object.fromEntries(weeks.map((w, i) => [w.weekKey, shareText(helper.displayName, w, weeks[i + 1] ?? null, { familyName: famName })])),
    } : undefined,
    viewer: isParent ? 'parent' : 'helper',
  });
}
