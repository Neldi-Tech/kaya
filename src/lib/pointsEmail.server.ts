// 🔥 Points Emails 2.0 — the "Heat Report" (approved 23-Aug-2026).
//
// SERVER-ONLY composer for the routine-rating emails. One source of truth
// (R1): the gateway /api/points/rating-email receives a ratingId, this
// module reads the rating doc + family + the week's ratings, resolves the
// audience by IDENTITY (R2 — fixes the "parents got the grandma template"
// bug), renders three tiers and sends:
//
//   • family   — parents/helpers with the personal toggle on, Family
//                contacts, 👥 group members → the full Heat Report (E1)
//                (or the totals-only card when pointsEmailDetail='totals')
//   • kid      — the rated kid via the COPPA pointer when '🧒 the kid it's
//                about' is armed → the Kid Heat Report (E2), tone follows
//                pointsMode (R7), reasons/reflection follow kidFeedback (R8)
//   • outside  — ✉️ custom emails + group externals → first name + total +
//                counts only (E3). Never task names, never reasons, no links.
//
// Nothing here throws into the rating flow — every failure is logged to
// the 📜 alertLog (kind 'points_email' / 'kid_reward') and swallowed.

import type { Firestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { resolveKidEmailAddress, KID_REWARD_TEMPLATE_VERSION } from './kidEmails.server';

type AdminDb = Firestore;

const resendKey = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const resend = resendKey ? new Resend(resendKey) : null;

/** Bump together with the family/outside templates below AND the
 *  HeatEmailView in /pantry/utility-meters/alerts (F9 discipline). */
export const POINTS_EMAIL_TEMPLATE_VERSION = 1;

// ── Types ────────────────────────────────────────────────────────────
export type RatingValue = 'excellent' | 'good' | 'bad' | 'skip';
export type PointsMode = 'full' | 'badges-only' | 'encouragement';

interface RoutineLite {
  id: string; label: string; icon?: string; period: 'morning' | 'evening';
  pointsExcellent?: number; pointsGood?: number; pointsBad?: number; active?: boolean;
}
interface RatingLite {
  id: string; childId: string; date: string; period: 'morning' | 'evening';
  ratings: Record<string, RatingValue>; totalPoints?: number;
  ratedBy?: string; ratedByName?: string; comment?: string;
  ratingNotes?: Record<string, string>;
  reflections?: Record<string, { text: string; byUid: string; byName: string; at: number } | null>;
}
interface ChildLite {
  name?: string; avatarEmoji?: string; totalPoints?: number; routinePoints?: number; streak?: number; email?: string;
}
interface MemberLite {
  uid: string; email?: string; role?: string; displayName?: string;
  notifyOnRating?: boolean; notifyOnAward?: boolean;
}
interface FamilyLite {
  name?: string;
  routines?: RoutineLite[];
  pointsMode?: PointsMode;
  pointSystem?: { routines?: { pointsPerHousePoint?: number } };
  externalContacts?: { id: string; name: string; email: string; notifyOnRating?: boolean; notifyOnAward?: boolean }[];
  emailGroups?: { id: string; name: string; memberUids: string[]; externalEmails: string[] }[];
  pointsEmailAudience?: {
    rating?: { kidItsAbout?: boolean; groupIds?: string[]; emails?: string[]; fullEmails?: string[] };
    award?: { kidItsAbout?: boolean; groupIds?: string[]; emails?: string[]; fullEmails?: string[] };
  };
  /** 🔥 Heat Report (2026-08-23): family-tier report style. Default 'heat'. */
  pointsEmailDetail?: 'heat' | 'totals';
  /** 🧒 Kids see the feedback (R8). All default ON. */
  kidFeedback?: { includeReasons?: boolean; askReflection?: boolean; inAppInbox?: boolean };
  kidEmailUpdates?: Record<string, unknown>;
}

export interface HeatTask {
  id: string; icon: string; label: string; value: RatingValue;
  pts: number; max: number; note?: string;
}
export interface HeatWeekDay { key: string; label: string; am: number | null; pm: number | null; today: boolean }
export interface HeatReportFacts {
  ratingId: string; childId: string;
  kidName: string; kidFirst: string; kidEmoji: string;
  period: 'morning' | 'evening'; dateKey: string; dateLabel: string;
  ratedByName: string; ratedByFirst: string;
  points: number; maxPoints: number; scorePct: number | null;
  tally: { ex: number; gd: number; bd: number; sk: number };
  tasks: HeatTask[];
  comment?: string;
  hp: { perHP: number; progress: number; balance: number; streak: number };
  prev?: { label: string; scorePct: number | null; points: number };
  week: {
    days: HeatWeekDay[];
    best?: { icon: string; label: string; n: number; of: number };
    watch?: { icon: string; label: string; bad: number };
    avgNow: number | null; avgPrev: number | null;
  };
  focus?: { icon: string; label: string; line: string; why: string };
  reflection?: { text: string; byName: string; dateLabel: string; routineLabel: string };
  pointsMode: PointsMode;
}

export interface RatingAudience {
  family: { email: string; name: string }[];
  outside: string[];
  kid: { email: string; name: string; sourceLabel: string } | null;
}

// ── Small utils ──────────────────────────────────────────────────────
function esc(s: string | undefined | null): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const first = (s?: string) => (s || '').trim().split(/\s+/)[0] || '';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function parseKey(k: string): Date { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); }
function keyOf(d: Date): string { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
function addDays(k: string, n: number): string { const d = parseKey(k); d.setUTCDate(d.getUTCDate() + n); return keyOf(d); }
/** DD-Mmm-YYYY (Elia's display rule) with weekday prefix: "Sat 22-Aug-2026". */
export function displayDate(k: string): string {
  const d = parseKey(k);
  return `${DOW[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}
function mondayOf(k: string): string { const d = parseKey(k); const dow = d.getUTCDay(); return addDays(k, -((dow + 6) % 7)); }
function ptsFor(r: RoutineLite, v: RatingValue | undefined): number {
  if (v === 'excellent') return r.pointsExcellent ?? 2;
  if (v === 'good') return r.pointsGood ?? 1;
  if (v === 'bad') return r.pointsBad ?? 0;
  return 0;
}
function scoreOf(rating: RatingLite, routines: RoutineLite[]): number | null {
  let earned = 0, max = 0;
  for (const [rid, v] of Object.entries(rating.ratings || {})) {
    if (v === 'skip') continue;
    const r = routines.find((x) => x.id === rid);
    if (!r) continue;
    earned += ptsFor(r, v); max += Math.max(r.pointsExcellent ?? 2, r.pointsGood ?? 1, r.pointsBad ?? 0);
  }
  return max > 0 ? Math.round((earned / max) * 100) : null;
}

// ── Facts composer ───────────────────────────────────────────────────
export async function composeHeatFacts(
  db: AdminDb, familyId: string, ratingId: string,
): Promise<{ facts: HeatReportFacts; fam: FamilyLite; rating: RatingLite; child: ChildLite } | null> {
  const famRef = db.collection('families').doc(familyId);
  const ratingSnap = await famRef.collection('ratings').doc(ratingId).get();
  if (!ratingSnap.exists) return null;
  const rating = { id: ratingSnap.id, ...(ratingSnap.data() as Omit<RatingLite, 'id'>) };
  if (!rating.childId || !rating.date || !rating.period) return null;

  const [famSnap, childSnap] = await Promise.all([
    famRef.get(),
    famRef.collection('children').doc(rating.childId).get(),
  ]);
  const fam = (famSnap.data() || {}) as FamilyLite;
  const child = (childSnap.data() || {}) as ChildLite;
  const allRoutines = fam.routines || [];
  // Routines of this period; fall back to ANY routine for ids present in the
  // doc (renamed/moved/deactivated later — F8).
  const period = rating.period;
  const idsInDoc = Object.keys(rating.ratings || {});
  const ordered: RoutineLite[] = [
    ...allRoutines.filter((r) => r.period === period && idsInDoc.includes(r.id)),
    ...idsInDoc.filter((id) => !allRoutines.some((r) => r.id === id && r.period === period))
      .map((id) => allRoutines.find((r) => r.id === id) || ({ id, label: '(removed task)', icon: '•', period } as RoutineLite)),
  ];

  const tasks: HeatTask[] = ordered.map((r) => {
    const v = (rating.ratings?.[r.id] || 'skip') as RatingValue;
    const note = (rating.ratingNotes?.[r.id] || '').trim();
    return {
      id: r.id, icon: r.icon || '•', label: r.label || r.id, value: v,
      pts: ptsFor(r, v), max: Math.max(r.pointsExcellent ?? 2, r.pointsGood ?? 1, r.pointsBad ?? 0),
      ...(note ? { note } : {}),
    };
  });
  const tally = { ex: 0, gd: 0, bd: 0, sk: 0 };
  for (const t of tasks) { if (t.value === 'excellent') tally.ex++; else if (t.value === 'good') tally.gd++; else if (t.value === 'bad') tally.bd++; else tally.sk++; }
  const maxPoints = tasks.filter((t) => t.value !== 'skip').reduce((s, t) => s + t.max, 0);
  const points = typeof rating.totalPoints === 'number' ? rating.totalPoints : tasks.reduce((s, t) => s + t.pts, 0);
  const scorePct = maxPoints > 0 ? Math.round((points / maxPoints) * 100) : null;

  // Week context (R5): Mon→today + last week's same weekday. One range
  // query on `date` (no composite index), filtered by child in memory.
  const monday = mondayOf(rating.date);
  const from = addDays(rating.date, -7) < monday ? addDays(rating.date, -7) : monday;
  let weekDocs: RatingLite[] = [];
  try {
    const snap = await famRef.collection('ratings').where('date', '>=', from).where('date', '<=', rating.date).get();
    weekDocs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RatingLite, 'id'>) })).filter((r) => r.childId === rating.childId);
  } catch { weekDocs = []; }

  const days: HeatWeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const k = addDays(monday, i);
    const d = parseKey(k);
    const am = weekDocs.find((r) => r.date === k && r.period === 'morning');
    const pm = weekDocs.find((r) => r.date === k && r.period === 'evening');
    days.push({
      key: k, label: DOW[d.getUTCDay()],
      am: k > rating.date ? null : am ? scoreOf(am, allRoutines) : null,
      pm: k > rating.date ? null : pm ? scoreOf(pm, allRoutines) : null,
      today: k === rating.date,
    });
  }
  const thisWeek = weekDocs.filter((r) => r.date >= monday && r.date <= rating.date);
  // best / watch across the week (both periods)
  const perRoutine = new Map<string, { ex: number; bad: number; n: number }>();
  for (const r of thisWeek) {
    for (const [rid, v] of Object.entries(r.ratings || {})) {
      if (v === 'skip') continue;
      const c = perRoutine.get(rid) || { ex: 0, bad: 0, n: 0 };
      c.n++; if (v === 'excellent') c.ex++; if (v === 'bad') c.bad++;
      perRoutine.set(rid, c);
    }
  }
  let best: HeatReportFacts['week']['best'];
  let watch: HeatReportFacts['week']['watch'];
  for (const [rid, c] of perRoutine) {
    const r = allRoutines.find((x) => x.id === rid); if (!r) continue;
    if (c.n >= 2 && c.ex === c.n && (!best || c.n > best.of)) best = { icon: r.icon || '•', label: r.label, n: c.ex, of: c.n };
    if (c.bad >= 1 && (!watch || c.bad > watch.bad)) watch = { icon: r.icon || '•', label: r.label, bad: c.bad };
  }
  if (!best) {
    for (const [rid, c] of perRoutine) {
      const r = allRoutines.find((x) => x.id === rid); if (!r) continue;
      if (c.n >= 2 && (!best || c.ex / c.n > best.n / best.of)) best = { icon: r.icon || '•', label: r.label, n: c.ex, of: c.n };
    }
  }
  // averages: this period's points this week vs last week (same period)
  const samePeriodNow = thisWeek.filter((r) => r.period === period);
  const samePeriodPrev = weekDocs.filter((r) => r.period === period && r.date < monday);
  const avg = (rs: RatingLite[]) => rs.length ? Math.round(rs.reduce((s, r) => s + (r.totalPoints || 0), 0) / rs.length) : null;
  // previous comparable: last week same weekday same period, else yesterday same period
  const lastWeekKey = addDays(rating.date, -7);
  const prevDoc = weekDocs.find((r) => r.date === lastWeekKey && r.period === period && r.id !== rating.id)
    || weekDocs.find((r) => r.date === addDays(rating.date, -1) && r.period === period && r.id !== rating.id);
  const prev = prevDoc ? {
    label: prevDoc.date === lastWeekKey ? `last ${DOW[parseKey(lastWeekKey).getUTCDay()]}` : 'yesterday',
    scorePct: scoreOf(prevDoc, allRoutines), points: prevDoc.totalPoints || 0,
  } : undefined;

  // 🌱 Tomorrow's focus (R6): lowest task today; tie → most bad this week.
  let focus: HeatReportFacts['focus'];
  const bads = tasks.filter((t) => t.value === 'bad');
  const goods = tasks.filter((t) => t.value === 'good');
  const pick = (bads.length ? bads : goods).sort((a, b) => (perRoutine.get(b.id)?.bad || 0) - (perRoutine.get(a.id)?.bad || 0))[0];
  if (pick) {
    const badWeek = perRoutine.get(pick.id)?.bad || 0;
    const line = pick.note ? pick.note : (pick.value === 'bad' ? 'let’s make tomorrow better' : 'one step from excellent');
    const why = pick.value === 'bad'
      ? (badWeek >= 2 ? `Needs work ${badWeek}× this week.` : 'The one task that needs work tonight.')
      : 'Only task not excellent — an easy win tomorrow.';
    focus = { icon: pick.icon, label: pick.label, line, why };
  }

  // 💭 The kid's side: latest reflection on any rating of this kid in the
  // window (not this one — it can't have one yet).
  let reflection: HeatReportFacts['reflection'];
  for (const r of weekDocs) {
    if (r.id === rating.id) continue;
    for (const [rid, ref] of Object.entries(r.reflections || {})) {
      if (!ref?.text) continue;
      if (!reflection || ref.at > (reflection as unknown as { _at: number })._at) {
        const rt = allRoutines.find((x) => x.id === rid);
        reflection = Object.assign({ text: ref.text, byName: ref.byName || first(child.name) || 'Kid', dateLabel: displayDate(r.date), routineLabel: rt?.label || rid }, { _at: ref.at });
      }
    }
  }
  if (reflection) delete (reflection as unknown as { _at?: number })._at;

  const perHP = Math.max(1, fam.pointSystem?.routines?.pointsPerHousePoint ?? 100);
  const facts: HeatReportFacts = {
    ratingId: rating.id, childId: rating.childId,
    kidName: child.name || 'Kid', kidFirst: first(child.name) || 'Kid', kidEmoji: child.avatarEmoji || '🧒',
    period, dateKey: rating.date, dateLabel: displayDate(rating.date),
    ratedByName: rating.ratedByName || 'Family', ratedByFirst: first(rating.ratedByName) || 'Family',
    points, maxPoints, scorePct, tally, tasks,
    ...(rating.comment?.trim() ? { comment: rating.comment.trim() } : {}),
    hp: { perHP, progress: Math.max(0, child.routinePoints || 0), balance: child.totalPoints || 0, streak: child.streak || 0 },
    ...(prev ? { prev } : {}),
    week: { days, ...(best ? { best } : {}), ...(watch ? { watch } : {}), avgNow: avg(samePeriodNow), avgPrev: avg(samePeriodPrev) },
    ...(focus ? { focus } : {}),
    ...(reflection ? { reflection } : {}),
    pointsMode: (fam.pointsMode === 'badges-only' || fam.pointsMode === 'encouragement') ? fam.pointsMode : 'full',
  };
  return { facts, fam, rating, child };
}

// ── Audience by identity (R2) ────────────────────────────────────────
export async function resolveRatingAudience(
  db: AdminDb, familyId: string, fam: FamilyLite, raterUid: string | undefined, childId: string,
): Promise<RatingAudience> {
  return resolvePointsAudience(db, familyId, fam, raterUid, childId, 'rating');
}

/** Shared by rating + award emails: the same three tiers, the same
 *  identity rules; only the family-level audience slot + the personal
 *  toggle (notifyOnRating / notifyOnAward) differ. */
export async function resolvePointsAudience(
  db: AdminDb, familyId: string, fam: FamilyLite, actorUid: string | undefined, childId: string,
  type: 'rating' | 'award',
): Promise<RatingAudience> {
  const raterUid = actorUid;
  const membersSnap = await db.collection('users').where('familyId', '==', familyId).get();
  const members = membersSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<MemberLite, 'uid'>) }));
  const aud = (fam.pointsEmailAudience as Record<string, { kidItsAbout?: boolean; groupIds?: string[]; emails?: string[]; fullEmails?: string[] } | undefined> | undefined)?.[type] || {};
  const groups = (fam.emailGroups || []).filter((g) => (aud.groupIds || []).includes(g.id));
  const lower = (e?: string) => (e || '').trim().toLowerCase();
  const explicit = new Set<string>([
    ...(aud.emails || []).map(lower),
    ...groups.flatMap((g) => (g.externalEmails || []).map(lower)),
  ]);
  const groupMemberUids = new Set(groups.flatMap((g) => g.memberUids || []));

  // ✉️ custom emails a parent flipped to 🔥 full (their own work inbox,
  // the other parent's second address…) — parent-declared identity.
  const fullEmails = new Set<string>((aud.fullEmails || []).map(lower));

  const family = new Map<string, { email: string; name: string }>();
  const identity = new Set<string>();  // every address that belongs to a family identity
  for (const m of members) {
    const e = lower(m.email); if (!e) continue;
    identity.add(e);
    if (m.role === 'kid') continue;
    if (m.uid === raterUid) continue;                       // never mail the rater
    if (/@helper\.kaya\.app$/i.test(e)) continue;          // helper login stubs — not real inboxes
    const on = (type === 'rating' ? m.notifyOnRating : m.notifyOnAward) !== false; // personal toggle (default on)
    if (on || groupMemberUids.has(m.uid) || explicit.has(e)) family.set(e, { email: m.email!, name: m.displayName || e });
  }
  for (const c of fam.externalContacts || []) {
    const e = lower(c.email); if (!e) continue;
    identity.add(e);
    if ((type === 'rating' ? c.notifyOnRating : c.notifyOnAward) !== false || explicit.has(e)) family.set(e, { email: c.email, name: c.name || e });
  }
  // 🧒 kid tier (awards: the kid tier rides giveAward → /api/kids/reward-email,
  // so the award gateway never resolves it — no double sends)
  let kid: RatingAudience['kid'] = null;
  if (type === 'rating' && aud.kidItsAbout === true) {
    const resolved = await resolveKidEmailAddress(db, familyId, childId, fam as Parameters<typeof resolveKidEmailAddress>[3]);
    if (resolved) kid = { email: resolved.email, name: '', sourceLabel: resolved.sourceLabel };
  }
  for (const e of fullEmails) {
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !identity.has(e) && !family.has(e)) family.set(e, { email: e, name: e });
    identity.add(e);
  }
  // outside = explicit addresses that belong to NO family identity
  const outside = Array.from(explicit).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !identity.has(e) && e !== lower(kid?.email));
  return { family: Array.from(family.values()).slice(0, 30), outside: outside.slice(0, 30), kid };
}

// ── Templates ────────────────────────────────────────────────────────
const C = {
  ex: { bg: '#E3F5EA', bd: '#BFE6CC', fg: '#2E9E5B', tag: '🌟' },
  gd: { bg: '#FFF3CC', bd: '#F1DD98', fg: '#9A7300', tag: '👍' },
  bd: { bg: '#FDE8EC', bd: '#F3C0C9', fg: '#B8434F', tag: '👎' },
  gr: { bg: '#FFF0E0', bd: '#F5D3AE', fg: '#B86A1C', tag: '🌱' },
  sk: { bg: '#F1EEE6', bd: '#DDD7CA', fg: '#B8B2A4', tag: '—' },
};
type Tone = keyof typeof C;
function toneOf(v: RatingValue, mode: PointsMode): Tone {
  if (v === 'excellent') return 'ex';
  if (v === 'good') return 'gd';
  if (v === 'bad') return mode === 'encouragement' ? 'gr' : 'bd';
  return 'sk';
}
function frame(preheader: string, body: string, footer: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>Kaya</title></head>
<body style="margin:0;padding:0;background:#FDFBF7;font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;color:#1A1412;-webkit-font-smoothing:antialiased;">
<span style="display:none!important;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FDFBF7;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="540" style="max-width:540px;width:100%;background:#fff;border:1px solid #E8E0D4;border-radius:16px;overflow:hidden;">
<tr><td style="padding:16px 22px;background:#FDFBF7;border-bottom:1px solid #E8E0D4;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:10px;"><div style="width:30px;height:30px;background:#1E120B;color:#F5E6B8;border-radius:8px;font-weight:bold;font-size:13px;text-align:center;line-height:30px;">K</div></td><td style="vertical-align:middle;font-weight:700;font-size:15px;letter-spacing:-0.02em;">Kaya</td></tr></table></td></tr>
<tr><td style="padding:22px 20px;">${body}</td></tr>
<tr><td style="padding:14px 20px;background:#FDFBF7;border-top:1px solid #E8E0D4;font-size:12px;color:#9B8A72;text-align:center;">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}
const h4 = (t: string, right = '') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 8px"><tr><td style="font-size:12.5px;font-weight:800;color:#1A1412">${t}</td><td align="right" style="font-size:11px;color:#9B8A72;font-weight:600">${right}</td></tr></table>`;

function heatGrid(tasks: HeatTask[], mode: PointsMode, showPts: boolean): string {
  const cols = 4;
  const rows: string[] = [];
  for (let i = 0; i < tasks.length; i += cols) {
    const cells = tasks.slice(i, i + cols).map((t) => {
      const tone = toneOf(t.value, mode); const c = C[tone];
      const badge = showPts ? (t.value === 'skip' ? '—' : `+${t.pts}`) : (tone === 'gr' ? '🌱 growing' : c.tag);
      return `<td width="25%" style="padding:3px"><div style="background:${c.bg};border:1px solid ${c.bd};border-radius:10px;padding:8px 4px 7px;text-align:center;min-height:58px;${tone === 'sk' ? 'opacity:.7' : ''}">
        <div style="font-size:18px;line-height:1.1">${esc(t.icon)}</div>
        <div style="font-size:10px;font-weight:700;line-height:1.2;margin-top:3px;color:#1A1412">${esc(t.label)}</div>
        <div style="font-size:10px;font-weight:900;margin-top:3px;color:${c.fg}">${badge}</div></div></td>`;
    });
    while (cells.length < cols) cells.push('<td width="25%"></td>');
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate">${rows.join('')}</table>`;
}
function tallyChips(f: HeatReportFacts, mode: PointsMode, withScore: boolean): string {
  const chip = (tone: Tone, text: string) => `<span style="display:inline-block;font-size:11.5px;font-weight:800;padding:4px 9px;border-radius:999px;border:1px solid ${C[tone].bd};background:${C[tone].bg};color:${C[tone].fg};margin:4px 4px 0 0">${text}</span>`;
  const badTone: Tone = mode === 'encouragement' ? 'gr' : 'bd';
  const badWord = mode === 'encouragement' ? 'growing' : 'needs work';
  let s = '';
  if (f.tally.ex) s += chip('ex', `🌟 ${f.tally.ex} excellent`);
  if (f.tally.gd) s += chip('gd', `👍 ${f.tally.gd} good`);
  if (f.tally.bd) s += chip(badTone, `${C[badTone].tag} ${f.tally.bd} ${badWord}`);
  if (f.tally.sk) s += chip('sk', `— ${f.tally.sk} skipped`);
  if (withScore && f.scorePct != null) s += `<span style="display:inline-block;font-size:11.5px;font-weight:800;padding:4px 9px;border-radius:999px;border:1px solid #E2DCCC;background:#F3F0E8;color:#5C5547;margin:4px 4px 0 0">Score ${f.scorePct}%</span>`;
  return `<div style="margin-top:6px">${s}</div>`;
}
function whyCard(tone: Tone, title: string, by: string, text: string): string {
  const c = C[tone];
  return `<div style="border-left:4px solid ${c.fg};border-radius:0 10px 10px 0;padding:9px 12px;margin-bottom:7px;background:${tone === 'ex' ? '#F6FCF8' : tone === 'gr' ? '#FFFAF4' : '#FFF7F8'}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:12.5px;font-weight:800;color:#1A1412">${title}</td><td align="right" style="font-size:10.5px;color:#9B8A72;font-weight:600">${esc(by)}</td></tr></table>
    <div style="font-size:12.5px;line-height:1.55;margin-top:3px;color:#3B3430">${text}</div></div>`;
}
function weekStrip(f: HeatReportFacts, mode: PointsMode): string {
  const cell = (pct: number | null, today: boolean, future: boolean) => {
    let bg = '#fff', bd = '1px dashed #E2DCCC';
    if (!future && pct != null) {
      const tone: Tone = pct >= 80 ? 'ex' : pct >= 50 ? 'gd' : (mode === 'encouragement' ? 'gr' : 'bd');
      bg = C[tone].bg; bd = `1px solid ${C[tone].bd}`;
    } else if (!future) { bg = '#F1EEE6'; bd = '1px solid #DDD7CA'; }
    return `<td style="padding:2px"><div style="height:20px;border-radius:6px;background:${bg};border:${bd};${today ? 'outline:2px solid #1F2A44;outline-offset:1px;' : ''}"></div></td>`;
  };
  const head = f.week.days.map((d) => `<td style="font-size:10px;color:#9B8A72;font-weight:700;text-align:center">${d.label}</td>`).join('');
  const am = f.week.days.map((d) => cell(d.am, d.today && f.period === 'morning', d.key > f.dateKey)).join('');
  const pm = f.week.days.map((d) => cell(d.pm, d.today && f.period === 'evening', d.key > f.dateKey)).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="width:44px"></td>${head}</tr>
  <tr><td style="font-size:11px;color:#9B8A72;font-weight:700">☀️ AM</td>${am}</tr>
  <tr><td style="font-size:11px;color:#9B8A72;font-weight:700">🌙 PM</td>${pm}</tr></table>`;
}
function weekChips(f: HeatReportFacts, mode: PointsMode): string {
  const chip = (t: string, tone?: 'up' | 'dn') => `<span style="display:inline-block;font-size:11px;font-weight:800;padding:4px 9px;border-radius:999px;background:${tone === 'up' ? C.ex.bg : tone === 'dn' ? (mode === 'encouragement' ? C.gr.bg : C.bd.bg) : '#F3F0E8'};color:${tone === 'up' ? C.ex.fg : tone === 'dn' ? (mode === 'encouragement' ? C.gr.fg : C.bd.fg) : '#5C5547'};margin:4px 4px 0 0">${t}</span>`;
  let s = '';
  if (f.hp.streak > 1) s += chip(`🔥 Streak ${f.hp.streak} days`);
  if (f.week.best) s += chip(`🏆 Best: ${esc(f.week.best.label)} ${f.week.best.n}/${f.week.best.of}`, 'up');
  if (f.week.watch && mode !== 'encouragement') s += chip(`👀 Watch: ${esc(f.week.watch.label)} ${f.week.watch.bad}× 👎`, 'dn');
  if (f.week.avgNow != null && f.week.avgPrev != null && mode === 'full') s += chip(`${f.period === 'morning' ? 'Mornings' : 'Evenings'} avg ${f.week.avgPrev} → ${f.week.avgNow} ${f.week.avgNow >= f.week.avgPrev ? '▲' : '▼'}`);
  return s ? `<div style="margin-top:4px">${s}</div>` : '';
}
function hpBar(f: HeatReportFacts, dark: boolean): string {
  if (f.hp.perHP <= 1) return '';
  const pct = Math.min(100, Math.round((f.hp.progress / f.hp.perHP) * 100));
  return `<div style="height:6px;background:${dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)'};border-radius:99px;overflow:hidden;margin-top:6px"><div style="height:6px;width:${pct}%;background:${dark ? '#F0A32A' : '#1F2A44'};border-radius:99px"></div></div>
  <div style="font-size:10.5px;color:${dark ? '#C4B89A' : '#5A3D00'};margin-top:3px">${f.hp.progress} / ${f.hp.perHP} → next House Point</div>`;
}
const btn = (href: string, label: string, style: 'p' | 's' | 'k') => `<a href="${href}" style="display:inline-block;font-weight:800;font-size:13px;padding:10px 16px;border-radius:10px;text-decoration:none;margin:0 6px 6px 0;${style === 'p' ? 'background:#D4A017;color:#1A1412' : style === 'k' ? 'background:#1F2A44;color:#fff' : 'background:#fff;color:#1A1412;border:1px solid #E8E0D4'}">${label}</a>`;

export function subjectFamily(f: HeatReportFacts): string {
  const p = f.period === 'morning' ? '☀️' : '🌙';
  const t = [f.tally.ex ? `${f.tally.ex} 🌟` : '', f.tally.gd ? `${f.tally.gd} 👍` : '', f.tally.bd ? `${f.tally.bd} 👎` : ''].filter(Boolean).join(' ');
  return `${p} ${f.kidFirst}'s ${f.period} — +${f.points} · ${t}`.slice(0, 140);
}

/** E1 — the family Heat Report. */
export function renderFamilyHeat(f: HeatReportFacts): string {
  const periodLabel = f.period === 'morning' ? '☀️ Morning routine' : '🌙 Evening routine';
  const prevTxt = f.prev && f.prev.scorePct != null && f.scorePct != null
    ? `<span style="color:${f.scorePct >= f.prev.scorePct ? '#9EE2B6' : '#F5B5BD'}">${f.scorePct >= f.prev.scorePct ? '▲' : '▼'} vs ${esc(f.prev.label)} ${f.prev.scorePct}%</span>` : '';
  const reasons = f.tasks.filter((t) => t.note && (t.value === 'bad' || t.value === 'excellent' || t.value === 'good'))
    .sort((a, b) => (a.value === 'bad' ? 0 : a.value === 'good' ? 1 : 2) - (b.value === 'bad' ? 0 : b.value === 'good' ? 1 : 2));
  const reasonsHtml = reasons.length || f.comment ? `${h4('🗒️ The reasons', `what ${esc(f.ratedByFirst)} wrote`)}
    ${reasons.map((t) => whyCard(toneOf(t.value, 'full'), `${C[toneOf(t.value, 'full')].tag} ${esc(t.icon)} ${esc(t.label)}`, `— ${f.ratedByFirst}`, esc(t.note))).join('')}
    ${f.comment ? `<div style="background:#FDFBF7;border:1px dashed #E8E0D4;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.6;color:#3B3430;font-style:italic">“${esc(f.comment)}”</div>` : ''}` : '';
  const focusHtml = f.focus ? `${h4('🌱 Tomorrow’s focus')}
    <div style="background:linear-gradient(135deg,#FFF4D6,#FFE9B3);border:1px solid #F1DD98;border-radius:12px;padding:11px 13px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="font-size:22px;padding-right:10px;vertical-align:top">${esc(f.focus.icon)}</td><td>
    <div style="font-size:12.5px;font-weight:800;color:#1A1412">${esc(f.focus.label)} — ${esc(f.focus.line)}</div>
    <div style="font-size:12px;line-height:1.5;color:#5A4A1C;margin-top:2px">${esc(f.focus.why)} Same line goes to ${esc(f.kidFirst)}’s report, so you’re both aiming at one thing.</div></td></tr></table></div>`
    : `${h4('🏆 Nothing to fix')}<div style="background:#E3F5EA;border:1px solid #BFE6CC;border-radius:12px;padding:11px 13px;font-size:12.5px;font-weight:700;color:#2E9E5B">Every task excellent — tell ${esc(f.kidFirst)}.</div>`;
  const reflHtml = f.reflection
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #E8E0D4;border-radius:12px;width:100%"><tr><td style="padding:11px 13px"><div style="font-size:12.5px;font-weight:800">${esc(f.kidEmoji)} ${esc(f.reflection.byName)} · on ${esc(f.reflection.routineLabel)} · ${esc(f.reflection.dateLabel)}</div><div style="font-size:12.3px;line-height:1.55;color:#3B3430;margin-top:2px">“${esc(f.reflection.text)}”</div></td></tr></table>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #E8E0D4;border-radius:12px;width:100%"><tr><td style="padding:11px 13px"><div style="font-size:12.5px;font-weight:800">${esc(f.kidEmoji)} Not yet</div><div style="font-size:12.3px;line-height:1.55;color:#3B3430;margin-top:2px">${esc(f.kidFirst)} can reply from My Stats (📬 Feedback). A reply shows here and in Reports → Behaviour.</div></td></tr></table>`;
  const raiseUrl = f.focus ? `${APP_URL}/reminders?raise=${encodeURIComponent(`${f.childId}:${f.tasks.find((t) => t.label === f.focus!.label)?.id || ''}`)}` : '';
  const body = `
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:#9B8A72">${periodLabel} · ${esc(f.dateLabel)} · rated by ${esc(f.ratedByFirst)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;background:#1E120B;background-image:linear-gradient(135deg,#1E120B,#3D241A);border-radius:14px"><tr>
      <td style="padding:18px 16px 16px;vertical-align:middle;width:120px"><div style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:40px;font-weight:900;line-height:1;color:#fff">+${f.points}</div><div style="font-size:10.5px;color:#C4B89A;text-transform:uppercase;letter-spacing:.14em;font-weight:700;margin-top:4px">routine points</div></td>
      <td style="padding:18px 16px 16px 0;vertical-align:middle;text-align:right;font-size:12.5px;color:#F5E6B8;line-height:1.5">${esc(f.kidFirst)}${f.scorePct != null ? ` · score <b>${f.scorePct}%</b>` : ''} ${prevTxt}${hpBar(f, true)}</td></tr></table>
    ${h4('🔥 How each task went', `${f.tasks.length} tasks`)}
    ${heatGrid(f.tasks, 'full', true)}
    ${tallyChips(f, 'full', true)}
    ${reasonsHtml}
    ${focusHtml}
    ${h4('📅 This week', 'Mon → today')}
    ${weekStrip(f, 'full')}
    ${weekChips(f, 'full')}
    ${h4(`💭 ${esc(f.kidFirst)}’s side`)}
    ${reflHtml}
    <div style="margin-top:16px">${btn(`${APP_URL}/stats/me?kid=${encodeURIComponent(f.childId)}`, 'Open the full breakdown →', 'p')}${raiseUrl ? btn(raiseUrl, '🗣️ Raise on Sunday', 's') : ''}</div>`;
  const pre = [f.focus ? `${f.focus.label} needs a look` : 'All excellent', f.week.best ? `${f.week.best.label} shone` : '', `rated by ${f.ratedByFirst}`].filter(Boolean).join(' · ');
  return frame(pre, body, `<a href="${APP_URL}/dashboard" style="color:#D4A017;text-decoration:none;font-weight:600;">Open dashboard →</a><div style="margin-top:8px;color:#C4B89A;">@ourkaya.app · Made with love, by a family.</div>`);
}

/** Totals-only family card (pointsEmailDetail = 'totals') — today's look. */
export function renderFamilyTotals(f: HeatReportFacts): string {
  const periodLabel = f.period === 'morning' ? 'morning ☀️' : 'evening 🌙';
  const body = `
    <p style="margin:0 0 16px;font-size:14px;color:#9B8A72;line-height:1.5;"><strong style="color:#1A1412;">${esc(f.ratedByName)}</strong> rated <strong style="color:#1A1412;">${esc(f.kidName)}</strong>'s ${periodLabel} routine.</p>
    <div style="background:#1E120B;background-image:linear-gradient(135deg,#1E120B,#3D241A);color:#fff;padding:28px 24px;border-radius:16px;text-align:center;">
      <div style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:48px;font-weight:900;line-height:1;">+${f.points}</div>
      <div style="margin-top:6px;font-size:11px;color:#C4B89A;text-transform:uppercase;letter-spacing:0.14em;font-weight:700;">routine points</div>
      <div style="margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,0.1);font-size:14px;color:#F5E6B8;font-weight:600;">${esc(f.kidName)} · ${periodLabel} routine</div>
    </div>
    ${tallyChips(f, 'full', true)}
    <p style="margin:14px 0 0;font-size:12px;color:#C4B89A;text-align:center;">Switch to the 🔥 Heat Report in Settings → Email notifications for the breakdown + reasons.</p>`;
  return frame(`${f.kidName} earned points on the ${f.period} routine`, body, `<a href="${APP_URL}/dashboard" style="color:#D4A017;text-decoration:none;font-weight:600;">Open dashboard →</a><div style="margin-top:8px;color:#C4B89A;">@ourkaya.app · Made with love, by a family.</div>`);
}

/** E3 — outside tier: first name + total + counts. No names, no reasons, no links. */
export function renderOutsideTotals(f: HeatReportFacts, familyName?: string): string {
  const when = f.period === 'morning' ? 'this morning' : 'tonight';
  const body = `
    <p style="margin:0 0 10px;font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:17px;font-weight:800;color:#1A1412;line-height:1.5;">⭐ ${esc(f.kidFirst)} earned +${f.points} points on the ${f.period} routine ${when}.</p>
    ${tallyChips(f, 'full', false)}
    <p style="margin:14px 0 0;font-size:12px;color:#9B8A72;line-height:1.55;">— Kaya${familyName ? `, for ${esc(familyName)}` : ''} 💛</p>`;
  return frame(`${f.kidFirst} earned points on the ${f.period} routine`, body, `<div style="color:#C4B89A;">@ourkaya.app · Made with love, by a family.</div>`);
}
export function subjectOutside(f: HeatReportFacts): string {
  return `${f.kidFirst} earned ${f.points} pts this ${f.period} ⭐`;
}

/** E2 — the Kid Heat Report. Tone follows pointsMode (R7); reasons +
 *  reflection follow the family's kidFeedback switches (R8). */
export function renderKidHeat(f: HeatReportFacts, opts: { includeReasons: boolean; askReflection: boolean }): string {
  const mode = f.pointsMode;
  const numbers = mode === 'full';
  const p = f.period === 'morning' ? '☀️' : '🌙';
  const periodWord = f.period;
  const badTone: Tone = mode === 'encouragement' ? 'gr' : 'bd';
  const heroLeft = numbers
    ? `<div style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:40px;font-weight:900;line-height:1;color:#2A1A00">+${f.points}</div><div style="font-size:10.5px;color:#5A3D00;text-transform:uppercase;letter-spacing:.14em;font-weight:700;margin-top:4px">routine points</div>`
    : `<div style="font-size:40px;line-height:1">✨</div><div style="font-size:10.5px;color:#5A3D00;text-transform:uppercase;letter-spacing:.14em;font-weight:700;margin-top:4px">${f.tally.bd === 0 && f.tally.gd === 0 ? 'perfect' : f.tally.ex >= f.tally.bd ? 'great' : 'good'} ${periodWord}</div>`;
  const excellentCount = f.tally.ex;
  const heroRight = `Hi ${esc(f.kidFirst)} 👋<br>${excellentCount} of ${f.tasks.length - f.tally.sk} tasks ${excellentCount ? 'were <b>excellent</b>!' : 'excellent — tomorrow is yours.'}${numbers ? hpBar(f, false) : ''}`;
  const shone = f.tasks.filter((t) => t.value === 'excellent');
  const grow = f.tasks.filter((t) => t.value === 'bad');
  const shoneNoted = shone.filter((t) => t.note);
  const shoneRest = shone.filter((t) => !t.note);
  let shoneHtml = '';
  if (shone.length) {
    shoneHtml += h4('✨ What shone');
    if (opts.includeReasons) shoneHtml += shoneNoted.map((t) => whyCard('ex', `${esc(t.icon)} ${esc(t.label)}`, '', `<b>${esc(f.ratedByFirst)}’s note:</b> “${esc(t.note)}”`)).join('');
    const restList = (opts.includeReasons ? shoneRest : shone);
    if (restList.length) {
      const names = restList.slice(0, 3).map((t) => `${esc(t.icon)} ${esc(t.label)}`).join(' · ') + (restList.length > 3 ? ` + ${restList.length - 3} more` : '');
      const bestLine = f.week.best && f.week.best.of >= 3 ? `${esc(f.week.best.label)} — ${f.week.best.n} in a row. That’s a habit now. 🏆` : 'Excellent — keep those going.';
      shoneHtml += whyCard('ex', names, '', bestLine);
    }
  }
  let growHtml = '';
  if (grow.length) {
    growHtml += h4(mode === 'encouragement' ? '🌱 Growing' : '🌱 Let’s grow');
    growHtml += grow.map((t) => whyCard(badTone, `${esc(t.icon)} ${esc(t.label)}`, '', (opts.includeReasons && t.note ? `<b>${esc(f.ratedByFirst)}’s note:</b> “${esc(t.note)}”<br>` : '') + `<span style="color:#6B5E55">${grow.length === 1 ? `One ${mode === 'encouragement' ? 'growing task' : 'red'} doesn’t undo ${shone.length || 'the'} green${shone.length === 1 ? '' : 's'}. Tomorrow is a fresh page.` : 'Tomorrow is a fresh page.'}</span>`)).join('');
  }
  const focusHtml = f.focus ? `<div style="background:linear-gradient(135deg,#FFF4D6,#FFE9B3);border:1px solid #F1DD98;border-radius:12px;padding:11px 13px;margin-top:10px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="font-size:22px;padding-right:10px;vertical-align:top">🎯</td><td>
    <div style="font-size:12.5px;font-weight:800;color:#1A1412">Tomorrow’s one thing: ${esc(f.focus.label)}${opts.includeReasons && f.focus.line ? ` — ${esc(f.focus.line)}` : ''}</div>
    <div style="font-size:12px;line-height:1.5;color:#5A4A1C;margin-top:2px">Your family sees this same line — you’re all aiming at one thing.</div></td></tr></table></div>` : '';
  const reflectHtml = opts.askReflection ? `${h4('💭 Your side')}
    <div style="background:#FBF4E4;border-radius:14px 14px 14px 3px;padding:10px 13px;font-size:13px;line-height:1.6">${grow.length ? 'Was something in the way? Tired, busy, something else? Tell us — it goes to your family and into your Stats.' : 'Anything you want to say about today? Tell us — it goes to your family and into your Stats.'}</div>
    <div style="margin-top:12px">${btn(`${APP_URL}/stats/me?reflect=${encodeURIComponent(f.ratingId)}`, '💭 Tell your side →', 'k')}${btn(`${APP_URL}/stats/me`, '📊 My Stats', 's')}</div>`
    : `<div style="margin-top:16px">${btn(`${APP_URL}/stats/me`, '📊 My Stats', 'k')}</div>`;
  const stat = (l: string, v: string) => `<td style="padding:3px"><div style="background:#FBF4E4;border-radius:10px;padding:8px;text-align:center"><div style="font-size:10px;color:#8A8471;font-weight:800">${l}</div><div style="font-size:16px;font-weight:900;color:#C77E0A">${v}</div></div></td>`;
  const statsHtml = numbers ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>${stat('HOUSE POINTS', String(f.hp.balance))}${f.hp.streak > 0 ? stat('STREAK', `🔥 ${f.hp.streak}`) : ''}${f.week.avgNow != null && f.week.avgPrev != null ? stat('THIS WEEK', `${f.week.avgNow >= f.week.avgPrev ? '▲' : '▼'} ${f.week.avgPrev}→${f.week.avgNow}`) : ''}</tr></table>` : '';
  const body = `
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:#9B8A72">${p} Your ${periodWord} · ${esc(f.dateLabel)} · rated by ${esc(f.ratedByFirst)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;background:#F0A32A;background-image:linear-gradient(135deg,#F7B733,#F0A32A);border-radius:14px"><tr>
      <td style="padding:18px 16px 16px;vertical-align:middle;width:130px">${heroLeft}</td>
      <td style="padding:18px 16px 16px 0;vertical-align:middle;text-align:right;font-size:12.5px;color:#5A3D00;line-height:1.5">${heroRight}</td></tr></table>
    ${h4('🔥 Your ' + periodWord + ' in colours')}
    ${heatGrid(f.tasks, mode, false)}
    ${tallyChips(f, mode, false)}
    ${shoneHtml}
    ${growHtml}
    ${focusHtml}
    ${reflectHtml}
    ${statsHtml}`;
  const pre = [shone.length ? `${shone.length} tasks shone ✨` : '', grow.length ? `${grow.length === 1 ? 'one thing' : `${grow.length} things`} to grow 🌱` : '', opts.askReflection ? 'tell us your side 💭' : ''].filter(Boolean).join(' · ');
  return frame(pre, body, `<a href="${APP_URL}/my-day" style="color:#D4A017;text-decoration:none;font-weight:600;">Open Kaya →</a><div style="margin-top:8px;color:#C4B89A;">Sent because your family turned on kid updates · a parent can change this in Settings.</div>`);
}
export function subjectKid(f: HeatReportFacts): string {
  const p = f.period === 'morning' ? '☀️' : '🌙';
  return f.pointsMode === 'full'
    ? `${p} Your ${f.period} in colours, ${f.kidFirst} — +${f.points}!`.slice(0, 140)
    : `${p} Your ${f.period} in colours, ${f.kidFirst} ✨`.slice(0, 140);
}

// ── Send + log ───────────────────────────────────────────────────────
async function log(db: AdminDb, familyId: string, entry: Record<string, unknown>) {
  try { await db.collection('families').doc(familyId).collection('alertLog').add(entry); } catch { /* never blocks */ }
}
async function send(to: string[], subject: string, html: string): Promise<{ sent: boolean; error?: string }> {
  if (!resend) return { sent: false, error: 'resend-not-configured' };
  try { await resend.emails.send({ from: RESEND_FROM, to, subject, html }); return { sent: true }; }
  catch (e) { return { sent: false, error: e instanceof Error ? e.message : 'send-failed' }; }
}

/** Compact facts for the 📜 trace (the alerts page re-renders from these). */
function logFacts(f: HeatReportFacts) {
  return {
    kidName: f.kidName, kidFirst: f.kidFirst, kidEmoji: f.kidEmoji, period: f.period, dateLabel: f.dateLabel,
    ratedByFirst: f.ratedByFirst, points: f.points, scorePct: f.scorePct, tally: f.tally,
    tasks: f.tasks.map((t) => ({ icon: t.icon, label: t.label, value: t.value, pts: t.pts, ...(t.note ? { note: t.note } : {}) })),
    ...(f.comment ? { comment: f.comment } : {}),
    ...(f.focus ? { focus: { icon: f.focus.icon, label: f.focus.label, line: f.focus.line } } : {}),
    pointsMode: f.pointsMode,
  };
}

export interface RatingEmailResult {
  tiers: { family: string[]; outside: string[]; kid: string | null };
  sent: { family: boolean; outside: boolean; kid: boolean };
  detail: 'heat' | 'totals';
}

/** The gateway's worker. mode 'send' sends + logs; 'preview' only composes. */
export async function processRatingEmail(
  db: AdminDb, familyId: string, ratingId: string, mode: 'send' | 'preview',
): Promise<(RatingEmailResult & { html?: { family: string; kid: string; outside: string }; subjects?: { family: string; kid: string; outside: string } }) | null> {
  const composed = await composeHeatFacts(db, familyId, ratingId);
  if (!composed) return null;
  const { facts, fam, rating } = composed;
  const audience = await resolveRatingAudience(db, familyId, fam, rating.ratedBy, rating.childId);
  const detail: 'heat' | 'totals' = fam.pointsEmailDetail === 'totals' ? 'totals' : 'heat';
  const kf = fam.kidFeedback || {};
  const kidOpts = { includeReasons: kf.includeReasons !== false, askReflection: kf.askReflection !== false };

  const familyHtml = detail === 'heat' ? renderFamilyHeat(facts) : renderFamilyTotals(facts);
  const familySubject = detail === 'heat' ? subjectFamily(facts) : `${facts.kidName} earned ${facts.points} pts this ${facts.period} ⭐`;
  const kidHtml = renderKidHeat(facts, kidOpts);
  const kidSubject = subjectKid(facts);
  const outsideHtml = renderOutsideTotals(facts, fam.name);
  const outsideSubject = subjectOutside(facts);

  const result: RatingEmailResult = {
    tiers: { family: audience.family.map((x) => x.email), outside: audience.outside, kid: audience.kid?.email || null },
    sent: { family: false, outside: false, kid: false },
    detail,
  };
  if (mode === 'preview') {
    return { ...result, html: { family: familyHtml, kid: kidHtml, outside: outsideHtml }, subjects: { family: familySubject, kid: kidSubject, outside: outsideSubject } };
  }

  const base = { trigger: 'rating', childId: facts.childId, childName: facts.kidName, firedAt: Date.now(), ratingId };
  if (audience.family.length) {
    const r = await send(audience.family.map((x) => x.email), familySubject, familyHtml);
    result.sent.family = r.sent;
    await log(db, familyId, { kind: 'points_email', tier: 'family', ...base, channels: { email: { on: true, sent: r.sent, ...(r.error ? { error: r.error } : {}), to: audience.family, subject: familySubject, templateVersion: POINTS_EMAIL_TEMPLATE_VERSION, detail, heatFacts: logFacts(facts) } } });
  }
  if (audience.outside.length) {
    const r = await send(audience.outside, outsideSubject, outsideHtml);
    result.sent.outside = r.sent;
    await log(db, familyId, { kind: 'points_email', tier: 'outside', ...base, channels: { email: { on: true, sent: r.sent, ...(r.error ? { error: r.error } : {}), to: audience.outside.map((e) => ({ name: e, email: e })), subject: outsideSubject, templateVersion: POINTS_EMAIL_TEMPLATE_VERSION, detail: 'totals', heatFacts: { ...logFacts(facts), tasks: [], comment: undefined, focus: undefined } } } });
  }
  if (audience.kid) {
    const r = await send([audience.kid.email], kidSubject, kidHtml);
    result.sent.kid = r.sent;
    await log(db, familyId, {
      kind: 'kid_reward', ...base, sourceLabel: audience.kid.sourceLabel,
      channels: { email: {
        on: true, sent: r.sent, ...(r.error ? { error: r.error } : {}),
        to: [{ name: facts.kidName, email: audience.kid.email }], subject: kidSubject,
        templateVersion: KID_REWARD_TEMPLATE_VERSION,
        kidFacts: {
          kidName: facts.kidName, emoji: facts.period === 'morning' ? '☀️' : '🌙',
          headline: facts.pointsMode === 'full' ? `+${facts.points} routine points` : `Your ${facts.period} in colours`,
          detail: `${facts.tally.ex} 🌟 · ${facts.tally.gd} 👍 · ${facts.tally.bd} ${facts.pointsMode === 'encouragement' ? '🌱' : '👎'}`,
          balance: facts.hp.balance, streak: facts.hp.streak,
          heat: { ...logFacts(facts), includeReasons: kidOpts.includeReasons, askReflection: kidOpts.askReflection },
        },
      } },
    });
  }
  return result;
}

// ═══ 🎖️ Award emails 2.0 (R11) ═══════════════════════════════════════
//
// Family + outside tiers for bonus-point awards, same gateway posture
// (/api/points/award-email {awardId}). The KID tier keeps riding
// giveAward → /api/kids/reward-email (every award source covered, no
// double sends) — that template gained the reason card + 💛 Say thanks.

export interface AwardFacts {
  awardId: string; childId: string;
  kidName: string; kidFirst: string; kidEmoji: string;
  points: number; kind: 'regular' | 'diamond' | 'kudos' | 'reducing' | 'improvement_note';
  category: string; reason: string;
  byName: string; byFirst: string; dateLabel: string;
  week: { emoji: string; label: string; points: number; category: string }[];
  hp: { balance: number; streak: number };
}

interface AwardLite {
  childId?: string; kind?: string; points?: number; reason?: string; category?: string;
  awardedBy?: string; awardedByName?: string; createdAt?: { toMillis?: () => number; seconds?: number };
}
const awardKindOf = (a: AwardLite): AwardFacts['kind'] => {
  const k = a.kind as AwardFacts['kind'] | undefined;
  if (k) return k;
  if ((a.category || '').startsWith('diamond-')) return 'diamond';
  if ((a.points || 0) < 0) return 'reducing';
  return 'regular';
};
const awardEmojiOf = (k: AwardFacts['kind']) => k === 'diamond' ? '💎' : k === 'kudos' ? '👏' : k === 'reducing' ? '⚠️' : k === 'improvement_note' ? '☝️' : '🎖️';
const msOf = (c?: { toMillis?: () => number; seconds?: number }) => c?.toMillis ? c.toMillis() : c?.seconds ? c.seconds * 1000 : Date.now();
const keyOfMs = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function composeAwardFacts(db: AdminDb, familyId: string, awardId: string)
  : Promise<{ facts: AwardFacts; fam: FamilyLite; award: AwardLite } | null> {
  const famRef = db.collection('families').doc(familyId);
  const snap = await famRef.collection('awards').doc(awardId).get();
  if (!snap.exists) return null;
  const award = snap.data() as AwardLite;
  if (!award.childId) return null;
  const [famSnap, childSnap] = await Promise.all([famRef.get(), famRef.collection('children').doc(award.childId).get()]);
  const fam = (famSnap.data() || {}) as FamilyLite;
  const child = (childSnap.data() || {}) as ChildLite;
  const when = msOf(award.createdAt);
  const dateKey = keyOfMs(when);
  // This week's awards for the kid (Mon→today) — one range on createdAt.
  const monday = mondayOf(dateKey);
  const mondayMs = new Date(`${monday}T00:00:00`).getTime();
  let week: AwardFacts['week'] = [];
  try {
    // Single range on createdAt (no composite index); filter by kid in memory.
    const ws = await famRef.collection('awards').where('createdAt', '>=', new Date(mondayMs)).get();
    week = ws.docs.map((d) => d.data() as AwardLite)
      .filter((a) => a.childId === award.childId && ((a.points || 0) > 0 || a.kind === 'kudos'))
      .sort((a, b) => msOf(a.createdAt) - msOf(b.createdAt))
      .map((a) => { const k = awardKindOf(a); return { emoji: awardEmojiOf(k), label: DOW[new Date(msOf(a.createdAt)).getDay()], points: a.points || 0, category: (a.category || '').replace(/^diamond-/, '') }; });
  } catch { week = []; }
  const kind = awardKindOf(award);
  const facts: AwardFacts = {
    awardId, childId: award.childId,
    kidName: child.name || 'Kid', kidFirst: first(child.name) || 'Kid', kidEmoji: child.avatarEmoji || '🧒',
    points: award.points || 0, kind, category: (award.category || '').replace(/^diamond-/, ''), reason: (award.reason || '').trim(),
    byName: award.awardedByName || 'Family', byFirst: first(award.awardedByName) || 'Family', dateLabel: displayDate(dateKey),
    week, hp: { balance: child.totalPoints || 0, streak: child.streak || 0 },
  };
  return { facts, fam, award };
}

export function subjectFamilyAward(f: AwardFacts): string {
  const e = awardEmojiOf(f.kind);
  const r = f.reason ? ` — “${f.reason.slice(0, 60)}${f.reason.length > 60 ? '…' : ''}”` : '';
  return `${e} ${f.byFirst} awarded ${f.kidFirst} +${f.points}${r}`.slice(0, 140);
}
export function subjectOutsideAward(f: AwardFacts): string {
  return `${f.byFirst} awarded ${f.kidFirst} +${f.points} pts ${awardEmojiOf(f.kind)}`;
}

/** E4 — family award email: reason card · kind meaning · this week's trail. */
export function renderFamilyAward(f: AwardFacts): string {
  const e = awardEmojiOf(f.kind);
  const diamond = f.kind === 'diamond';
  const kindLabel = diamond ? '💎 Diamond award' : f.kind === 'kudos' ? '👏 Kudos' : 'Regular award';
  const bg = diamond ? 'background:#5B21B6;background-image:linear-gradient(135deg,#7C3AED,#5B21B6)' : 'background:#1E120B;background-image:linear-gradient(135deg,#1E120B,#3D241A)';
  const muted = diamond ? '#C4B5FD' : '#C4B89A'; const accent = diamond ? '#E9D5FF' : '#F5E6B8';
  const trail = f.week.length ? f.week.map((w) => `<span style="display:inline-block;font-size:11px;font-weight:800;padding:4px 9px;border-radius:999px;background:${C.ex.bg};color:${C.ex.fg};margin:4px 4px 0 0">${w.emoji} ${esc(w.label)} +${w.points}${w.category ? ` ${esc(w.category)}` : ''}</span>`).join('') : '';
  const body = `
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:#9B8A72">${e} Bonus points · ${esc(f.dateLabel)} · from ${esc(f.byFirst)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;${bg};border-radius:14px"><tr>
      <td style="padding:18px 16px 16px;vertical-align:middle;width:120px"><div style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:40px;font-weight:900;line-height:1;color:#fff">+${f.points}</div><div style="font-size:10.5px;color:${muted};text-transform:uppercase;letter-spacing:.14em;font-weight:700;margin-top:4px">bonus points</div></td>
      <td style="padding:18px 16px 16px 0;vertical-align:middle;text-align:right;font-size:12.5px;color:${accent};line-height:1.5">${esc(f.kidFirst)} · <b>${kindLabel}</b>${f.category ? `<br><span style="color:${muted}">${esc(f.category)}</span>` : ''}</td></tr></table>
    ${f.reason ? `${h4('🗒️ Why')}${whyCard('ex', `💛 The reason`, `— ${f.byFirst}`, esc(f.reason))}` : ''}
    ${trail ? `${h4('🏅 This week’s awards', 'Mon → today')}<div>${trail}</div>` : ''}
    <div style="margin-top:16px">${btn(`${APP_URL}/stats/me?kid=${encodeURIComponent(f.childId)}`, 'Open awards →', 'p')}</div>`;
  return frame(`${f.kidName} was awarded bonus points`, body, `<a href="${APP_URL}/dashboard" style="color:#D4A017;text-decoration:none;font-weight:600;">Open dashboard →</a><div style="margin-top:8px;color:#C4B89A;">@ourkaya.app · Made with love, by a family.</div>`);
}

/** Outside award tier — first name + points only (reason stays inside). */
export function renderOutsideAward(f: AwardFacts, familyName?: string): string {
  const body = `
    <p style="margin:0 0 10px;font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:17px;font-weight:800;color:#1A1412;line-height:1.5;">${awardEmojiOf(f.kind)} ${esc(f.kidFirst)} was awarded +${f.points} bonus points today.</p>
    <p style="margin:14px 0 0;font-size:12px;color:#9B8A72;line-height:1.55;">— Kaya${familyName ? `, for ${esc(familyName)}` : ''} 💛</p>`;
  return frame(`${f.kidFirst} was awarded bonus points`, body, `<div style="color:#C4B89A;">@ourkaya.app · Made with love, by a family.</div>`);
}

export interface AwardEmailResult {
  tiers: { family: string[]; outside: string[] };
  sent: { family: boolean; outside: boolean };
}
export async function processAwardEmail(db: AdminDb, familyId: string, awardId: string, mode: 'send' | 'preview')
  : Promise<(AwardEmailResult & { html?: { family: string; outside: string }; subjects?: { family: string; outside: string } }) | null> {
  const composed = await composeAwardFacts(db, familyId, awardId);
  if (!composed) return null;
  const { facts, fam, award } = composed;
  // Only celebrate actual rewards: point-bearing positives. Reducing /
  // improvement notes / bare kudos are parenting tools, not a blast.
  if (facts.points <= 0) return { tiers: { family: [], outside: [] }, sent: { family: false, outside: false } };
  const audience = await resolvePointsAudience(db, familyId, fam, award.awardedBy, facts.childId, 'award');
  const familyHtml = renderFamilyAward(facts); const familySubject = subjectFamilyAward(facts);
  const outsideHtml = renderOutsideAward(facts, fam.name); const outsideSubject = subjectOutsideAward(facts);
  const result: AwardEmailResult = { tiers: { family: audience.family.map((x) => x.email), outside: audience.outside }, sent: { family: false, outside: false } };
  if (mode === 'preview') return { ...result, html: { family: familyHtml, outside: outsideHtml }, subjects: { family: familySubject, outside: outsideSubject } };
  const base = { trigger: 'award', childId: facts.childId, childName: facts.kidName, firedAt: Date.now(), awardId };
  const awardFacts = { kidName: facts.kidName, kidFirst: facts.kidFirst, points: facts.points, kind: facts.kind, category: facts.category, byFirst: facts.byFirst, dateLabel: facts.dateLabel, reason: facts.reason, week: facts.week };
  if (audience.family.length) {
    const r = await send(audience.family.map((x) => x.email), familySubject, familyHtml);
    result.sent.family = r.sent;
    await log(db, familyId, { kind: 'points_email', tier: 'family', ...base, channels: { email: { on: true, sent: r.sent, ...(r.error ? { error: r.error } : {}), to: audience.family, subject: familySubject, templateVersion: POINTS_EMAIL_TEMPLATE_VERSION, awardFacts } } });
  }
  if (audience.outside.length) {
    const r = await send(audience.outside, outsideSubject, outsideHtml);
    result.sent.outside = r.sent;
    await log(db, familyId, { kind: 'points_email', tier: 'outside', ...base, channels: { email: { on: true, sent: r.sent, ...(r.error ? { error: r.error } : {}), to: audience.outside.map((e) => ({ name: e, email: e })), subject: outsideSubject, templateVersion: POINTS_EMAIL_TEMPLATE_VERSION, awardFacts: { ...awardFacts, reason: '', week: [] } } } });
  }
  return result;
}
