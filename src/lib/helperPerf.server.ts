// HP2 · Helper performance — SERVER compute (Admin SDK). Helper
// Performance 2.0, D5 (approved 2026-08-23).
//
// One function computes a helper's score for ANY settled date range
// [from, to] the same way the in-app PerformanceCard does (policy
// weights, per-helper exclusions, renormalised), plus the routine-fill
// RAG codes (lib/routineFillCore) and the kids' weekly-review average.
// Used by:
//   • /api/cron/perf-weekly   — Monday snapshot + weekly email
//   • /api/helpers/perf-weeks — trend API (write-through backfill)
//   • /api/cron/perf-digest   — daily email (same maths)
//
// Snapshots live at families/{f}/helpers/{uid}/perfWeeks/{YYYY-Www}
// (Admin-only — no Firestore rules). Settled weeks are written once;
// the running week is always computed live and never stored.

import type { Firestore, DocumentReference, Timestamp } from 'firebase-admin/firestore';
import {
  computeRoutineFill, fillCodes, addDays, parseYmd, ymdLocal, isoWeekKey, mondayOf,
  type FillRatingLite,
} from './routineFillCore';

export type PerfMetricKey = 'workplan' | 'budget' | 'ratingCompletion' | 'parentFeedback' | 'kidReview';
export const PERF_METRICS: PerfMetricKey[] = ['workplan', 'budget', 'ratingCompletion', 'parentFeedback', 'kidReview'];
const DEFAULT_WEIGHTS: Record<PerfMetricKey, number> = { workplan: 25, budget: 25, ratingCompletion: 25, parentFeedback: 25, kidReview: 0 };
const DEFAULT_THRESHOLDS = { excellent: 90, good: 70, okay: 50 };

export interface PolicyLite {
  weights: Record<PerfMetricKey, number>;
  thresholds: { excellent: number; good: number; okay: number };
  helperOverrides: Record<string, { excludeMetrics?: PerfMetricKey[]; tracked?: boolean; kidsReview?: boolean }>;
  helpersSeeOwnScore: boolean;
  kidReview: { minAge: number; emailOnSubmit: boolean };
}

export interface HelperLite {
  uid: string;
  displayName: string;
  preset: string;
  status?: string;
  kidIds: string[];
  expectedFrequency?: 'morning' | 'evening' | 'both' | 'flexible';
  workDays?: string[] | null;
  joinedDate?: string | null;
}

export interface PerfSnapshot {
  weekKey: string;            // 2026-W34
  from: string;               // Monday YYYY-MM-DD
  to: string;                 // Sunday YYYY-MM-DD
  /** true when `to` is in the past (settled); false = running week. */
  settled: boolean;
  score: number | null;
  face: { emoji: string; label: string };
  metrics: {
    workplan: { pct: number | null; done: number; scheduled: number; days: number };
    budget: { pct: number | null; shops: number; varianceCents: number; estimatedCents: number; actualCents: number };
    ratingCompletion: { pct: number | null; logged: number; expected: number };
    parentFeedback: { pct: number | null; positive: number; neutral: number; negative: number };
    kidReview: { pct: number | null; count: number; eligible: number };
  };
  fill: { codes: string; pct: number | null; green: number; amber: number; red: number; off: number };
  weights: Record<PerfMetricKey, number>;
  excluded: PerfMetricKey[];
  computedAt: number;
}

// ── policy / helper readers ─────────────────────────────────────

export async function readPolicy(famRef: DocumentReference): Promise<PolicyLite> {
  const snap = await famRef.collection('performancePolicy').doc('default').get().catch(() => null);
  const p = (snap?.exists ? snap.data() : {}) as Partial<PolicyLite> | undefined;
  const w = { ...DEFAULT_WEIGHTS, ...(p?.weights ?? {}) } as Record<PerfMetricKey, number>;
  return {
    weights: w,
    thresholds: { ...DEFAULT_THRESHOLDS, ...(p?.thresholds ?? {}) },
    helperOverrides: p?.helperOverrides ?? {},
    helpersSeeOwnScore: p?.helpersSeeOwnScore !== false,
    kidReview: { minAge: p?.kidReview?.minAge ?? 5, emailOnSubmit: p?.kidReview?.emailOnSubmit !== false },
  };
}

