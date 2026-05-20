// Daily helper-performance email digest (2026-05-20).
//
// Runs on a Vercel cron (see vercel.json). For every family, finds the
// parents who opted in (users/{uid}.perfDigestEmail === true) and emails
// them a summary of each helper's performance over the last 7 settled
// days (today excluded — matches the in-app card). Uses the Admin SDK so
// it bypasses security rules; renders + sends via the existing
// /api/notify dispatcher (Resend), so the email styling stays in one place.
//
// Safe to ship before configuration: no-ops cleanly when the Admin SDK or
// Resend isn't set up. Secured by CRON_SECRET when that env var is set.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const WINDOW_DAYS = 7;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ── tiny date helpers (UTC; a ±1-day boundary is negligible over a
//    7-day aggregate, and avoids server-tz surprises) ──
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface RawItem {
  id: string; active?: boolean; daysOfWeek?: string[];
  kind?: string; scheduledDates?: string[];
}
function scheduledOn(items: RawItem[], date: Date): RawItem[] {
  const dow = DAYS[date.getDay()];
  const ds = ymd(date);
  return items.filter((i) => {
    if (i.active === false) return false;
    if ((i.kind ?? 'recurring') === 'adhoc') return (i.scheduledDates ?? []).includes(ds);
    return (i.daysOfWeek ?? []).includes(dow);
  });
}

