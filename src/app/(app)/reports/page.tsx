'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getRecentRatings, getRecentAwards, DailyRating, Award } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const fmt = (n: number) => n.toLocaleString('en-US');

// ── Date filter ────────────────────────────────────────────────────────
// The reports page anchors family meeting reviews. Default to Lifetime
// (full balance, matches headline `totalPoints`); presets cover the
// Sunday-meeting cadence (7/14/30 days); Month + Custom let parents pull
// any specific window.
type RangeMode = 'lifetime' | 'preset7' | 'preset14' | 'preset30' | 'month' | 'custom';

function todayStr(): string { return new Date().toISOString().slice(0, 10); }
function subDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function monthEnd(monthKey: string): string {
  // monthKey 'YYYY-MM' → last day of that month
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00').getTime();
  const b = new Date(to   + 'T00:00:00').getTime();
  return Math.max(0, Math.round((b - a) / 86400_000));
}
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
// Last 12 months as `[{key, label}]`, newest first — backs the month dropdown.
function lastTwelveMonths(): Array<{ key: string; label: string }> {
  const now = new Date();
  const out: Array<{ key: string; label: string }> = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: monthLabel(key) });
  }
  return out;
}

export default function ReportsPage() {
  const { profile } = useAuth();
  const { children } = useFamily();
  const [ratings, setRatings] = useState<DailyRating[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [mode, setMode] = useState<RangeMode>('lifetime');
  const [monthKey, setMonthKey] = useState<string>(() => todayStr().slice(0, 7));
  const [customFrom, setCustomFrom] = useState<string>(subDays(todayStr(), 7));
  const [customTo, setCustomTo] = useState<string>(todayStr());

  // Compute the active date window + a friendly label from the mode.
  const { from, to, label } = useMemo(() => {
    const t = todayStr();
    switch (mode) {
      case 'lifetime': return { from: '1970-01-01', to: t, label: 'Lifetime' };
      case 'preset7':  return { from: subDays(t, 6),  to: t, label: 'Last 7 days' };
      case 'preset14': return { from: subDays(t, 13), to: t, label: 'Last 14 days' };
      case 'preset30': return { from: subDays(t, 29), to: t, label: 'Last 30 days' };
      case 'month':    return { from: monthKey + '-01', to: monthEnd(monthKey), label: monthLabel(monthKey) };
      case 'custom':   return { from: customFrom || t, to: customTo || t, label: `${customFrom} → ${customTo}` };
    }
  }, [mode, monthKey, customFrom, customTo]);

  // How many days back to fetch. For Lifetime we ask for "everything" via
  // a very large number — Firestore's `where('date','>=','1970-…')`
  // returns the whole collection at the same cost as a tighter range.
  const daysToFetch = useMemo(() => {
    if (mode === 'lifetime') return 99999;
    return Math.max(7, daysBetween(from, todayStr()) + 1);
  }, [mode, from]);

  useEffect(() => {
    if (!profile?.familyId) return;
    Promise.all([
      getRecentRatings(profile.familyId, daysToFetch),
      getRecentAwards(profile.familyId, daysToFetch),
    ]).then(([r, a]) => { setRatings(r); setAwards(a); });
  }, [profile?.familyId, daysToFetch]);

  // Filter to the exact [from, to] window. The fetch may have pulled
  // extra rows (e.g. when the user toggles from Lifetime → 7 days the
  // fetch shrinks, but on a Month query we may still need a client-side
  // upper-bound trim).
  const ratingsInRange = useMemo(
    () => ratings.filter((r) => r.date >= from && r.date <= to),
    [ratings, from, to],
  );
  const awardsInRange = useMemo(
    () => awards.filter((a) => {
      const d = a.createdAt?.toDate?.()?.toISOString?.().slice(0, 10);
      return !!d && d >= from && d <= to;
    }),
    [awards, from, to],
  );

  // Daily bar chart only makes sense for tight windows. For Lifetime or
  // long ranges we still compute the totals but skip the bars.
  const spanDays = daysBetween(from, to) + 1;
  const showDailyBars = spanDays <= 31;
  const dateList = useMemo(() => {
    if (!showDailyBars) return [] as string[];
    return Array.from({ length: spanDays }, (_, i) => {
      const d = new Date(to + 'T00:00:00');
      d.setDate(d.getDate() - (spanDays - 1 - i));
      return d.toISOString().slice(0, 10);
    });
  }, [showDailyBars, spanDays, to]);

  const childStats = children.map((child) => {
    const childRatings = ratingsInRange.filter((r) => r.childId === child.id);
    const childAwards = awardsInRange.filter((a) => a.childId === child.id);
    const routinePoints = childRatings.reduce((s, r) => s + r.totalPoints, 0);
    const awardPoints = childAwards.reduce((s, a) => s + a.points, 0);
    const totalDays = new Set(childRatings.map((r) => r.date)).size;

    const dailyTotals = dateList.map((date) => {
      const r = childRatings.filter((x) => x.date === date).reduce((s, x) => s + x.totalPoints, 0);
      const a = childAwards.filter((x) => x.createdAt?.toDate?.()?.toISOString?.()?.slice(0, 10) === date)
        .reduce((s, x) => s + x.points, 0);
      return { date, routine: r, award: a, total: r + a };
    });
    const peakDay = Math.max(1, ...dailyTotals.map((d) => d.total));

    return {
      child, routinePoints, awardPoints, totalDays,
      total: routinePoints + awardPoints,
      dailyTotals, peakDay,
    };
  });

  // Ratings carrying any note — newest first. Includes both the
  // overall `comment` and the per-item `ratingNotes` introduced for
  // family-meeting context.
  const notedRatings = ratingsInRange
    .filter((r) => (r.comment || '').trim().length > 0 || hasItemNotes(r))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Family-level totals.
  const familyTotals = childStats.reduce(
    (acc, s) => ({
      total:   acc.total   + s.total,
      routine: acc.routine + s.routinePoints,
      award:   acc.award   + s.awardPoints,
      days:    Math.max(acc.days, s.totalDays),
    }),
    { total: 0, routine: 0, award: 0, days: 0 },
  );
  const top = [...childStats].sort((a, b) => b.total - a.total)[0];

  // ── Range picker (shared) ─────────────────────────────────
  // Two-row layout: top row mode chips, bottom row reveals dropdown /
  // date inputs when Month or Custom is active. Keeps mobile + desktop
  // markup unchanged below.
  const RangePicker = ({ size = 'sm' }: { size?: 'sm' | 'lg' }) => {
    const months = useMemo(() => lastTwelveMonths(), []);
    const baseBtn = size === 'lg' ? 'h-10 px-4 text-[13px]' : 'h-9 px-3 text-xs flex-1';
    const presets: Array<{ id: RangeMode; label: string }> = [
      { id: 'lifetime', label: 'Lifetime' },
      { id: 'preset7',  label: '7d' },
      { id: 'preset14', label: '14d' },
      { id: 'preset30', label: '30d' },
      { id: 'month',    label: 'Month' },
      { id: 'custom',   label: 'Custom' },
    ];
    return (
      <div className="flex flex-col gap-2 w-full">
        <div className="flex gap-1.5 flex-wrap">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => setMode(p.id)}
              className={`${baseBtn} rounded-kaya-sm font-semibold transition-colors ${
                mode === p.id ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'
              }`}
            >{p.label}</button>
          ))}
        </div>
        {mode === 'month' && (
          <select
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
            className="h-9 px-2 rounded-kaya-sm border border-kaya-warm-dark bg-white text-xs"
          >
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        )}
        {mode === 'custom' && (
          <div className="flex gap-2 items-center">
            <input
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="flex-1 h-9 px-2 rounded-kaya-sm border border-kaya-warm-dark bg-white text-xs"
            />
            <span className="text-xs text-kaya-sand">→</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              max={todayStr()}
              onChange={(e) => setCustomTo(e.target.value)}
              className="flex-1 h-9 px-2 rounded-kaya-sm border border-kaya-warm-dark bg-white text-xs"
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* ─────────────────────────────────────────────────────────── */}
      {/* MOBILE (< lg) — preserved                                    */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="lg:hidden mx-auto max-w-md w-full px-4 pt-4">
        <BackButton />
        <div className="mb-5">
          <h1 className="font-display text-2xl font-black">Reports</h1>
          <p className="text-kaya-sand text-sm">Performance insights</p>
        </div>

        <div className="mb-5"><RangePicker /></div>
        <p className="text-[11px] text-kaya-sand-light mb-3 -mt-2">Showing: <span className="font-semibold text-kaya-sand">{label}</span></p>

        {/* Hero — House points (Meeting-style, mobile compact) */}
        <div className="mb-5 bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-kaya-gold-light rounded-kaya-lg p-4 relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-kaya-gold/15 blur-2xl pointer-events-none" />
          <div className="relative flex items-center gap-3">
            <div className="text-3xl shrink-0" aria-hidden>🏆</div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] uppercase tracking-[0.16em] font-bold opacity-80">House points · {label}</p>
              <p className="font-display font-black text-4xl leading-none mt-1">{fmt(familyTotals.total)}</p>
            </div>
          </div>
          <div className="relative mt-3 pt-3 border-t border-white/15 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[9px] uppercase tracking-[0.12em] opacity-70 font-bold">Routine</p>
              <p className="font-display font-extrabold text-base mt-0.5">{fmt(familyTotals.routine)}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-[0.12em] opacity-70 font-bold">Awards</p>
              <p className="font-display font-extrabold text-base mt-0.5">{fmt(familyTotals.award)}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-[0.12em] opacity-70 font-bold">Days</p>
              <p className="font-display font-extrabold text-base mt-0.5">{familyTotals.days}<span className="text-[10px] opacity-70 ml-0.5">/{spanDays}</span></p>
            </div>
          </div>
          {top && top.total > 0 && (
            <p className="relative mt-3 text-[11px] opacity-85">
              <span className="opacity-70">Top this period: </span>
              <span className="font-bold">{top.child.avatarEmoji} {top.child.name} · {fmt(top.total)}</span>
            </p>
          )}
        </div>

        {childStats.map(({ child, routinePoints, awardPoints, totalDays, total }) => (
          <Link
            key={child.id}
            href={`/profiles?child=${child.id}`}
            className="block bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4 hover:border-kaya-chocolate active:bg-kaya-warm/30 transition-colors"
          >
            <div className="flex items-center gap-3 mb-3">
              <KidAvatar child={child} size="md" bgOpacity="20" />
              <div className="flex-1">
                <p className="font-bold text-sm">{child.name}</p>
                <p className="text-xs text-kaya-sand">{child.houseName}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-display font-black" style={{ color: child.houseColor }}>{fmt(total)}</p>
                <p className="text-[10px] text-kaya-sand">points earned</p>
              </div>
              <span className="text-kaya-sand-light text-lg shrink-0" aria-hidden>›</span>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                <p className="text-sm font-bold">{fmt(routinePoints)}</p>
                <p className="text-[10px] text-kaya-sand">Routine</p>
              </div>
              <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                <p className="text-sm font-bold">{fmt(awardPoints)}</p>
                <p className="text-[10px] text-kaya-sand">Awards</p>
              </div>
              <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                <p className="text-sm font-bold">{totalDays}</p>
                <p className="text-[10px] text-kaya-sand">Days Rated</p>
              </div>
            </div>

            <div className="h-2 bg-kaya-warm rounded-full overflow-hidden flex">
              {routinePoints > 0 && (
                <div className="h-full" style={{ width: `${(routinePoints / Math.max(total, 1)) * 100}%`, backgroundColor: child.houseColor }} />
              )}
              {awardPoints > 0 && (
                <div className="h-full bg-kaya-gold" style={{ width: `${(awardPoints / Math.max(total, 1)) * 100}%` }} />
              )}
            </div>
            <div className="flex gap-4 mt-1.5">
              <span className="flex items-center gap-1 text-[10px] text-kaya-sand">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: child.houseColor }} /> Routine
              </span>
              <span className="flex items-center gap-1 text-[10px] text-kaya-sand">
                <span className="w-2 h-2 rounded-full bg-kaya-gold" /> Awards
              </span>
            </div>
          </Link>
        ))}

        {notedRatings.length > 0 && (
          <NotesPanel notedRatings={notedRatings} children={children} />
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* DESKTOP (lg+) — family summary + grid + per-day bars         */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="hidden lg:block max-w-[1400px] w-full px-8 py-8">
        <div className="flex items-end justify-between gap-6 mb-7">
          <div>
            <h1 className="font-display text-[34px] leading-tight font-extrabold tracking-tight">Reports</h1>
            <p className="text-sm text-kaya-sand mt-1">Showing: <span className="font-semibold text-kaya-chocolate">{label}</span></p>
          </div>
          <div className="w-[440px]"><RangePicker size="lg" /></div>
        </div>

        {/* Hero — House points (Meeting-style: gradient primary + white companion) */}
        <div className="mb-8 flex items-stretch gap-3">
          <div className="flex-1 flex items-center gap-5 bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-kaya-gold-light rounded-kaya-lg p-6 relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-kaya-gold/15 blur-2xl pointer-events-none" />
            <div className="text-4xl shrink-0 relative" aria-hidden>🏆</div>
            <div className="flex-1 min-w-0 relative">
              <p className="text-[10px] uppercase tracking-[0.18em] font-bold opacity-80 mb-1">
                House points · {label}
              </p>
              <p className="font-display font-black text-5xl leading-none tracking-tight">{fmt(familyTotals.total)}</p>

              {/* Commentary — routine / awards / days as supporting stats */}
              <div className="mt-4 pt-4 border-t border-white/15 flex gap-8">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] opacity-70 font-bold">Routine</p>
                  <p className="font-display font-extrabold text-xl mt-0.5">{fmt(familyTotals.routine)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] opacity-70 font-bold">Awards</p>
                  <p className="font-display font-extrabold text-xl mt-0.5">{fmt(familyTotals.award)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] opacity-70 font-bold">Days rated</p>
                  <p className="font-display font-extrabold text-xl mt-0.5">
                    {familyTotals.days}<span className="text-sm opacity-70 font-semibold ml-1">/ {spanDays}</span>
                  </p>
                  <p className="text-[10px] opacity-70 mt-0.5">{Math.round((familyTotals.days / Math.max(1, spanDays)) * 100)}% coverage</p>
                </div>
              </div>
            </div>
          </div>

          {top && top.total > 0 && (
            <Link
              href={`/profiles?child=${top.child.id}`}
              className="shrink-0 w-56 flex flex-col items-center justify-center bg-white border border-kaya-warm-dark text-kaya-chocolate rounded-kaya-lg p-5 hover:border-kaya-chocolate hover:bg-kaya-warm transition-colors text-center"
            >
              <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-kaya-sand mb-2">Top this period</p>
              <div className="text-3xl mb-1" aria-hidden>{top.child.avatarEmoji}</div>
              <div className="font-display font-extrabold text-[15px] leading-tight">{top.child.name}</div>
              <div className="text-[11px] text-kaya-sand mt-0.5">{top.child.houseName} House</div>
              <div className="font-display font-black text-2xl mt-2" style={{ color: top.child.houseColor }}>{fmt(top.total)}</div>
              <div className="text-[10px] text-kaya-sand">points</div>
            </Link>
          )}
        </div>

        {/* Per-child cards with daily bars */}
        <h2 className="font-display text-base font-bold mb-3">Per child <span className="text-[11px] text-kaya-sand font-normal ml-1">· click for full profile</span></h2>
        <div className="grid grid-cols-3 gap-4 mb-8">
          {childStats.map(({ child, routinePoints, awardPoints, totalDays, total, dailyTotals, peakDay }) => (
            <Link
              key={child.id}
              href={`/profiles?child=${child.id}`}
              className="block bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5 hover:border-kaya-chocolate hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-3 mb-4">
                <KidAvatar child={child} size="lg" shape="square" />
                <div className="flex-1 min-w-0">
                  <p className="font-display font-bold text-lg truncate">{child.name}</p>
                  <p className="text-[11px] text-kaya-sand truncate">{child.houseName} House</p>
                </div>
                <div className="text-right">
                  <p className="font-display font-black text-2xl" style={{ color: child.houseColor }}>{fmt(total)}</p>
                  <p className="text-[10px] text-kaya-sand">earned</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                  <p className="text-sm font-bold">{fmt(routinePoints)}</p>
                  <p className="text-[10px] text-kaya-sand">Routine</p>
                </div>
                <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                  <p className="text-sm font-bold">{fmt(awardPoints)}</p>
                  <p className="text-[10px] text-kaya-sand">Awards</p>
                </div>
                <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                  <p className="text-sm font-bold">{totalDays}</p>
                  <p className="text-[10px] text-kaya-sand">Days</p>
                </div>
              </div>

              {/* Daily bars — only meaningful for short windows. For
                  Lifetime / Month / long Custom ranges the totals + the
                  Notes panel below carry the signal. */}
              {showDailyBars ? (
                <div>
                  <div className="flex items-end justify-between gap-1 h-20">
                    {dailyTotals.map((d) => {
                      const h = d.total > 0 ? Math.max(8, Math.round((d.total / peakDay) * 80)) : 2;
                      return (
                        <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.total} pts`}>
                          <div className="flex-1 w-full flex items-end">
                            <div
                              className="w-full rounded-sm transition-all"
                              style={{
                                height: `${h}px`,
                                backgroundColor: d.total > 0 ? child.houseColor : '#E8E0D4',
                                opacity: d.total > 0 ? 1 : 0.5,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-end justify-between gap-1 mt-1">
                    {dailyTotals.map((d, i) => {
                      const showLabel = spanDays <= 7 || i === 0 || i === dailyTotals.length - 1 || i === Math.floor(dailyTotals.length / 2);
                      const dayLabel = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
                      return (
                        <div key={d.date} className="flex-1 text-center">
                          {showLabel && <span className="text-[9px] text-kaya-sand-light font-semibold">{dayLabel.slice(0, 1)}</span>}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-kaya-sand-light mt-2">Daily total · {label}</p>
                </div>
              ) : (
                <p className="text-[10px] text-kaya-sand-light italic">Daily chart hidden for ranges over 31 days — switch to 7d / 14d / 30d to see bars.</p>
              )}

              {/* Routine vs award split bar */}
              <div className="mt-3">
                <div className="h-2 bg-kaya-warm rounded-full overflow-hidden flex">
                  {routinePoints > 0 && (
                    <div className="h-full" style={{ width: `${(routinePoints / Math.max(total, 1)) * 100}%`, backgroundColor: child.houseColor }} />
                  )}
                  {awardPoints > 0 && (
                    <div className="h-full bg-kaya-gold" style={{ width: `${(awardPoints / Math.max(total, 1)) * 100}%` }} />
                  )}
                </div>
                <div className="flex gap-4 mt-1.5">
                  <span className="flex items-center gap-1 text-[10px] text-kaya-sand">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: child.houseColor }} /> Routine
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-kaya-sand">
                    <span className="w-2 h-2 rounded-full bg-kaya-gold" /> Awards
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {notedRatings.length > 0 && (
          <div className="mt-8">
            <NotesPanel notedRatings={notedRatings} children={children} />
          </div>
        )}
      </div>
    </>
  );
}

// True if the rating carries any per-routine note (Bad reason / Excellent
// detail). Cheap helper used to decide if the row belongs in the Notes
// panel even when the overall `comment` is empty.
function hasItemNotes(r: DailyRating): boolean {
  if (!r.ratingNotes) return false;
  for (const v of Object.values(r.ratingNotes)) {
    if (v && v.trim().length > 0) return true;
  }
  return false;
}

// Recent ratings that carry a comment OR per-item notes. Both kinds are
// shown side by side so a family meeting can quickly scan for both
// "what went wrong" (Bad item notes) and "what stood out" (Excellent
// item notes), plus the overall period comment.
function NotesPanel({
  notedRatings, children,
}: {
  notedRatings: DailyRating[];
  children: ReturnType<typeof useFamily>['children'];
}) {
  const [childFilter, setChildFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'morning' | 'evening'>('all');
  const [toneFilter, setToneFilter] = useState<'all' | 'concern' | 'celebrate'>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notedRatings.filter((r) => {
      if (childFilter !== 'all' && r.childId !== childFilter) return false;
      if (periodFilter !== 'all' && r.period !== periodFilter) return false;
      if (toneFilter !== 'all') {
        const wantBad = toneFilter === 'concern';
        const hasMatch = Object.entries(r.ratingNotes || {}).some(([routineId, note]) => {
          if (!note || !note.trim()) return false;
          const rating = r.ratings?.[routineId];
          return wantBad ? rating === 'bad' : rating === 'excellent';
        });
        if (!hasMatch) return false;
      }
      if (q) {
        const inComment = (r.comment || '').toLowerCase().includes(q);
        const inNotes = Object.values(r.ratingNotes || {}).some((v) => (v || '').toLowerCase().includes(q));
        const childName = children.find((c) => c.id === r.childId)?.name?.toLowerCase() || '';
        if (!inComment && !inNotes && !childName.includes(q)) return false;
      }
      return true;
    });
  }, [notedRatings, childFilter, periodFilter, toneFilter, query, children]);

  const clearFilters = () => { setChildFilter('all'); setPeriodFilter('all'); setToneFilter('all'); setQuery(''); };
  const activeFilters = (childFilter !== 'all' ? 1 : 0) + (periodFilter !== 'all' ? 1 : 0) + (toneFilter !== 'all' ? 1 : 0) + (query ? 1 : 0);

  const chip = (active: boolean) =>
    `h-7 px-2.5 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap ${
      active ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand hover:bg-kaya-warm-dark'
    }`;

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">
          Notes &amp; comments <span className="text-kaya-sand-light">({filtered.length}{filtered.length !== notedRatings.length ? ` of ${notedRatings.length}` : ''})</span>
        </p>
        {activeFilters > 0 && (
          <button
            onClick={clearFilters}
            className="text-[11px] font-semibold text-kaya-sand hover:text-kaya-chocolate transition-colors"
          >Clear filters</button>
        )}
      </div>

      {/* Filter chips */}
      <div className="space-y-2 mb-3">
        {/* Child filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand-light shrink-0">Kid</span>
          <button onClick={() => setChildFilter('all')} className={chip(childFilter === 'all')}>All</button>
          {children.map((c) => (
            <button
              key={c.id}
              onClick={() => setChildFilter(c.id)}
              className={`${chip(childFilter === c.id)} flex items-center gap-1`}
            >
              <span aria-hidden>{c.avatarEmoji}</span>
              <span>{c.name}</span>
            </button>
          ))}
        </div>

        {/* Period + tone filter on one row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand-light shrink-0">Period</span>
          <button onClick={() => setPeriodFilter('all')} className={chip(periodFilter === 'all')}>All</button>
          <button onClick={() => setPeriodFilter('morning')} className={chip(periodFilter === 'morning')}>Morning</button>
          <button onClick={() => setPeriodFilter('evening')} className={chip(periodFilter === 'evening')}>Evening</button>

          <span className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand-light shrink-0 ml-2">Tone</span>
          <button onClick={() => setToneFilter('all')} className={chip(toneFilter === 'all')}>All</button>
          <button onClick={() => setToneFilter('concern')} className={chip(toneFilter === 'concern')}>🔴 Concerns</button>
          <button onClick={() => setToneFilter('celebrate')} className={chip(toneFilter === 'celebrate')}>🟢 Wins</button>
        </div>

        {/* Search */}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes…"
          className="w-full h-9 px-3 rounded-kaya-sm border border-kaya-warm-dark bg-white text-xs placeholder:text-kaya-sand-light focus:outline-none focus:border-kaya-chocolate"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8 text-[12px] text-kaya-sand-light">
          No notes match these filters.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 25).map((r) => {
            const c = children.find((k) => k.id === r.childId);
            const itemNoteEntries = Object.entries(r.ratingNotes || {}).filter(([, v]) => v && v.trim());
            return (
              <div key={r.id} className="border border-kaya-warm-dark/60 rounded-kaya-sm p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    {c && <KidAvatar child={c} size="xs" />}
                    <p className="text-[12px] font-bold truncate">{c?.name || '—'}</p>
                    <span className="text-[10px] text-kaya-sand">·</span>
                    <p className="text-[11px] text-kaya-sand capitalize">{r.period}</p>
                  </div>
                  <p className="text-[10px] font-mono text-kaya-sand-light shrink-0">{r.date}</p>
                </div>
                {r.comment && (
                  <p className="text-[12px] text-kaya-chocolate leading-snug whitespace-pre-wrap">{r.comment}</p>
                )}
                {itemNoteEntries.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {itemNoteEntries.map(([routineId, note]) => {
                      const rating = r.ratings?.[routineId];
                      const isBad = rating === 'bad';
                      const isGreat = rating === 'excellent';
                      const dot = isBad ? '🔴' : isGreat ? '🟢' : '⚪';
                      return (
                        <li key={routineId} className="text-[11px] leading-snug">
                          <span className="mr-1">{dot}</span>
                          <span className="font-semibold text-kaya-sand">{routineId}</span>
                          <span className="text-kaya-chocolate"> — {note}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      {filtered.length > 25 && (
        <p className="text-[11px] text-kaya-sand-light text-center mt-2">
          Showing 25 of {filtered.length} · narrow the filters above or widen the date range to refine.
        </p>
      )}
    </div>
  );
}