export function isTracked(policy: PolicyLite, uid: string): boolean {
  return policy.helperOverrides[uid]?.tracked !== false;
}
export function kidsReviewOn(policy: PolicyLite, uid: string): boolean {
  return isTracked(policy, uid) && policy.helperOverrides[uid]?.kidsReview !== false;
}

export function helperLiteFrom(uid: string, d: Record<string, unknown>): HelperLite {
  let joinedDate: string | null = null;
  const ca = d.createdAt as Timestamp | undefined;
  try { const ms = ca?.toMillis?.(); if (ms) joinedDate = ymdLocal(new Date(ms)); } catch { /* ignore */ }
  return {
    uid,
    displayName: (d.displayName as string) || 'Helper',
    preset: (d.preset as string) || 'custom',
    status: d.status as string | undefined,
    kidIds: (d.kidIds as string[]) ?? [],
    expectedFrequency: d.expectedFrequency as HelperLite['expectedFrequency'],
    workDays: (d.workDays as string[] | undefined) ?? null,
    joinedDate,
  };
}

export function perfFace(pct: number | null, t = DEFAULT_THRESHOLDS): { emoji: string; label: string } {
  if (pct === null) return { emoji: '🟡', label: 'No data' };
  if (pct >= t.excellent) return { emoji: '😀', label: 'Excellent' };
  if (pct >= t.good) return { emoji: '🙂', label: 'Good' };
  if (pct >= t.okay) return { emoji: '😐', label: 'Okay' };
  return { emoji: '🙁', label: 'Low' };
}

/** Per-helper effective weights (exclusions zeroed, renormalised to 100). */
export function effectiveWeightsFor(policy: PolicyLite, uid: string): { weights: Record<PerfMetricKey, number>; excluded: PerfMetricKey[] } {
  const excluded = policy.helperOverrides[uid]?.excludeMetrics ?? [];
  const w = { ...policy.weights };
  for (const m of excluded) w[m] = 0;
  const sum = PERF_METRICS.reduce((a, m) => a + (w[m] ?? 0), 0);
  if (sum > 0 && excluded.length > 0) for (const m of PERF_METRICS) w[m] = Math.round(((w[m] ?? 0) / sum) * 100);
  return { weights: w, excluded };
}

// ── week helpers ────────────────────────────────────────────────

/** The week containing `date` as [Mon, Sun]. */
export function weekBounds(date: string): { from: string; to: string; weekKey: string } {
  const from = mondayOf(date);
  return { from, to: addDays(from, 6), weekKey: isoWeekKey(from) };
}
/** Last N SETTLED weeks (most recent first), given today's date. */
export function settledWeeks(today: string, n: number): { from: string; to: string; weekKey: string }[] {
  const out: { from: string; to: string; weekKey: string }[] = [];
  let mon = addDays(mondayOf(today), -7);
  for (let i = 0; i < n; i++) { out.push(weekBounds(mon)); mon = addDays(mon, -7); }
  return out;
}

// ── core compute ────────────────────────────────────────────────

interface RawItem { id: string; active?: boolean; daysOfWeek?: string[]; kind?: string; scheduledDates?: string[] }
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function scheduledOn(items: RawItem[], ds: string): RawItem[] {
  const dow = DOW[parseYmd(ds).getDay()];
  return items.filter((i) => {
    if (i.active === false) return false;
    if ((i.kind ?? 'recurring') === 'adhoc') return (i.scheduledDates ?? []).includes(ds);
    return (i.daysOfWeek ?? []).includes(dow);
  });
}
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let s = from; s <= to; s = addDays(s, 1)) out.push(s);
  return out;
}

/** Ratings for the family in [from, to] — fetched once per family per
 *  range and shared across helpers (the caller may pass them in). */
