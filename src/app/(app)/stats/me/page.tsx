'use client';

// Kaya · 📊 My Stats — "see yourself live, do better" (2026-07-29, Elia-approved
// pack, PR 1 of 4).
//
// A kid-facing stats home mirroring the Sunday-Meeting numbers, computed from
// the SAME sources as the meeting Points Review (ratings + awards + the pure
// meetingReview engine) — never a parallel calculation:
//
//   • Timeline bar — This week · This month (+ "More ▾": last 7 days, this
//     year, lifetime, pick month, custom range). ONE selection drives every
//     card. (⚖️ Compare mode lands in PR 2.)
//   • ⭐ House Points hero — routine-vs-award split (HP = ⌊Σ routine points /
//     pointsPerHousePoint⌋ + Σ award points, exactly the Reports math), daily
//     trend bars (ranges ≤ 31 days), ▲/▼ vs the previous equal period.
//   • 😇 Behaviours — per-routine Excellent % with growth-voice colours
//     (green strong · gold okay · red "needs love"). Detail drawer in PR 2.
//   • 🥋 Belt & Ladder — Excellent (perfect) days, rung progress (5 a rung),
//     ⭐ Star-podium appearances from meeting snapshots.
//   • 🏅 Recent awards strip (full Awards-first Discovery lands in PR 3).
//
// Access: kids see ONLY themselves (childId resolved via profile.childId —
// the || email-match self-heal already ran in AuthContext). Parents/helpers
// get a kid switcher. Gated behind the existing `stats` kid-module grant.
// Read-only: rules already allow family members to read ratings/awards —
// no Firestore-rules change.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { auth } from '@/lib/firebase';
import {
  getRatingsInDateRange, getAwardsInDateRange, getMeetings, createNotification,
  readPointSystemConfig, inferAwardKind, DEFAULT_ROUTINES,
  type DailyRating, type Award, type Routine, type Meeting,
} from '@/lib/firestore';
import { toDisplayDate } from '@/lib/dates';

type PeriodKey = 'thisWeek' | 'thisMonth' | 'last7' | 'thisYear' | 'lifetime' | 'month' | 'custom';

/** The 8 award categories — mirrors the parent Award Points page. */
const AWARD_CATEGORIES = [
  { id: 'kindness', emoji: '💖', label: 'Kindness' },
  { id: 'helping', emoji: '🤝', label: 'Helping Others' },
  { id: 'bravery', emoji: '🦁', label: 'Bravery' },
  { id: 'learning', emoji: '📚', label: 'Learning' },
  { id: 'creativity', emoji: '🎨', label: 'Creativity' },
  { id: 'teamwork', emoji: '⭐', label: 'Teamwork' },
  { id: 'responsibility', emoji: '🎯', label: 'Responsibility' },
  { id: 'other', emoji: '✨', label: 'Other' },
] as const;

const categoryKeyOf = (a: Award): string => {
  const raw = (a.category || 'other').replace(/^diamond-/, '');
  return AWARD_CATEGORIES.some((c) => c.id === raw) ? raw : 'other';
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Resolve [from, to] (inclusive, local) for a period. */
function rangeFor(key: PeriodKey, monthKey: string, customFrom: string, customTo: string): { from: string; to: string; label: string } {
  const now = new Date();
  const today = iso(now);
  if (key === 'thisWeek') {
    const dow = (now.getDay() + 6) % 7; // Monday start
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    return { from: iso(from), to: today, label: 'This week' };
  }
  if (key === 'last7') {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    return { from: iso(from), to: today, label: 'Last 7 days' };
  }
  if (key === 'thisMonth') {
    return { from: `${today.slice(0, 7)}-01`, to: today, label: 'This month' };
  }
  if (key === 'thisYear') {
    return { from: `${now.getFullYear()}-01-01`, to: today, label: `This year` };
  }
  if (key === 'month' && /^\d{4}-\d{2}$/.test(monthKey)) {
    const [y, m] = monthKey.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const label = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return { from: `${monthKey}-01`, to: `${monthKey}-${String(last).padStart(2, '0')}`, label };
  }
  if (key === 'custom' && customFrom && customTo && customFrom <= customTo) {
    return { from: customFrom, to: customTo, label: `${toDisplayDate(customFrom)} – ${toDisplayDate(customTo)}` };
  }
  return { from: '2000-01-01', to: today, label: 'Lifetime' };
}

/** The previous period of equal length (for ▲/▼). */
function prevRange(from: string, to: string): { from: string; to: string } | null {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || from <= '2001-01-01') return null;
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  const pt = new Date(f); pt.setDate(pt.getDate() - 1);
  const pf = new Date(pt); pf.setDate(pf.getDate() - (days - 1));
  return { from: iso(pf), to: iso(pt) };
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86400000) + 1;

/** Compare-mode snapshot: HP + per-behaviour % + perfect days for a set
 *  of docs (same math as the live cards — one code path, two windows). */
function snapshot(ratings: DailyRating[], awards: Award[], ppHP: number) {
  const routinePts = ratings.reduce((s, r) => s + (r.totalPoints || 0), 0);
  const awardPts = awards.reduce((s, a) => s + (a.points || 0), 0);
  const per = new Map<string, { rated: number; excellent: number }>();
  const byDay = new Map<string, { rated: number; excellent: number }>();
  ratings.forEach((r) => {
    const day = byDay.get(r.date) || { rated: 0, excellent: 0 };
    Object.entries(r.ratings || {}).forEach(([rid, v]) => {
      if (v === 'skip') return;
      const a = per.get(rid) || { rated: 0, excellent: 0 };
      a.rated += 1; day.rated += 1;
      if (v === 'excellent') { a.excellent += 1; day.excellent += 1; }
      per.set(rid, a);
    });
    byDay.set(r.date, day);
  });
  let perfect = 0;
  byDay.forEach((d) => { if (d.rated > 0 && d.excellent === d.rated) perfect += 1; });
  return { hp: Math.floor(routinePts / ppHP) + awardPts, per, perfect };
}

