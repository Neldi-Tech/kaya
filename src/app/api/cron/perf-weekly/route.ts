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

    // 🤝 HR PR-3 — the monthly helper round rides this same Monday run.
    await maybeHelperRound(db, famRef, famDoc.id, rows, today).catch(() => { /* never blocks the digest */ });

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

// ── 🤝 HR PR-3 · Monthly helper round ───────────────────────────────
// FIRST Monday of each month, right after the weekly snapshots settle:
// pick one helper through a ROTATING lens (🏆 Best → 📈 Most improved →
// 🕯️ Unsung, by month) and nudge every parent to turn the spotlight
// into an Asante card. Doc-per-month + .create() = idempotent; zero
// rules deploys (Admin-only collection, read via /api/recognition).

type RoundRow = { helper: { uid: string; displayName: string; preset: string }; snap: PerfSnapshot; prev: PerfSnapshot | null };

async function maybeHelperRound(
  db: NonNullable<ReturnType<typeof getAdminFirestore>>,
  famRef: FirebaseFirestore.DocumentReference,
  familyId: string,
  rows: RoundRow[],
  today: string,
): Promise<void> {
  if (Number(today.slice(8, 10)) > 7) return; // only the month's first Monday
  const month = today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const LENSES = ['best', 'improved', 'unsung'] as const;
  const lens = LENSES[(y * 12 + (m - 1)) % 3];

  const scored = rows.filter((r) => r.snap.score !== null);
  if (scored.length === 0) return;

  let pick = scored.reduce((a, b) => ((b.snap.score ?? -1) > (a.snap.score ?? -1) ? b : a));
  let line = `🏆 Best this month — Helper Score ${pick.snap.score}.`;
  let lensUsed: string = lens;

  if (lens === 'improved') {
    const withDelta = scored
      .filter((r) => r.prev?.score != null)
      .map((r) => ({ r, d: (r.snap.score ?? 0) - (r.prev?.score ?? 0) }))
      .filter((x) => x.d > 0)
      .sort((a, b) => b.d - a.d);
    if (withDelta.length > 0) {
      pick = withDelta[0].r;
      line = `📈 Most improved — up ${withDelta[0].d} points, now at ${pick.snap.score}.`;
    } else {
      lensUsed = 'best';
      line = `🏆 Steady at the top — Helper Score ${pick.snap.score}.`;
    }
  } else if (lens === 'unsung') {
    // ✍️ Correction quality over the last 28 days — the quiet teaching
    // work: Bad ratings that carried a note the kid can learn from.
    try {
      const from = new Date(Date.now() - 28 * 86400_000).toISOString().slice(0, 10);
      const snap = await famRef.collection('ratings').where('date', '>=', from).get();
      const tally = new Map<string, { bad: number; withNote: number }>();
      for (const d of snap.docs) {
        const r = d.data() as { ratedBy?: string; ratings?: Record<string, string>; notes?: Record<string, string>; comment?: string };
        if (!r.ratedBy) continue;
        const t = tally.get(r.ratedBy) || { bad: 0, withNote: 0 };
        const dayComment = (r.comment || '').trim();
        for (const [rid, v] of Object.entries(r.ratings || {})) {
          if (v !== 'bad') continue;
          t.bad++;
          if ((r.notes?.[rid] || '').trim().length >= 8 || dayComment.length >= 8) t.withNote++;
        }
        tally.set(r.ratedBy, t);
      }
      const ranked = scored
        .map((r) => ({ r, t: tally.get(r.helper.uid) }))
        .filter((x) => x.t && x.t.bad >= 1)
        .sort((a, b) => (b.t!.withNote / b.t!.bad) - (a.t!.withNote / a.t!.bad));
      if (ranked.length > 0) {
        pick = ranked[0].r;
        const t = ranked[0].t!;
        line = `🕯️ Unsung hero — ${t.withNote} of ${t.bad} corrections came with a note that teaches the kids.`;
      } else {
        lensUsed = 'best';
        line = `🏆 Best this month — Helper Score ${pick.snap.score}.`;
      }
    } catch { lensUsed = 'best'; }
  }

  const round = {
    month,
    lens: lensUsed,
    item: {
      helperUid: pick.helper.uid,
      name: pick.helper.displayName,
      preset: pick.helper.preset,
      score: pick.snap.score,
      line,
    },
    all: scored.map((r) => ({ helperUid: r.helper.uid, name: r.helper.displayName, score: r.snap.score })),
    at: Date.now(),
  };
  try {
    await famRef.collection('helperRounds').doc(month).create(round);
  } catch { return; } // already exists — another run won the race

  // Parent bells — the nudge that opens the Asante composer.
  try {
    const members = await db.collection('users').where('familyId', '==', familyId).get();
    const LENS_EMOJI: Record<string, string> = { best: '🏆', improved: '📈', unsung: '🕯️' };
    await Promise.all(members.docs
      .filter((d) => (d.data() as { role?: string }).role === 'parent')
      .map((d) => famRef.collection('notifications').add({
        type: 'reward',
        title: `🤝 Helper round — ${LENS_EMOJI[lensUsed] || '🌟'} ${pick.helper.displayName.split(' ')[0]}`,
        message: `${line} Turn it into an Asante card →`,
        link: `/pantry/workplan?helper=${pick.helper.uid}&tab=recognition`,
        forUserId: d.id,
        read: false,
        createdAt: new Date(),
      })));
  } catch { /* bells are best-effort */ }
}

function metricLine(s: PerfSnapshot): string {
  const bits: string[] = [];
  if (s.metrics.workplan.pct !== null) bits.push(`Workplan ${s.metrics.workplan.pct}% (${s.metrics.workplan.done}/${s.metrics.workplan.scheduled})`);
  if (s.metrics.ratingCompletion.pct !== null) bits.push(`Ratings ${s.metrics.ratingCompletion.logged}/${s.metrics.ratingCompletion.expected}`);
  if (s.metrics.budget.pct !== null) bits.push(s.metrics.budget.varianceCents <= 0 ? `${s.metrics.budget.shops} shop${s.metrics.budget.shops === 1 ? '' : 's'} · on budget` : `${s.metrics.budget.shops} shop${s.metrics.budget.shops === 1 ? '' : 's'} · over`);
  if (s.metrics.parentFeedback.pct !== null) bits.push(`Feedback ${s.metrics.parentFeedback.pct}%`);
  return bits.length ? bits.join(' · ') : 'No activity this week';
}