export type RatingLiteMarked = FillRatingLite & { marked?: number };
export async function fetchFamilyRatings(famRef: DocumentReference, from: string, to: string): Promise<RatingLiteMarked[]> {
  const snap = await famRef.collection('ratings').where('date', '>=', from).where('date', '<=', to).limit(3000).get();
  const out: RatingLiteMarked[] = [];
  for (const d of snap.docs) {
    const r = d.data() as { date?: string; childId?: string; period?: string; ratedBy?: string; ratings?: Record<string, string> };
    if (r.date && r.childId && r.period && r.ratedBy) {
      out.push({ date: r.date, childId: r.childId, period: r.period, ratedBy: r.ratedBy, marked: r.ratings ? Object.keys(r.ratings).length : 0 });
    }
  }
  return out;
}

export async function computeHelperWeek(
  db: Firestore,
  famRef: DocumentReference,
  helper: HelperLite,
  policy: PolicyLite,
  from: string,
  to: string,
  today: string,
  ctx?: { ratings?: RatingLiteMarked[]; routineCount?: Record<string, number> },
): Promise<PerfSnapshot> {
  void db;
  const helperRef = famRef.collection('helpers').doc(helper.uid);
  // Settled range = up to yesterday (the running week stops before today).
  const lastSettled = to < today ? to : addDays(today, -1);
  const settledDates = lastSettled >= from ? datesBetween(from, lastSettled) : [];
  const settled = to < today;

  // Ratings (shared) + routine count for partial-by-checks credit.
  const ratings = ctx?.ratings ?? await fetchFamilyRatings(famRef, from, to);
  let routineCount = ctx?.routineCount;
  if (!routineCount) {
    routineCount = { morning: 0, evening: 0 };
    const fam = (await famRef.get()).data() as { routines?: { period?: string; active?: boolean }[] } | undefined;
    for (const r of fam?.routines ?? []) {
      if (r.active === false) continue;
      if (r.period === 'morning') routineCount.morning++;
      else if (r.period === 'evening') routineCount.evening++;
    }
  }

  // ── Workplan ──
  let workplanPct: number | null = null; let done = 0; let scheduled = 0; let wpDays = 0;
  try {
    const itemsSnap = await helperRef.collection('workplanItems').get();
    const items = itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as RawItem[];
    let pctSum = 0;
    const compSnaps = await Promise.all(settledDates.map((ds) => helperRef.collection('workplanCompletions').doc(ds).get()));
    settledDates.forEach((ds, i) => {
      const sched = scheduledOn(items, ds);
      if (sched.length === 0) return;
      wpDays++;
      const c = compSnaps[i];
      const doneIds: string[] = c.exists ? ((c.data()?.completedItemIds as string[]) ?? []) : [];
      const hit = sched.filter((it) => doneIds.includes(it.id)).length;
      pctSum += Math.round((hit / sched.length) * 100);
      scheduled += sched.length; done += hit;
    });
    if (wpDays > 0) workplanPct = Math.round(pctSum / wpDays);
  } catch { /* null */ }

  // ── Ratings completion (partial-by-checks, work days) ──
  let ratingPct: number | null = null; let logged = 0; let expected = 0;
  try {
    const perDay = helper.expectedFrequency === 'both' ? 2 : 1;
    const workDays = helper.workDays && helper.workDays.length > 0 && helper.workDays.length < 7 ? helper.workDays : null;
    const kidsRated = new Set<string>();
    let weighted = 0;
    for (const r of ratings) {
      if (r.ratedBy !== helper.uid || r.date < from || r.date > lastSettled) continue;
      logged++; kidsRated.add(r.childId);
      const total = routineCount[r.period] ?? 0;
      const marked = r.marked ?? 1;
      weighted += total > 0 ? Math.min(1, marked / total) : (marked > 0 ? 1 : 0);
    }
    const effectiveKids = helper.kidIds.length > 0 ? helper.kidIds.length : kidsRated.size;
    const workingDays = settledDates.filter((ds) => !workDays || workDays.includes(DOW[parseYmd(ds).getDay()])).length;
    if (effectiveKids > 0 && workingDays > 0) {
      expected = effectiveKids * perDay * workingDays;
      ratingPct = Math.max(0, Math.min(100, Math.round((weighted / expected) * 100)));
    }
  } catch { /* null */ }

  // ── Budget ──
  let budgetPct: number | null = null; let shops = 0; let est = 0; let act = 0;
  try {
    const [a, b] = await Promise.all([
      famRef.collection('purchaseRequests').where('createdBy', '==', helper.uid).limit(200).get(),
      famRef.collection('purchaseRequests').where('submittedForCloseBy', '==', helper.uid).limit(200).get(),
    ]);
    const seen = new Set<string>();
    const fromMs = parseYmd(from).setHours(0, 0, 0, 0);
    const toMs = parseYmd(lastSettled).setHours(23, 59, 59, 999);
    for (const d of [...a.docs, ...b.docs]) {
      if (seen.has(d.id)) continue; seen.add(d.id);
      const r = d.data() as { status?: string; estimatedTotalCents?: number; actualTotalCents?: number; closedAt?: Timestamp; submittedForCloseAt?: Timestamp; reconciledAt?: Timestamp };
      if (r.status !== 'closed' && r.status !== 'pending_close') continue;
      const ms = (r.closedAt ?? r.submittedForCloseAt ?? r.reconciledAt)?.toMillis?.();
      if (ms == null || ms < fromMs || ms > toMs) continue;
      shops++; est += r.estimatedTotalCents ?? 0; act += r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
    }
    if (shops > 0) {
      const variance = act - est;
      budgetPct = est === 0 || variance <= 0 ? 100 : Math.max(0, Math.round(100 - (variance / est) * 100 * 2));
    }
  } catch { /* null */ }

  // ── Parent feedback ──
  let feedbackPct: number | null = null; let pos = 0; let neu = 0; let neg = 0;
  try {
    const fSnap = await helperRef.collection('feedbackNotes').get();
    for (const d of fSnap.docs) {
      if (d.id < from || d.id > lastSettled) continue;
      const s = (d.data() as { sentiment?: string }).sentiment;
      if (s === 'positive') pos++; else if (s === 'negative') neg++; else neu++;
    }
    const total = pos + neu + neg;
    if (total > 0) feedbackPct = Math.max(0, Math.min(100, Math.round(50 + (50 * (pos - neg)) / total)));
  } catch { /* null */ }

  // ── Kid review (PR5 writes kidReviews/{weekKey}_{kidId}) ──
  let kidPct: number | null = null; let kidCount = 0;
  const weekKey = isoWeekKey(from);
  try {
    const kSnap = await helperRef.collection('kidReviews').where('weekKey', '==', weekKey).get();
    let sum = 0;
    for (const d of kSnap.docs) {
      const r = d.data() as { pct?: number };
      if (typeof r.pct === 'number') { sum += r.pct; kidCount++; }
    }
    if (kidCount > 0) kidPct = Math.round(sum / kidCount);
  } catch { /* null */ }

  // ── Consolidate (policy weights) ──
  const { weights, excluded } = effectiveWeightsFor(policy, helper.uid);
  const parts: { s: number; w: number }[] = [];
  if (workplanPct !== null && weights.workplan > 0) parts.push({ s: workplanPct, w: weights.workplan });
  if (budgetPct !== null && weights.budget > 0) parts.push({ s: budgetPct, w: weights.budget });
  if (ratingPct !== null && weights.ratingCompletion > 0) parts.push({ s: ratingPct, w: weights.ratingCompletion });
  if (feedbackPct !== null && weights.parentFeedback > 0) parts.push({ s: feedbackPct, w: weights.parentFeedback });
  if (kidPct !== null && (weights.kidReview ?? 0) > 0) parts.push({ s: kidPct, w: weights.kidReview });
  const wSum = parts.reduce((a, p) => a + p.w, 0);
  const score = wSum > 0 ? Math.round(parts.reduce((a, p) => a + p.s * p.w, 0) / wSum) : null;

  // ── Routine-fill RAG ──
  const fill = computeRoutineFill(
    { uid: helper.uid, kidIds: helper.kidIds, expectedFrequency: helper.expectedFrequency, workDays: helper.workDays, joinedDate: helper.joinedDate },
    ratings, from, to, today,
  );

  return {
    weekKey, from, to, settled,
    score, face: perfFace(score, policy.thresholds),
    metrics: {
      workplan: { pct: workplanPct, done, scheduled, days: wpDays },
      budget: { pct: budgetPct, shops, varianceCents: act - est, estimatedCents: est, actualCents: act },
      ratingCompletion: { pct: ratingPct, logged, expected },
      parentFeedback: { pct: feedbackPct, positive: pos, neutral: neu, negative: neg },
      kidReview: { pct: kidPct, count: kidCount, eligible: helper.kidIds.length },
    },
    fill: { codes: fillCodes(fill.days), pct: fill.fillPct, green: fill.green, amber: fill.amber, red: fill.red, off: fill.off },
    weights, excluded,
    computedAt: Date.now(),
  };
}

