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
import {
  getRatingsInDateRange, getAwardsInDateRange, getMeetings,
  readPointSystemConfig, inferAwardKind, DEFAULT_ROUTINES,
  type DailyRating, type Award, type Routine, type Meeting,
} from '@/lib/firestore';
import { toDisplayDate } from '@/lib/dates';

type PeriodKey = 'thisWeek' | 'thisMonth' | 'last7' | 'thisYear' | 'lifetime' | 'month' | 'custom';

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
        <button type="button" onClick={() => setMoreOpen((v) => !v)}
          className="px-3.5 py-1.5 rounded-full text-[12px] font-display font-extrabold bg-white border-[1.5px] border-dashed border-kaya-warm-dark text-kaya-sand">
          More ▾
        </button>
      </div>
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
            ) : behaviours.map((b) => (
              <div key={b.id} className="flex items-center gap-2.5 py-1.5 border-b border-dashed border-kaya-warm last:border-b-0">
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
              </div>
            ))}
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
        </div>
      )}
    </div>
  );
}