export async function POST(req: NextRequest) {
  return run(req);
}
export async function GET(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  // Auth: enforce CRON_SECRET when configured (Vercel sends it as a
  // Bearer token). If unset, allow (pre-configuration / manual test).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });
  }

  const now = new Date();
  // The 7 settled dates: yesterday back through 7 days ago.
  const windowDates: string[] = [];
  for (let i = 1; i <= WINDOW_DAYS; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    windowDates.push(ymd(d));
  }
  const sinceMs = (() => {
    const d = new Date(now);
    d.setDate(d.getDate() - WINDOW_DAYS);
    return d.getTime();
  })();

  let familiesProcessed = 0;
  let emailsSent = 0;

  let families;
  try {
    families = await db.collection('families').get();
  } catch (e) {
    return NextResponse.json({ error: 'families-read-failed', detail: String(e) }, { status: 500 });
  }

  for (const famDoc of families.docs) {
    const fid = famDoc.id;

    // Members → opted-in parents (with an email).
    let members;
    try {
      members = await db.collection('users').where('familyId', '==', fid).get();
    } catch { continue; }
    const optedInParents = members.docs
      .map((d) => d.data() as { uid?: string; role?: string; email?: string; name?: string; displayName?: string; perfDigestEmail?: boolean })
      .filter((u) => u.role === 'parent' && u.perfDigestEmail === true && u.email);
    if (optedInParents.length === 0) continue;

    // Active helpers in the family.
    let helperDocs;
    try {
      helperDocs = await famDoc.ref.collection('helpers').get();
    } catch { continue; }
    const helpers = helperDocs.docs
      .map((d) => ({ uid: d.id, ...(d.data() as Record<string, unknown>) }))
      .filter((h) => (h as { status?: string }).status !== 'removed');

    // Active routine count per period — denominator for partial
    // "by checks" rating credit. Read once from the family doc (already
    // loaded), shared across all helpers in the family.
    const routineCount: Record<string, number> = { morning: 0, evening: 0 };
    for (const r of ((famDoc.data()?.routines ?? []) as { period?: string; active?: boolean }[])) {
      if (r.active === false) continue;
      if (r.period === 'morning') routineCount.morning++;
      else if (r.period === 'evening') routineCount.evening++;
    }

    const digestHelpers = [];
    for (const h of helpers) {
      const uid = (h as { uid: string }).uid;
      const displayName = ((h as { displayName?: string }).displayName) || 'Helper';
      const assignedKids = (((h as { kidIds?: string[] }).kidIds) ?? []).length;
      const expectedFrequency = (h as { expectedFrequency?: string }).expectedFrequency;
      try {
        const perf = await computeHelperPerf(db, famDoc.ref, uid, {
          assignedKids, expectedFrequency, windowDates, sinceMs, routineCount,
        });
        const face = perfFace(perf.consolidatedPct);
        digestHelpers.push({
          name: displayName,
          scorePct: perf.consolidatedPct,
          faceEmoji: face.emoji,
          faceLabel: face.label,
          line: perf.line,
        });
      } catch {
        // Skip a helper that errors; keep the rest of the digest.
      }
    }

    // Send one email per opted-in parent (personalised greeting).
    const dateLabel = ymd(now);
    for (const p of optedInParents) {
      try {
        const res = await fetch(`${APP_URL}/api/notify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'perf-digest',
            to: [p.email],
            data: {
              parentName: (p.name || p.displayName || '').split(' ')[0] || undefined,
              dateLabel,
              digestHelpers,
            },
          }),
        });
        if (res.ok) emailsSent++;
      } catch {
        // best-effort per parent
      }
    }
    familiesProcessed++;
  }

  return NextResponse.json({ ok: true, familiesProcessed, emailsSent });
}

// ── Admin-side performance (mirrors lib/helperPerformance, lean) ──
// Last 7 settled days (today excluded). Consolidated with default
// 25/25/25/25 weights over the metrics that have data (null metrics
// drop out + remaining weights renormalise — same as the in-app calc).

interface PerfResult { consolidatedPct: number | null; line: string }

async function computeHelperPerf(
  db: FirebaseFirestore.Firestore,
  famRef: FirebaseFirestore.DocumentReference,
  uid: string,
  ctx: { assignedKids: number; expectedFrequency?: string; windowDates: string[]; sinceMs: number; routineCount: Record<string, number> },
): Promise<PerfResult> {
  const helperRef = famRef.collection('helpers').doc(uid);

  // ── Workplan ──
  let workplanPct: number | null = null;
  let tasksDone = 0;
  let tasksScheduled = 0;
  try {
    const itemsSnap = await helperRef.collection('workplanItems').get();
    const items = itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as RawItem[];
    let pctSum = 0;
    let scheduledDays = 0;
    for (const ds of ctx.windowDates) {
      const date = new Date(`${ds}T12:00:00`);
      const sched = scheduledOn(items, date);
      if (sched.length === 0) continue;
      scheduledDays++;
      const compSnap = await helperRef.collection('workplanCompletions').doc(ds).get();
      const done: string[] = compSnap.exists ? ((compSnap.data()?.completedItemIds as string[]) ?? []) : [];
      const hit = sched.filter((i) => done.includes(i.id)).length;
      pctSum += Math.round((hit / sched.length) * 100);
      tasksScheduled += sched.length;
      tasksDone += hit;
    }
    if (scheduledDays > 0) workplanPct = Math.round(pctSum / scheduledDays);
  } catch { /* leave null */ }

  // ── Ratings ──
  let ratingPct: number | null = null;
  let ratingLogged = 0;
  let ratingExpected = 0;
  try {
    // Query by date range (single-field, no composite index) + filter
    // ratedBy in memory — mirrors the in-app card fix. Window is small.
    const earliest = ctx.windowDates[ctx.windowDates.length - 1];
    const latest = ctx.windowDates[0];
    const rSnap = await famRef.collection('ratings')
      .where('date', '>=', earliest).where('date', '<=', latest).limit(500).get();
    const kids = new Set<string>();
    let weightedLogged = 0; // partial-by-checks sum
    for (const d of rSnap.docs) {
      const data = d.data() as {
        date?: string; childId?: string; ratedBy?: string;
        period?: string; ratings?: Record<string, string>;
      };
      if (data.ratedBy !== uid) continue;
      if (data.date && ctx.windowDates.includes(data.date)) {
        ratingLogged++;
        if (data.childId) kids.add(data.childId);
        // Partial credit by checks marked (incl 'skip'); unmarked
        // routines reduce the slot. Falls back to full when no count.
        const marked = data.ratings ? Object.keys(data.ratings).length : 0;
        const total = data.period ? (ctx.routineCount[data.period] ?? 0) : 0;
        weightedLogged += total > 0 ? Math.min(1, marked / total) : (marked > 0 ? 1 : 0);
      }
    }
    const perDay = ctx.expectedFrequency === 'both' ? 2 : 1;
    const effectiveKids = ctx.assignedKids > 0 ? ctx.assignedKids : kids.size;
    if (effectiveKids > 0) {
      ratingExpected = effectiveKids * perDay * WINDOW_DAYS;
      ratingPct = ratingExpected === 0 ? null
        : Math.max(0, Math.min(100, Math.round((weightedLogged / ratingExpected) * 100)));
    }
  } catch { /* leave null */ }

  // ── Budget (closed + pending_close shops by this helper) ──
  let budgetPct: number | null = null;
  let budgetVariance = 0;
  let shopsCount = 0;
  try {
    // Shops the helper SHOPPED — created OR reconciled. Two single-field
    // queries merged + deduped (no composite index).
    const [createdSnap, reconciledSnap] = await Promise.all([
      famRef.collection('purchaseRequests').where('createdBy', '==', uid).limit(200).get(),
      famRef.collection('purchaseRequests').where('submittedForCloseBy', '==', uid).limit(200).get(),
    ]);
    let est = 0; let act = 0;
    const seen = new Set<string>();
    for (const d of [...createdSnap.docs, ...reconciledSnap.docs]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const r = d.data() as {
        status?: string;
        estimatedTotalCents?: number; actualTotalCents?: number;
        closedAt?: FirebaseFirestore.Timestamp; submittedForCloseAt?: FirebaseFirestore.Timestamp; reconciledAt?: FirebaseFirestore.Timestamp;
      };
      if (r.status !== 'closed' && r.status !== 'pending_close') continue;
      const stamp = r.closedAt ?? r.submittedForCloseAt ?? r.reconciledAt;
      const ms = stamp?.toMillis?.();
      if (ms == null || ms < ctx.sinceMs) continue;
      shopsCount++;
      est += r.estimatedTotalCents ?? 0;
      act += r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
    }
    if (shopsCount > 0) {
      budgetVariance = act - est;
      if (est === 0 || budgetVariance <= 0) budgetPct = 100;
      else budgetPct = Math.max(0, Math.round(100 - (budgetVariance / est) * 100 * 2));
    }
  } catch { /* leave null */ }

  // ── Feedback ──
  let feedbackPct: number | null = null;
  try {
    const fSnap = await helperRef.collection('feedbackNotes').get();
    let pos = 0; let neg = 0; let total = 0;
    for (const d of fSnap.docs) {
      if (!ctx.windowDates.includes(d.id)) continue;
      const data = d.data() as { sentiment?: string };
      if (data.sentiment === 'positive') pos++;
      else if (data.sentiment === 'negative') neg++;
      total++;
    }
    if (total > 0) feedbackPct = Math.round(50 + (50 * (pos - neg)) / total);
  } catch { /* leave null */ }

  // ── Consolidate (equal weights over present metrics) ──
  const parts: number[] = [];
  if (workplanPct !== null) parts.push(workplanPct);
  if (budgetPct !== null) parts.push(budgetPct);
  if (ratingPct !== null) parts.push(ratingPct);
  if (feedbackPct !== null) parts.push(feedbackPct);
  const consolidatedPct = parts.length > 0
    ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length)
    : null;

  // ── One-line summary ──
  const bits: string[] = [];
  if (workplanPct !== null) bits.push(`Workplan ${workplanPct}% (${tasksDone}/${tasksScheduled})`);
  if (ratingPct !== null) bits.push(`Ratings ${ratingLogged}/${ratingExpected}`);
  if (budgetPct !== null) {
    bits.push(budgetVariance <= 0 ? `${shopsCount} shop${shopsCount === 1 ? '' : 's'} · on budget` : `${shopsCount} shop${shopsCount === 1 ? '' : 's'} · over`);
  }
  if (feedbackPct !== null) bits.push(`Feedback ${feedbackPct}%`);
  const line = bits.length ? bits.join(' · ') : 'No activity in the last 7 days';

  return { consolidatedPct, line };
}

function perfFace(pct: number | null): { emoji: string; label: string } {
  if (pct === null) return { emoji: '🟡', label: 'No data' };
  if (pct >= 90) return { emoji: '😀', label: 'Excellent' };
  if (pct >= 70) return { emoji: '🙂', label: 'Good' };
  if (pct >= 50) return { emoji: '😐', label: 'Okay' };
  return { emoji: '🙁', label: 'Low' };
}
