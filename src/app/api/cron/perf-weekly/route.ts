// HP2 · Weekly helper snapshot + report — Monday 04:00 UTC (07:00 Dar).
// Helper Performance 2.0, D5 + D7 (approved 2026-08-23).
//
// For every family: policy → tracked helpers → compute LAST week
// (Mon–Sun) → store families/{f}/helpers/{uid}/perfWeeks/{YYYY-Www}
// (immutable weekly record) → email every parent whose helper-email
// frequency resolves to 'weekly' (users/{uid}.perfDigest, legacy
// boolean mapped — see lib/perfDigestPrefs) → one alertLog entry per
// family per run (as-sent trace).
//
// Safe before configuration: no-ops cleanly without the Admin SDK or
// Resend. CRON_SECRET enforced when set. `?week=YYYY-MM-DD` recomputes
// the week containing that date (manual re-run); `?dry=1` computes +
// stores without emailing.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import {
  readPolicy, isTracked, helperLiteFrom, weekBounds, getOrComputeWeek, stars, fmtRange,
  type PerfSnapshot,
} from '@/lib/helperPerf.server';
import { addDays, mondayOf, ymdLocal } from '@/lib/routineFillCore';
import { resolvePerfDigest } from '@/lib/perfDigestPrefs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const today = ymdLocal(new Date());
  const weekParam = req.nextUrl.searchParams.get('week');
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const onlyFamily = req.nextUrl.searchParams.get('family') || null;
  // Default: the week that ended yesterday (Mon–Sun before today's Monday).
  const anchor = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekParam : addDays(mondayOf(today), -7);
  const week = weekBounds(anchor);
  if (week.to >= today) return NextResponse.json({ skipped: true, reason: 'week-not-settled', week });
  const prevWeek = weekBounds(addDays(week.from, -7));

  let familiesProcessed = 0; let helpersSnapshotted = 0; let emailsSent = 0;
  const families = onlyFamily
    ? [await db.collection('families').doc(onlyFamily).get()]
    : (await db.collection('families').get()).docs;

  for (const famDoc of families) {
    if (!famDoc.exists) continue;
    const famRef = famDoc.ref;
    const famName = (famDoc.data()?.name as string | undefined) || 'Your family';
    let policy; let helperDocs;
    try {
      policy = await readPolicy(famRef);
      helperDocs = await famRef.collection('helpers').get();
    } catch { continue; }
    const helpers = helperDocs.docs
      .map((d) => helperLiteFrom(d.id, d.data() as Record<string, unknown>))
      .filter((h) => h.status !== 'removed' && isTracked(policy, h.uid));
    if (helpers.length === 0) continue;

    const rows: { helper: ReturnType<typeof helperLiteFrom>; snap: PerfSnapshot; prev: PerfSnapshot | null }[] = [];
    for (const h of helpers) {
      try {
        const snap = await getOrComputeWeek(db, famRef, h, policy, week, today, { force: true });
        let prev: PerfSnapshot | null = null;
        if (!h.joinedDate || prevWeek.to >= h.joinedDate) {
          prev = await getOrComputeWeek(db, famRef, h, policy, prevWeek, today).catch(() => null);
        }
        rows.push({ helper: h, snap, prev });
        helpersSnapshotted++;
      } catch { /* skip this helper */ }
    }
    familiesProcessed++;
    if (dry || rows.length === 0) continue;

    // Recipients — parents resolved to 'weekly'.
    let members;
    try { members = await db.collection('users').where('familyId', '==', famDoc.id).get(); } catch { continue; }
    const parents = members.docs
      .map((d) => d.data() as { uid?: string; role?: string; email?: string; name?: string; displayName?: string; perfDigest?: string; perfDigestEmail?: boolean })
      .filter((u) => u.role === 'parent' && u.email && resolvePerfDigest(u) === 'weekly');
    if (parents.length === 0) continue;

    const emailRows = rows.map(({ helper, snap, prev }) => ({
      name: helper.displayName,
      preset: helper.preset,
      scorePct: snap.score,
      faceEmoji: snap.face.emoji,
      faceLabel: snap.face.label,
      delta: snap.score !== null && prev?.score != null ? snap.score - prev.score : null,
      fillCodes: snap.fill.codes,
      fillPct: snap.fill.pct,
      line: metricLine(snap),
      kidStars: snap.metrics.kidReview.pct !== null ? `${stars(snap.metrics.kidReview.pct)} ${snap.metrics.kidReview.pct}% (${snap.metrics.kidReview.count})` : null,
      helperUid: helper.uid,
    }));
    const rangeLabel = fmtRange(week.from, week.to);
    const sentTo: { name: string; email: string }[] = [];
    for (const p of parents) {
      try {
        const res = await fetch(`${APP_URL}/api/notify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'perf-weekly',
            to: [p.email],
            data: {
              parentName: (p.name || p.displayName || '').split(' ')[0] || undefined,
              familyName: famName,
              rangeLabel,
              weekKey: week.weekKey,
              weeklyHelpers: emailRows,
            },
          }),
        });
        if (res.ok) { emailsSent++; sentTo.push({ name: p.name || p.displayName || 'Parent', email: p.email! }); }
      } catch { /* best-effort per parent */ }
    }
    // alertLog trace (as-sent) — Admin-only subcollection.
    try {
      await famRef.collection('alertLog').add({
        kind: 'helper_weekly',
        firedAt: Date.now(),
        trigger: 'digest',
        weekKey: week.weekKey,
        channels: {
          email: {
            on: true, sent: sentTo.length > 0, to: sentTo,
            subject: `📊 Weekly helper report · ${famName} · ${rangeLabel}`,
            templateVersion: 1,
            weeklyFacts: { rangeLabel, helpers: emailRows.map((r) => ({ name: r.name, scorePct: r.scorePct, faceEmoji: r.faceEmoji, delta: r.delta, fillCodes: r.fillCodes, line: r.line, kidStars: r.kidStars })) },
          },
        },
      });
    } catch { /* never blocks */ }
  }
  return NextResponse.json({ ok: true, week, familiesProcessed, helpersSnapshotted, emailsSent, dry });
}

function metricLine(s: PerfSnapshot): string {
  const bits: string[] = [];
  if (s.metrics.workplan.pct !== null) bits.push(`Workplan ${s.metrics.workplan.pct}% (${s.metrics.workplan.done}/${s.metrics.workplan.scheduled})`);
  if (s.metrics.ratingCompletion.pct !== null) bits.push(`Ratings ${s.metrics.ratingCompletion.logged}/${s.metrics.ratingCompletion.expected}`);
  if (s.metrics.budget.pct !== null) bits.push(s.metrics.budget.varianceCents <= 0 ? `${s.metrics.budget.shops} shop${s.metrics.budget.shops === 1 ? '' : 's'} · on budget` : `${s.metrics.budget.shops} shop${s.metrics.budget.shops === 1 ? '' : 's'} · over`);
  if (s.metrics.parentFeedback.pct !== null) bits.push(`Feedback ${s.metrics.parentFeedback.pct}%`);
  return bits.length ? bits.join(' · ') : 'No activity this week';
}