export default function MyStatsPage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const familyId = profile?.familyId;
  const isKid = profile?.role === 'kid';

  // Kid: locked to self. Parent/helper: kid switcher.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const myChildId = useMemo(() => {
    if (isKid) {
      const direct = profile?.childId?.trim();
      if (direct) return direct;
      const myEmail = profile?.email?.toLowerCase() ?? '';
      return children.find((c) => (c.emailLower || c.email?.toLowerCase() || '') === myEmail)?.id ?? null;
    }
    return pickedId ?? children[0]?.id ?? null;
  }, [isKid, profile?.childId, profile?.email, children, pickedId]);
  const kid = children.find((c) => c.id === myChildId) ?? null;

  // ── Timeline bar (ONE selection drives every card) ─────────────────
  const [period, setPeriod] = useState<PeriodKey>('thisWeek');
  const [moreOpen, setMoreOpen] = useState(false);
  const [monthKey, setMonthKey] = useState(() => iso(new Date()).slice(0, 7));
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const range = useMemo(() => rangeFor(period, monthKey, customFrom, customTo), [period, monthKey, customFrom, customTo]);

  // ── Data ───────────────────────────────────────────────────────────
  const [ratings, setRatings] = useState<DailyRating[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [prevHP, setPrevHP] = useState<number | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  // PR2 — behaviour detail + reflections + ⚖️ Compare
  const [openBehaviour, setOpenBehaviour] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null); // ratingId key
  const [reflectDraft, setReflectDraft] = useState('');
  const [reflectBusy, setReflectBusy] = useState(false);
  const [reflectMsg, setReflectMsg] = useState('');
  const [discTab, setDiscTab] = useState<'awards' | 'routine'>('awards');
  const [patternAwards, setPatternAwards] = useState<Award[]>([]);
  const [compare, setCompare] = useState<null | 'week' | 'month' | 'months'>(null);
  const [cmpA, setCmpA] = useState(() => iso(new Date()).slice(0, 7));
  const [cmpB, setCmpB] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return iso(d).slice(0, 7); });
  const [cmpData, setCmpData] = useState<null | { a: ReturnType<typeof snapshot>; b: ReturnType<typeof snapshot>; aLabel: string; bLabel: string }>(null);

  const ppHP = Math.max(1, readPointSystemConfig(family).routines.pointsPerHousePoint || 100);

  useEffect(() => {
    if (!familyId || !myChildId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [rs, aws, ms] = await Promise.all([
        getRatingsInDateRange(familyId, range.from, range.to).catch(() => [] as DailyRating[]),
        getAwardsInDateRange(familyId, range.from, range.to).catch(() => [] as Award[]),
        getMeetings(familyId).catch(() => [] as Meeting[]),
      ]);
      if (cancelled) return;
      setRatings(rs.filter((r) => r.childId === myChildId));
      setAwards(aws.filter((a) => a.childId === myChildId));
      setMeetings(ms);
      // Previous equal period → ▲/▼ (skipped for lifetime).
      const prev = prevRange(range.from, range.to);
      if (prev) {
        const [prs, paws] = await Promise.all([
          getRatingsInDateRange(familyId, prev.from, prev.to).catch(() => [] as DailyRating[]),
          getAwardsInDateRange(familyId, prev.from, prev.to).catch(() => [] as Award[]),
        ]);
        if (cancelled) return;
        const routinePts = prs.filter((r) => r.childId === myChildId).reduce((s, r) => s + (r.totalPoints || 0), 0);
        const awardPts = paws.filter((a) => a.childId === myChildId).reduce((s, a) => s + (a.points || 0), 0);
        setPrevHP(Math.floor(routinePts / ppHP) + awardPts);
      } else setPrevHP(null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, myChildId, range.from, range.to]);

  // 🔮 Pattern window — awards over the last 60 days regardless of the
  // selected view range, so weekday rhythms are detectable.
  useEffect(() => {
    if (!familyId || !myChildId) return;
    let cancelled = false;
    const from = new Date(); from.setDate(from.getDate() - 60);
    getAwardsInDateRange(familyId, iso(from), iso(new Date()))
      .then((aws) => { if (!cancelled) setPatternAwards(aws.filter((a) => a.childId === myChildId)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [familyId, myChildId]);

  // 🔮 Recurring award pattern: same category on the same weekday ≥3×.
  const pattern = useMemo(() => {
    const counts = new Map<string, { n: number; last: Date }>();
    patternAwards.forEach((a) => {
      const d = a.createdAt?.toDate?.();
      if (!d) return;
      const key = `${categoryKeyOf(a)}|${d.getDay()}`;
      const cur = counts.get(key) || { n: 0, last: d };
      counts.set(key, { n: cur.n + 1, last: d > cur.last ? d : cur.last });
    });
    let best: { catId: string; dow: number; n: number } | null = null;
    counts.forEach((v, k) => {
      if (v.n >= 3 && (!best || v.n > best.n)) {
        const [catId, dow] = k.split('|');
        best = { catId, dow: Number(dow), n: v.n };
      }
    });
    if (!best) return null;
    const b = best as { catId: string; dow: number; n: number };
    const cat = AWARD_CATEGORIES.find((c) => c.id === b.catId)!;
    const todayDow = new Date().getDay();
    const soon = b.dow === todayDow ? 'today' : b.dow === (todayDow + 1) % 7 ? 'tomorrow' : null;
    return { ...b, cat, dayName: WEEKDAYS[b.dow], soon };
  }, [patternAwards]);

  // Pattern nudge → the kid's own bell, once per upcoming occurrence.
  useEffect(() => {
    if (!pattern || !pattern.soon || !isKid || !familyId || !profile?.uid) return;
    const guard = `kayaPatternNudge:${myChildId}:${pattern.cat.id}:${iso(new Date()).slice(0, 10)}`;
    try {
      if (localStorage.getItem(guard)) return;
      localStorage.setItem(guard, '1');
    } catch { return; }
    void createNotification(familyId, {
      type: 'reminder',
      title: `🔮 Your ${pattern.cat.label} streak!`,
      message: `${pattern.n} ${pattern.dayName}s in a row you've been awarded for ${pattern.cat.label.toLowerCase()} — ${pattern.soon === 'today' ? "today's the day" : 'tomorrow is the day'}. Keep it going!`,
      read: false,
      forUserId: profile.uid,
      link: '/stats/me',
    } as Parameters<typeof createNotification>[1]);
  }, [pattern, isKid, familyId, profile?.uid, myChildId]);

  // ⚖️ Compare — fetch both windows with the SAME snapshot math.
  useEffect(() => {
    if (!familyId || !myChildId || !compare) { setCmpData(null); return; }
    let cancelled = false;
    (async () => {
      let a: { from: string; to: string; label: string };
      let b: { from: string; to: string; label: string };
      if (compare === 'week') {
        a = rangeFor('thisWeek', '', '', '');
        const p = prevRange(a.from, a.to)!;
        b = { ...p, label: 'Last week' };
      } else if (compare === 'month') {
        a = rangeFor('thisMonth', '', '', '');
        const d = new Date(); d.setMonth(d.getMonth() - 1);
        b = rangeFor('month', iso(d).slice(0, 7), '', '');
      } else {
        a = rangeFor('month', cmpA, '', '');
        b = rangeFor('month', cmpB, '', '');
      }
      const [ra, aa, rb, ab] = await Promise.all([
        getRatingsInDateRange(familyId, a.from, a.to).catch(() => [] as DailyRating[]),
        getAwardsInDateRange(familyId, a.from, a.to).catch(() => [] as Award[]),
        getRatingsInDateRange(familyId, b.from, b.to).catch(() => [] as DailyRating[]),
        getAwardsInDateRange(familyId, b.from, b.to).catch(() => [] as Award[]),
      ]);
      if (cancelled) return;
      setCmpData({
        a: snapshot(ra.filter((r) => r.childId === myChildId), aa.filter((x) => x.childId === myChildId), ppHP),
        b: snapshot(rb.filter((r) => r.childId === myChildId), ab.filter((x) => x.childId === myChildId), ppHP),
        aLabel: a.label, bLabel: b.label,
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, myChildId, compare, cmpA, cmpB, ppHP]);

  async function saveReflection(ratingId: string, routineId: string) {
    setReflectBusy(true); setReflectMsg('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/stats/reflection', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ratingId, routineId, text: reflectDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) setReflectMsg('🔒 This week already met — the record is frozen now.');
      else if (!res.ok) setReflectMsg('Could not save — try again.');
      else {
        setReflectMsg('✅ Saved — your family will see it at the meeting.');
        // Optimistic local update.
        setRatings((prev) => prev.map((r) => r.id === ratingId
          ? { ...r, reflections: { ...(r.reflections || {}), [routineId]: reflectDraft ? { text: reflectDraft, byUid: profile?.uid || '', byName: (profile?.displayName || 'Me').split(' ')[0], at: Date.now() } : null } }
          : r));
      }
    } catch { setReflectMsg('Could not save — try again.'); }
    finally { setReflectBusy(false); }
  }

  // ── Computations (mirror Reports + meeting review) ─────────────────
  const routines: Routine[] = (family?.routines?.length ? family.routines : DEFAULT_ROUTINES) as Routine[];

  const hp = useMemo(() => {
    const routinePts = ratings.reduce((s, r) => s + (r.totalPoints || 0), 0);
    const awardPts = awards.reduce((s, a) => s + (a.points || 0), 0);
    const routineHP = Math.floor(routinePts / ppHP);
    return { routineHP, awardPts, total: routineHP + awardPts, routinePts };
  }, [ratings, awards, ppHP]);

  const delta = prevHP !== null && prevHP > 0 ? Math.round(((hp.total - prevHP) / prevHP) * 100) : null;

  // Daily HP-contribution bars (≤31-day ranges, like Reports).
  const bars = useMemo(() => {
    const n = daysBetween(range.from, range.to);
    if (n > 31 || n < 2) return null;
    const byDay = new Map<string, number>();
    ratings.forEach((r) => byDay.set(r.date, (byDay.get(r.date) || 0) + (r.totalPoints || 0)));
    const out: { d: string; v: number }[] = [];
    const cur = new Date(`${range.from}T00:00:00`);
    for (let i = 0; i < n; i++) { const k = iso(cur); out.push({ d: k, v: byDay.get(k) || 0 }); cur.setDate(cur.getDate() + 1); }
    const max = Math.max(1, ...out.map((x) => x.v));
    return out.map((x) => ({ ...x, pct: Math.round((x.v / max) * 100) }));
  }, [ratings, range.from, range.to]);

  // Per-behaviour Excellent % (mirror of the meeting BehaviourTab math).
  const behaviours = useMemo(() => {
    const agg = new Map<string, { rated: number; excellent: number; good: number; bad: number }>();
    ratings.forEach((r) => {
      Object.entries(r.ratings || {}).forEach(([routineId, v]) => {
        if (v === 'skip') return;
        const a = agg.get(routineId) || { rated: 0, excellent: 0, good: 0, bad: 0 };
        a.rated += 1;
        if (v === 'excellent') a.excellent += 1;
        else if (v === 'good') a.good += 1;
        else a.bad += 1;
        agg.set(routineId, a);
      });
    });
    return routines
      .filter((rt) => agg.has(rt.id))
      .map((rt) => {
        const a = agg.get(rt.id)!;
        const pct = Math.round((a.excellent / a.rated) * 100);
        return { ...rt, ...a, pct };
      })
      .sort((x, y) => y.pct - x.pct);
  }, [ratings, routines]);

  // Belt & Ladder — perfect (Excellent) days + rungs of 5 + star podiums.
  const belt = useMemo(() => {
    const byDay = new Map<string, { rated: number; excellent: number }>();
    ratings.forEach((r) => {
      const a = byDay.get(r.date) || { rated: 0, excellent: 0 };
      Object.values(r.ratings || {}).forEach((v) => {
        if (v === 'skip') return;
        a.rated += 1;
        if (v === 'excellent') a.excellent += 1;
      });
      byDay.set(r.date, a);
    });
    let perfect = 0;
    byDay.forEach((a) => { if (a.rated > 0 && a.excellent === a.rated) perfect += 1; });
    const rung = perfect % 5;
    const stars = meetings.reduce((s, m) => {
      const me = m.pointsSummary?.kids?.find((k) => k.childId === myChildId);
      return s + (me?.stars ? 1 : 0);
    }, 0);
    return { perfect, rung, toNext: rung === 0 && perfect > 0 ? 0 : 5 - rung, stars };
  }, [ratings, meetings, myChildId]);

  const recentAwards = useMemo(() =>
    [...awards].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)).slice(0, 3),
  [awards]);

  const pctColor = (p: number) => (p >= 80 ? '#2E9E5B' : p >= 60 ? '#D4A017' : '#E06A7B');
  const kindEmoji = (a: Award) => {
    const k = a.kind || inferAwardKind(a);
    return k === 'diamond' ? '💎' : k === 'kudos' ? '💛' : k === 'reducing' ? '⚠️' : k === 'improvement_note' ? '☝️' : '⭐';
  };

  if (!familyId) return null;
  if (!kid) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <div className="text-3xl mb-2">📊</div>
        <p className="text-kaya-sand text-sm">No kid profile found for this account yet.</p>
      </div>
    );
  }

  const first = kid.name.split(' ')[0];

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-5xl px-4 lg:px-8 pt-4 lg:pt-8 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-full bg-kaya-warm grid place-items-center text-2xl">{kid.avatarEmoji}</div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl lg:text-2xl font-black leading-tight">My Stats</h1>
          <p className="text-[12px] text-kaya-sand font-bold">{kid.name} · {kid.houseName}</p>
        </div>
        {!isKid && children.length > 1 && (
          <select
            value={myChildId ?? ''}
            onChange={(e) => setPickedId(e.target.value)}
            className="text-[12.5px] font-bold border border-kaya-warm-dark rounded-kaya-sm px-2.5 py-2 bg-white"
            aria-label="Choose a kid"
          >
            {children.map((c) => <option key={c.id} value={c.id}>{c.avatarEmoji} {c.name}</option>)}
          </select>
        )}
      </div>

      {/* Timeline bar — one selection drives EVERY card */}
      <div className="flex gap-1.5 flex-wrap items-center mb-1">
        {([['thisWeek', 'This week'], ['thisMonth', 'This month']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setPeriod(k); setMoreOpen(false); }}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-display font-extrabold transition-colors ${period === k ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'}`}>
            {l}
          </button>
        ))}
        {!['thisWeek', 'thisMonth'].includes(period) && (
          <span className="px-3.5 py-1.5 rounded-full text-[12px] font-display font-extrabold bg-kaya-chocolate text-white">{range.label}</span>
        )}
        <button type="button" onClick={() => { setCompare((c) => (c ? null : 'week')); setMoreOpen(false); }}
          className={`px-3.5 py-1.5 rounded-full text-[12px] font-display font-extrabold transition-colors ${compare ? 'text-white' : ''}`}
          style={compare ? { background: '#6B3FE0' } : { background: '#EFE9FF', color: '#6B3FE0' }}>
          ⚖️ Compare
        </button>
        <button type="button" onClick={() => setMoreOpen((v) => !v)}
          className="px-3.5 py-1.5 rounded-full text-[12px] font-display font-extrabold bg-white border-[1.5px] border-dashed border-kaya-warm-dark text-kaya-sand">
          More ▾
        </button>
      </div>

      {/* ⚖️ Compare mode */}
      {compare && (
        <div className="bg-white border-[1.5px] rounded-kaya-lg p-4 mb-3" style={{ borderColor: '#D9C6F7' }}>
          <div className="flex gap-1.5 flex-wrap items-center mb-2.5">
            {([['week', 'This week vs last'], ['month', 'This month vs last']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setCompare(k)}
                className={`px-3 py-1.5 rounded-full text-[11.5px] font-bold ${compare === k ? 'text-white' : 'text-kaya-sand bg-kaya-warm'}`}
                style={compare === k ? { background: '#6B3FE0' } : undefined}>
                {l}
              </button>
            ))}
            <button type="button" onClick={() => setCompare('months')}
              className={`px-3 py-1.5 rounded-full text-[11.5px] font-bold ${compare === 'months' ? 'text-white' : 'text-kaya-sand bg-kaya-warm'}`}
              style={compare === 'months' ? { background: '#6B3FE0' } : undefined}>
              Month vs month
            </button>
            {compare === 'months' && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-kaya-sand">
                <input type="month" value={cmpA} onChange={(e) => setCmpA(e.target.value)} className="border border-kaya-warm-dark rounded-kaya-sm px-1.5 py-1 bg-white text-[11.5px]" />
                vs
                <input type="month" value={cmpB} onChange={(e) => setCmpB(e.target.value)} className="border border-kaya-warm-dark rounded-kaya-sm px-1.5 py-1 bg-white text-[11.5px]" />
              </span>
            )}
          </div>
          {!cmpData ? (
            <p className="text-[12px] text-kaya-sand animate-pulse">Comparing…</p>
          ) : (() => {
            const rows: Array<{ icon: string; label: string; a: string; b: string; delta: number }> = [
              { icon: '⭐', label: 'House Points', a: `${cmpData.a.hp}`, b: `${cmpData.b.hp}`, delta: cmpData.a.hp - cmpData.b.hp },
              { icon: '🥋', label: 'Excellent days', a: `${cmpData.a.perfect}`, b: `${cmpData.b.perfect}`, delta: cmpData.a.perfect - cmpData.b.perfect },
              ...routines
                .filter((rt) => cmpData.a.per.has(rt.id) || cmpData.b.per.has(rt.id))
                .map((rt) => {
                  const A = cmpData.a.per.get(rt.id); const B = cmpData.b.per.get(rt.id);
                  const pa = A ? Math.round((A.excellent / A.rated) * 100) : 0;
                  const pb = B ? Math.round((B.excellent / B.rated) * 100) : 0;
                  return { icon: rt.icon, label: rt.label, a: `${pa}%`, b: `${pb}%`, delta: pa - pb };
                }),
            ];
            const beh = rows.slice(2);
            const win = beh.length ? beh.reduce((m, r) => (r.delta > m.delta ? r : m)) : null;
            const watch = beh.length ? beh.reduce((m, r) => (r.delta < m.delta ? r : m)) : null;
            return (
              <>
                <p className="text-[11px] font-black text-kaya-sand mb-1.5">{cmpData.aLabel} <span className="opacity-60">vs</span> {cmpData.bLabel}</p>
                {rows.map((r) => (
                  <div key={r.label} className="flex items-center gap-2 py-1 border-b border-dashed border-kaya-warm last:border-b-0">
                    <span className="text-[13px]">{r.icon}</span>
                    <span className="flex-1 text-[12.5px] font-bold truncate">{r.label}</span>
                    <span className="text-[12px] font-black" style={{ color: r.delta > 0 ? '#2E9E5B' : r.delta < 0 ? '#E06A7B' : '#9B8A72' }}>
                      {r.a} vs {r.b} · {r.delta > 0 ? '▲' : r.delta < 0 ? '▼' : '·'} {Math.abs(r.delta)}{r.label === 'House Points' || r.label === 'Excellent days' ? '' : ''}
                    </span>
                  </div>
                ))}
                {(win || watch) && (
                  <p className="text-[12px] mt-2 rounded-kaya px-3 py-2" style={{ background: '#E8F5EC', color: '#1d6b3c' }}>
                    {win && win.delta > 0 ? <><b>📈 Biggest win:</b> {win.label}. </> : null}
                    {watch && watch.delta < 0 ? <span style={{ color: '#B4485A' }}><b>📉 Watch:</b> {watch.label} slipped.</span> : null}
                  </p>
                )}
              </>
            );
          })()}
        </div>
      )}
      {moreOpen && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-3 mb-3 flex gap-1.5 flex-wrap items-center">
          {([['last7', 'Last 7 days'], ['thisYear', 'This year'], ['lifetime', 'Lifetime']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => { setPeriod(k); setMoreOpen(false); }}
              className={`px-3 py-1.5 rounded-full text-[12px] font-bold ${period === k ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'}`}>
              {l}
            </button>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-kaya-sand">
            📅 <input type="month" value={monthKey} max={iso(new Date()).slice(0, 7)}
              onChange={(e) => { setMonthKey(e.target.value); setPeriod('month'); }}
              className="border border-kaya-warm-dark rounded-kaya-sm px-2 py-1 bg-white text-[12px] font-bold" />
          </span>
          <span className="inline-flex items-center gap-1 text-[12px] font-bold text-kaya-sand">
            🗓 <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-kaya-warm-dark rounded-kaya-sm px-2 py-1 bg-white text-[12px]" />
            –
            <input type="date" value={customTo} onChange={(e) => { setCustomTo(e.target.value); if (customFrom) setPeriod('custom'); }}
              className="border border-kaya-warm-dark rounded-kaya-sm px-2 py-1 bg-white text-[12px]" />
          </span>
        </div>
      )}
      <p className="text-[10.5px] text-kaya-sand font-bold mb-3">{range.label} · {toDisplayDate(range.from)} – {toDisplayDate(range.to)}</p>

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-28 rounded-kaya-lg bg-kaya-warm" />
          <div className="h-40 rounded-kaya-lg bg-kaya-warm" />
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-3 lg:gap-4 lg:items-start space-y-3 lg:space-y-0">
          {/* ⭐ HP hero */}
          <div className="rounded-kaya-lg p-4 text-white" style={{ background: 'linear-gradient(130deg,#6B3FE0,#9b6bff)' }}>
            <p className="text-[10px] uppercase tracking-[0.14em] font-bold opacity-85">⭐ My House Points · {range.label.toLowerCase()}</p>
            <p className="font-display font-black text-4xl leading-tight mt-1">{hp.total} HP</p>
            <div className="flex gap-5 mt-2">
              <span><span className="font-black text-[15px]">{hp.routineHP}</span><br /><span className="text-[9.5px] uppercase tracking-wider opacity-75 font-bold">Routines</span></span>
              <span><span className="font-black text-[15px]">{hp.awardPts}</span><br /><span className="text-[9.5px] uppercase tracking-wider opacity-75 font-bold">Awards</span></span>
              {delta !== null && (
                <span><span className="font-black text-[15px]">{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%</span><br /><span className="text-[9.5px] uppercase tracking-wider opacity-75 font-bold">vs previous</span></span>
              )}
            </div>
            {bars && (
              <div className="flex items-end gap-[3px] h-11 mt-3" aria-label="Daily points">
                {bars.map((b) => (
                  <span key={b.d} title={`${toDisplayDate(b.d)} · ${b.v} pts`} className="flex-1 rounded-t-[3px]"
                    style={{ height: `${Math.max(6, b.pct)}%`, background: b.pct === 100 ? '#FFD76A' : 'rgba(255,255,255,.4)' }} />
                ))}
              </div>
            )}
          </div>

          {/* 😇 Behaviours */}
          <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-2.5">😇 My behaviours · {range.label.toLowerCase()}</p>
            {behaviours.length === 0 ? (
              <p className="text-[12.5px] text-kaya-sand">No ratings in this period yet.</p>
            ) : behaviours.map((b) => {
              const open = openBehaviour === b.id;
              const days = ratings
                .filter((r) => r.ratings?.[b.id] && r.ratings[b.id] !== 'skip')
                .sort((x, y) => x.date.localeCompare(y.date))
                .map((r) => ({
                  ratingId: r.id, date: r.date, value: r.ratings[b.id],
                  ratedByName: r.ratedByName,
                  note: r.ratingNotes?.[b.id] || r.comment || '',
                  reflection: r.reflections?.[b.id] || null,
                }));
              const dotColor = (v: string) => (v === 'excellent' ? '#2E9E5B' : v === 'good' ? '#D4A017' : '#E06A7B');
              const sel = days.find((d) => d.ratingId === openDay);
              return (
                <div key={b.id} className="border-b border-dashed border-kaya-warm last:border-b-0">
                  <button type="button" className="w-full flex items-center gap-2.5 py-1.5 text-left"
                    onClick={() => { setOpenBehaviour(open ? null : b.id); setOpenDay(null); setReflectMsg(''); }}>
                    <span className="w-7 h-7 rounded-lg bg-kaya-warm grid place-items-center text-[14px] shrink-0">{b.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-bold truncate">{b.label}</p>
                      <div className="h-[6px] rounded-full bg-kaya-warm overflow-hidden mt-0.5">
                        <span className="block h-full rounded-full" style={{ width: `${b.pct}%`, background: pctColor(b.pct) }} />
                      </div>
                    </div>
                    <span className="text-[12px] font-black shrink-0" style={{ color: pctColor(b.pct) }}>
                      {b.pct}%{b.pct >= 90 ? ' ⭐' : b.pct < 60 ? ' 🌱' : ''}
                    </span>
                    <span className="text-[11px] font-black text-kaya-sand shrink-0">{open ? '▾' : '›'}</span>
                  </button>
                  {open && (
                    <div className="pb-2.5 pl-9">
                      <div className="flex flex-wrap gap-[3px]" aria-label="Rated days — tap one">
                        {days.map((d) => (
                          <button key={d.ratingId} type="button" title={toDisplayDate(d.date)}
                            onClick={() => { setOpenDay(openDay === d.ratingId ? null : d.ratingId); setReflectDraft(d.reflection?.text || ''); setReflectMsg(''); }}
                            className={`w-4 h-4 rounded-[4px] ${openDay === d.ratingId ? 'ring-2 ring-kaya-chocolate' : ''}`}
                            style={{ background: dotColor(d.value) }} />
                        ))}
                      </div>
                      {sel && (
                        <div className="mt-2 rounded-kaya border p-2.5" style={{ borderColor: sel.value === 'bad' ? '#F5D3D9' : '#E8E0D4' }}>
                          <p className="text-[11px] font-black" style={{ color: dotColor(sel.value) }}>
                            {sel.value === 'excellent' ? '🟢 Excellent' : sel.value === 'good' ? '🟡 Good' : '🔴 Bad'} · {toDisplayDate(sel.date)} · rated by {sel.ratedByName}
                          </p>
                          {sel.note && <p className="text-[12px] mt-1">“{sel.note}”</p>}
                          <div className="mt-1.5 rounded-kaya-sm p-2" style={{ background: '#EFE9FF' }}>
                            <p className="text-[9.5px] font-black uppercase tracking-wider" style={{ color: '#6B3FE0' }}>💬 My reflection</p>
                            <textarea value={reflectDraft} onChange={(e) => setReflectDraft(e.target.value)} rows={2}
                              placeholder="What happened? What will you try next time?"
                              className="w-full mt-1 rounded-kaya-sm border border-kaya-warm-dark px-2 py-1.5 text-[12px] resize-none bg-white" />
                            <div className="flex items-center gap-2 mt-1">
                              <button type="button" disabled={reflectBusy} onClick={() => void saveReflection(sel.ratingId, b.id)}
                                className="px-3.5 py-1.5 rounded-full text-[11px] font-black text-white disabled:opacity-50" style={{ background: '#6B3FE0' }}>
                                {reflectBusy ? 'Saving…' : 'Save reflection'}
                              </button>
                              {reflectMsg && <span className="text-[10.5px] font-bold text-kaya-sand">{reflectMsg}</span>}
                            </div>
                            <p className="text-[9.5px] text-kaya-sand mt-1">Shows here, at the Sunday meeting and in Reports — freezes once the week has met.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-[10px] text-kaya-sand mt-2">🌱 = needs love — same scores your family sees at the Sunday meeting, live.</p>
          </div>

          <div className="space-y-3">
            {/* 🥋 Belt & Ladder */}
            <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-2">🥋 My Belt &amp; Ladder</p>
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 rounded-kaya grid place-items-center text-2xl" style={{ background: '#FFF3D0' }}>🥋</span>
                <div className="flex-1">
                  <p className="font-display font-extrabold text-[14px]">{belt.perfect} Excellent day{belt.perfect === 1 ? '' : 's'}</p>
                  <div className="flex gap-1 mt-1.5">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} className="flex-1 h-2 rounded-full" style={{ background: i < belt.rung || (belt.rung === 0 && belt.perfect > 0) ? '#D4A017' : '#F0EBE3' }} />
                    ))}
                  </div>
                  <p className="text-[10.5px] text-kaya-sand font-bold mt-1">
                    {belt.rung === 0 && belt.perfect > 0 ? 'Rung complete — new rung starts!' : `${belt.toNext} more Excellent day${belt.toNext === 1 ? '' : 's'} → next rung`}
                    {belt.stars > 0 ? ` · ⭐ Star podium ${belt.stars}×` : ''}
                  </p>
                </div>
              </div>
            </div>

            {/* 🏅 Recent awards strip (full Discovery in PR 3) */}
            <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-2">🏅 Latest awards · {range.label.toLowerCase()}</p>
              {recentAwards.length === 0 ? (
                <p className="text-[12.5px] text-kaya-sand">No awards in this period — keep shining, {first}! ✨</p>
              ) : recentAwards.map((a) => (
                <div key={a.id} className="py-1.5 border-b border-dashed border-kaya-warm last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12.5px] font-bold truncate">{kindEmoji(a)} {a.points ? `${a.points > 0 ? '+' : ''}${a.points} HP` : 'Kudos'} · {(a.category || '').replace('diamond-', '')}</p>
                    <span className="text-[10px] text-kaya-sand font-bold shrink-0">{a.createdAt?.toDate ? toDisplayDate(iso(a.createdAt.toDate())) : ''}</span>
                  </div>
                  {a.reason && <p className="text-[11.5px] italic text-kaya-sand truncate">“{a.reason}” — {a.awardedByName}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* 🧭 Points Discovery — Awards & Kudos FIRST (PR 3) */}
          <div className="lg:col-span-3 bg-white border border-kaya-warm-dark rounded-kaya-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand flex-1">🧭 Points Discovery · {range.label.toLowerCase()}</p>
              {([['awards', '🏅 Awards & Kudos'], ['routine', '⭐ Routine Points']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setDiscTab(k)}
                  className={`px-3 py-1.5 rounded-full text-[11.5px] font-display font-extrabold ${discTab === k ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'}`}>
                  {l}
                </button>
              ))}
            </div>

            {discTab === 'awards' ? (() => {
              const byCat = new Map<string, { n: number; hp: number }>();
              awards.forEach((a) => {
                const k = categoryKeyOf(a);
                const cur = byCat.get(k) || { n: 0, hp: 0 };
                byCat.set(k, { n: cur.n + 1, hp: cur.hp + Math.max(0, a.points || 0) });
              });
              const missing = AWARD_CATEGORIES.filter((c) => !(byCat.get(c.id)?.n)).length;
              const maxHp = Math.max(1, ...Array.from(byCat.values()).map((v) => v.hp));
              const top = AWARD_CATEGORIES.map((c) => ({ c, ...(byCat.get(c.id) || { n: 0, hp: 0 }) })).sort((a, b) => b.n - a.n)[0];
              const kudos = awards.filter((a) => (a.kind || inferAwardKind(a)) === 'kudos');
              const kudosFrom = kudos.length
                ? Object.entries(kudos.reduce((m, a) => { m[a.awardedByName] = (m[a.awardedByName] || 0) + 1; return m; }, {} as Record<string, number>)).sort((x, y) => y[1] - x[1])[0]
                : null;
              const feed = [...awards].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)).slice(0, 6);
              return (
                <div className="lg:grid lg:grid-cols-2 lg:gap-4 space-y-3 lg:space-y-0">
                  <div>
                    <p className="text-[10.5px] font-black text-kaya-sand mb-1.5">🗺️ MY AWARD BOARD — all 8, zeroes included</p>
                    {AWARD_CATEGORIES.map((c) => {
                      const v = byCat.get(c.id) || { n: 0, hp: 0 };
                      const empty = v.n === 0;
                      return (
                        <div key={c.id} className={`flex items-center gap-2 py-1 border-b border-dashed border-kaya-warm last:border-b-0 ${empty ? 'opacity-80' : ''}`}>
                          <span className="w-6 h-6 rounded-lg bg-kaya-warm grid place-items-center text-[13px] shrink-0">{c.emoji}</span>
                          <span className="flex-1 text-[12.5px] font-bold truncate">{c.label}</span>
                          {!empty && (
                            <span className="w-16 h-[6px] rounded-full bg-kaya-warm overflow-hidden shrink-0">
                              <span className="block h-full rounded-full" style={{ width: `${Math.round((v.hp / maxHp) * 100)}%`, background: '#D4A017' }} />
                            </span>
                          )}
                          <span className="text-[11.5px] font-black shrink-0" style={{ color: empty ? '#E06A7B' : '#1E120B' }}>
                            {empty ? (c.id === 'other' ? '0' : '0 · try me!') : `${v.n}× · ${v.hp} HP`}
                          </span>
                        </div>
                      );
                    })}
                    {missing > 0 && (
                      <p className="text-[11.5px] font-bold rounded-kaya px-3 py-2 mt-2" style={{ background: '#EFE9FF', color: '#6B3FE0' }}>
                        {missing} categor{missing === 1 ? 'y' : 'ies'} to unlock — earn one award in each and complete your board! 🏆
                      </p>
                    )}
                  </div>
                  <div>
                    {pattern && (
                      <div className="rounded-kaya px-3 py-2.5 mb-2.5" style={{ background: '#E2F7F3' }}>
                        <p className="text-[9.5px] font-black uppercase tracking-wider" style={{ color: '#11A08A' }}>🔮 Kaya spotted a pattern</p>
                        <p className="text-[12px] mt-0.5">
                          <b>{pattern.n} {pattern.dayName}s</b> you&rsquo;ve been awarded for {pattern.cat.emoji} {pattern.cat.label.toLowerCase()}.
                          {pattern.soon ? <b> {pattern.soon === 'today' ? " Today's the day — keep the streak!" : ' Tomorrow is the day — keep the streak!'}</b> : ' A rhythm worth keeping!'}
                        </p>
                      </div>
                    )}
                    <div className="flex gap-2 mb-2.5">
                      {top && top.n > 0 && (
                        <div className="flex-1 rounded-kaya px-3 py-2" style={{ background: '#E8F5EC' }}>
                          <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: '#1d6b3c' }}>🏅 Most awarded</p>
                          <p className="text-[11.5px] font-bold mt-0.5">{top.c.emoji} {top.c.label} · {top.n}×</p>
                        </div>
                      )}
                      <div className="flex-1 rounded-kaya px-3 py-2" style={{ background: '#EFE9FF' }}>
                        <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: '#6B3FE0' }}>💛 Kudos</p>
                        <p className="text-[11.5px] font-bold mt-0.5">{kudos.length} received{kudosFrom ? ` · ${kudosFrom[1]} from ${kudosFrom[0].split(' ')[0]}` : ''}</p>
                      </div>
                    </div>
                    <p className="text-[10.5px] font-black text-kaya-sand mb-1">📜 EVERY AWARD, IN YOUR FAMILY&rsquo;S WORDS</p>
                    {feed.length === 0 ? (
                      <p className="text-[12px] text-kaya-sand">No awards this period yet — your board is waiting! ✨</p>
                    ) : feed.map((a) => (
                      <div key={a.id} className="py-1.5 border-b border-dashed border-kaya-warm last:border-b-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-bold truncate">
                            {AWARD_CATEGORIES.find((c) => c.id === categoryKeyOf(a))?.emoji} {AWARD_CATEGORIES.find((c) => c.id === categoryKeyOf(a))?.label} · {kindEmoji(a)} {a.points ? `${a.points > 0 ? '+' : ''}${a.points}` : 'Kudos'}
                          </p>
                          <span className="text-[10px] text-kaya-sand font-bold shrink-0">{a.createdAt?.toDate ? toDisplayDate(iso(a.createdAt.toDate())) : ''}</span>
                        </div>
                        {a.reason && <p className="text-[11.5px] italic text-kaya-sand">&ldquo;{a.reason}&rdquo; — {a.awardedByName}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })() : (() => {
              const byRoutine = new Map<string, number>();
              ratings.forEach((r) => {
                Object.entries(r.ratings || {}).forEach(([rid, v]) => {
                  if (v === 'skip') return;
                  const rt = routines.find((x) => x.id === rid);
                  if (!rt) return;
                  const pts = v === 'excellent' ? rt.pointsExcellent : v === 'good' ? rt.pointsGood : rt.pointsBad;
                  byRoutine.set(rid, (byRoutine.get(rid) || 0) + (pts || 0));
                });
              });
              const rows = routines.filter((rt) => byRoutine.has(rt.id))
                .map((rt) => ({ rt, pts: byRoutine.get(rt.id) || 0 }))
                .sort((a, b) => b.pts - a.pts);
              const maxPts = Math.max(1, ...rows.map((r) => r.pts));
              const consistent = behaviours.length ? [...behaviours].sort((a, b) => (b.excellent / b.rated) - (a.excellent / a.rated))[0] : null;
              const opportunity = behaviours.length ? [...behaviours].sort((a, b) => a.pct - b.pct)[0] : null;
              const oppMissed = opportunity ? Math.round(((opportunity.rated - opportunity.excellent) * 2) / ppHP * 100) / 100 : 0;
              return (
                <div className="lg:grid lg:grid-cols-2 lg:gap-4 space-y-3 lg:space-y-0">
                  <div>
                    <p className="text-[10.5px] font-black text-kaya-sand mb-1.5">⭐ WHERE MY ROUTINE POINTS CAME FROM</p>
                    {rows.length === 0 ? <p className="text-[12px] text-kaya-sand">No ratings this period yet.</p> : rows.map(({ rt, pts }) => (
                      <div key={rt.id} className="flex items-center gap-2 py-1 border-b border-dashed border-kaya-warm last:border-b-0">
                        <span className="w-6 h-6 rounded-lg bg-kaya-warm grid place-items-center text-[13px] shrink-0">{rt.icon}</span>
                        <span className="flex-1 text-[12.5px] font-bold truncate">{rt.label}</span>
                        <span className="w-20 h-[6px] rounded-full bg-kaya-warm overflow-hidden shrink-0">
                          <span className="block h-full rounded-full" style={{ width: `${Math.round((pts / maxPts) * 100)}%`, background: '#6B3FE0' }} />
                        </span>
                        <span className="text-[11.5px] font-black shrink-0">{pts} pts</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {rows[0] && (
                      <div className="rounded-kaya px-3 py-2" style={{ background: '#E8F5EC' }}>
                        <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: '#1d6b3c' }}>🏆 Top earner</p>
                        <p className="text-[12px] font-bold mt-0.5">{rows[0].rt.icon} {rows[0].rt.label} · {rows[0].pts} pts</p>
                      </div>
                    )}
                    {consistent && (
                      <div className="rounded-kaya px-3 py-2" style={{ background: '#E2F7F3' }}>
                        <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: '#11A08A' }}>🎯 Most consistent</p>
                        <p className="text-[12px] font-bold mt-0.5">{consistent.icon} {consistent.label} · {consistent.excellent}/{consistent.rated} days</p>
                      </div>
                    )}
                    {opportunity && opportunity.pct < 80 && (
                      <div className="rounded-kaya px-3 py-2" style={{ background: '#FDF2F4' }}>
                        <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: '#B4485A' }}>📉 Biggest opportunity</p>
                        <p className="text-[12px] mt-0.5">{opportunity.icon} <b>{opportunity.label}</b> left ~<b>{oppMissed} HP</b> unclaimed — the single biggest place your effort pays.</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