/** Read the stored snapshot for a settled week, or compute + store it
 *  (write-through backfill). Running weeks are never stored. */
export async function getOrComputeWeek(
  db: Firestore,
  famRef: DocumentReference,
  helper: HelperLite,
  policy: PolicyLite,
  week: { from: string; to: string; weekKey: string },
  today: string,
  opts: { force?: boolean } = {},
): Promise<PerfSnapshot> {
  const ref = famRef.collection('helpers').doc(helper.uid).collection('perfWeeks').doc(week.weekKey);
  const settled = week.to < today;
  if (settled && !opts.force) {
    const snap = await ref.get().catch(() => null);
    if (snap?.exists) return snap.data() as PerfSnapshot;
  }
  const computed = await computeHelperWeek(db, famRef, helper, policy, week.from, week.to, today);
  if (settled) { try { await ref.set(computed); } catch { /* best-effort */ } }
  return computed;
}

/** Text block for WhatsApp / copy (D6 — numbers + stars only). */
export function shareText(helperName: string, s: PerfSnapshot, prev?: PerfSnapshot | null, opts: { familyName?: string } = {}): string {
  const delta = s.score !== null && prev?.score != null ? s.score - prev.score : null;
  const deltaTxt = delta === null ? '' : delta > 0 ? ` (▲${delta})` : delta < 0 ? ` (▼${Math.abs(delta)})` : ' (▬)';
  const rag = s.fill.codes.split('').map((c) => c === 'G' ? '🟢' : c === 'A' ? '🟡' : c === 'R' ? '🔴' : c === 'T' ? '◌' : c === 'F' ? '·' : '⚪').join('');
  const lines = [
    `📊 *${helperName} — Kaya weekly report*`,
    `Week ${s.weekKey.split('-W')[1]} · ${fmtRange(s.from, s.to)}`,
    '',
    `Score *${s.score === null ? '—' : `${s.score}%`}* ${s.face.emoji} ${s.face.label}${deltaTxt}`,
    `Routine fill ${rag}${s.fill.pct !== null ? ` · ${s.fill.pct}%` : ''}`,
  ];
  if (s.metrics.workplan.pct !== null) lines.push(`✅ Workplan ${s.metrics.workplan.pct}% (${s.metrics.workplan.done}/${s.metrics.workplan.scheduled})`);
  if (s.metrics.budget.pct !== null) lines.push(`💰 Budget ${s.metrics.budget.varianceCents <= 0 ? 'on target' : 'over'} · ${s.metrics.budget.shops} shop${s.metrics.budget.shops === 1 ? '' : 's'}`);
  if (s.metrics.parentFeedback.pct !== null) lines.push(`👍 Feedback ${s.metrics.parentFeedback.positive}👍 ${s.metrics.parentFeedback.neutral}😐 ${s.metrics.parentFeedback.negative}👎`);
  if (s.metrics.kidReview.pct !== null) lines.push(`👧 Kids ${stars(s.metrics.kidReview.pct)} ${s.metrics.kidReview.pct}% (${s.metrics.kidReview.count} review${s.metrics.kidReview.count === 1 ? '' : 's'})`);
  lines.push('', `— sent from Kaya${opts.familyName ? ` · ${opts.familyName}` : ''} · ourkaya.com`);
  return lines.join('\n');
}

export function stars(pct: number): string {
  const n = Math.max(1, Math.min(5, Math.round(pct / 20)));
  return '⭐'.repeat(n);
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtRange(from: string, to: string): string {
  const a = parseYmd(from); const b = parseYmd(to);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return sameMonth
    ? `${a.getDate()}–${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`
    : `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`;
}
