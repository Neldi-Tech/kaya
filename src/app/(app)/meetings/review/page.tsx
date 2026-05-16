'use client';

// Family Meeting · Points Review (presenter mode).
//
// Full-screen presenter view designed to be cast or propped up during a
// weekly family meeting. Tabbed structure modelled on the reference UI
// Elia shared on 2026-05-16:
//   • Points    — leaderboard for the window
//   • Behaviour — comments helpers left when submitting ratings
//   • Ladder    — per-kid trophy grid of COMPLETE routines (countdown reveal)
//   • Belt      — single-day champion (most Excellents) with Excellent/Bad
//                 toggle and "Reveal Next" pagination
//
// Belt® and Ladder® concepts by Diella.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  DailyRating, Award, Child, Routine,
  getRatingsInDateRange, getAwardsInDateRange,
  giveAward, todayString, readPointSystemConfig,
  PointSystemConfig,
} from '@/lib/firestore';
import {
  computeReview, computeWindowRange, computeDayScores, topDays,
  computeLadderRows, extractComments, recentMonths,
  WindowKey, KidReviewStats, DayScore, LadderRow, CommentEntry,
} from '@/lib/meetingReview';
import { fmt } from '@/lib/format';

// Quick-pick chips. Months + Custom are not in this list — they're rendered
// as a dropdown + date-input pair next to the chips so the chip rail stays
// compact and doesn't explode to 18 buttons on mobile.
const WINDOW_QUICK_PICKS: { key: WindowKey; label: string; matches: (w: WindowKey) => boolean }[] = [
  { key: { kind: 'today' },    label: 'Today',         matches: (w) => w.kind === 'today' },
  { key: { kind: 'lifetime' }, label: 'Lifetime',      matches: (w) => w.kind === 'lifetime' },
  { key: { kind: 'last7' },    label: 'Last 7 days',   matches: (w) => w.kind === 'last7' },
  { key: { kind: 'last14' },   label: 'Last 14 days',  matches: (w) => w.kind === 'last14' },
  { key: { kind: 'mtd' },      label: 'This month',    matches: (w) => w.kind === 'mtd' },
];

type TabKey = 'points' | 'behaviour' | 'ladder' | 'belt';
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'points',    label: 'Points',    icon: '⭐' },
  { key: 'behaviour', label: 'Behaviour', icon: '📋' },
  { key: 'ladder',    label: 'Ladder',    icon: '🪜' },
  { key: 'belt',      label: 'Belt',      icon: '🏆' },
];

const COUNTDOWN_START = 5;
const COUNTDOWN_TICK_MS = 900;

export default function MeetingReviewPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children } = useFamily();

  // Default to Lifetime per Elia 2026-05-16. Custom-window state is held
  // separately so toggling chip → Custom → chip doesn't lose the dates.
  const [windowKey, setWindowKey] = useState<WindowKey>({ kind: 'lifetime' });
  const [customFrom, setCustomFrom] = useState<string>(todayString());
  const [customTo, setCustomTo] = useState<string>(todayString());
  const [tab, setTab] = useState<TabKey>('points');
  const [ratings, setRatings] = useState<DailyRating[] | null>(null);
  const [awards, setAwards] = useState<Award[] | null>(null);

  // Lock the meeting date once on mount so swapping windows doesn't drift
  // the boundary if the user lingers across midnight.
  const [meetingDate] = useState(todayString());

  const range = useMemo(
    () => computeWindowRange(windowKey, meetingDate),
    [windowKey, meetingDate],
  );

  const routines: Routine[] = family?.routines ?? [];
  const pointSystem = useMemo(() => readPointSystemConfig(family), [family]);

  useEffect(() => {
    if (!profile?.familyId) return;
    let cancelled = false;
    setRatings(null);
    setAwards(null);
    Promise.all([
      getRatingsInDateRange(profile.familyId, range.from, range.to),
      getAwardsInDateRange(profile.familyId, range.from, range.to),
    ]).then(([r, a]) => {
      if (cancelled) return;
      setRatings(r);
      setAwards(a);
    });
    return () => { cancelled = true; };
  }, [profile?.familyId, range.from, range.to]);

  const result = useMemo(() => {
    if (!ratings || !awards) return null;
    return computeReview(children, routines, ratings, awards, range);
  }, [children, routines, ratings, awards, range]);

  const dayScores = useMemo(() => {
    if (!ratings) return null;
    return computeDayScores(children, ratings, range);
  }, [children, ratings, range]);

  const comments = useMemo(() => {
    if (!ratings) return null;
    return extractComments(ratings);
  }, [ratings]);

  const childById = useMemo(() => {
    const m = new Map<string, Child>();
    for (const c of children) m.set(c.id, c);
    return m;
  }, [children]);

  const awardBonus = useCallback(async (child: Child, points: number, reason: string) => {
    if (!profile?.familyId) return;
    const kind: 'regular' | 'diamond' = points >= pointSystem.diamondMinPoints ? 'diamond' : 'regular';
    await giveAward(profile.familyId, {
      childId: child.id,
      kind,
      points,
      reason,
      category: 'family-meeting',
      awardedBy: profile.uid,
      awardedByName: profile.displayName,
    });
  }, [profile?.familyId, profile?.uid, profile?.displayName, pointSystem.diamondMinPoints]);

  const loading = !result || !dayScores || !comments;

  return (
    <div className="min-h-screen -mx-4 lg:-mx-8 -my-4 lg:-my-6 bg-gradient-to-br from-kaya-chocolate via-[#221409] to-kaya-chocolate-light text-white">
      <div className="max-w-6xl mx-auto px-4 lg:px-8 py-5 lg:py-8">
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 mb-5 lg:mb-6">
          <div>
            <p className="text-[11px] lg:text-xs uppercase tracking-[0.24em] text-kaya-gold/80 font-bold mb-1">
              Family Meeting
            </p>
            <h1 className="font-display text-2xl lg:text-4xl font-black leading-tight">
              Points Review
            </h1>
            <p className="text-kaya-sand-light/80 text-xs lg:text-sm mt-1">
              {range.label} · {formatPretty(range.from)} → {formatPretty(range.to)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <FullscreenToggle />
            <button
              onClick={() => router.push('/meetings')}
              className="h-9 lg:h-10 px-3 lg:px-4 rounded-kaya-sm text-xs lg:text-sm font-semibold bg-white/10 hover:bg-white/15 transition-colors"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* ── Window picker ────────────────────────────────────────── */}
        <WindowPicker
          meetingDate={meetingDate}
          windowKey={windowKey}
          setWindowKey={setWindowKey}
          customFrom={customFrom}
          customTo={customTo}
          setCustomFrom={setCustomFrom}
          setCustomTo={setCustomTo}
        />

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <div className="flex gap-1 lg:gap-2 mb-6 lg:mb-8 border-b border-white/10 overflow-x-auto -mx-2 px-2">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`shrink-0 inline-flex items-center gap-1.5 h-10 lg:h-11 px-3 lg:px-4 rounded-t-kaya-sm text-xs lg:text-sm font-bold transition-colors ${
                  active
                    ? 'bg-white/10 text-kaya-gold border-b-2 border-kaya-gold -mb-px'
                    : 'text-white/60 hover:text-white/90 border-b-2 border-transparent'
                }`}
              >
                <span aria-hidden>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── Tab content ──────────────────────────────────────────── */}
        {loading && <LoadingState />}

        {!loading && tab === 'points' && (
          <PointsTab leaderboard={result!.leaderboard} childById={childById} />
        )}

        {!loading && tab === 'behaviour' && (
          <BehaviourTab comments={comments!} childById={childById} />
        )}

        {!loading && tab === 'ladder' && (
          <LadderTab
            children={children}
            routines={routines}
            ratings={ratings!}
            range={range}
            childById={childById}
            pointSystem={pointSystem}
            onAwardBonus={awardBonus}
          />
        )}

        {!loading && tab === 'belt' && (
          <BeltTab
            dayScores={dayScores!}
            routines={routines}
            childById={childById}
            pointSystem={pointSystem}
            onAwardBonus={awardBonus}
            rangeLabel={range.label}
          />
        )}

        <p className="text-center text-[11px] lg:text-xs text-white/40 mt-8 lg:mt-10">
          Excellent Belt&reg; and Excellent Ladder&reg; by Diella
        </p>
      </div>
    </div>
  );
}

// ── Window picker ─────────────────────────────────────────────────────────
function WindowPicker({
  meetingDate, windowKey, setWindowKey,
  customFrom, customTo, setCustomFrom, setCustomTo,
}: {
  meetingDate: string;
  windowKey: WindowKey;
  setWindowKey: (k: WindowKey) => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (d: string) => void;
  setCustomTo: (d: string) => void;
}) {
  const months = useMemo(() => recentMonths(meetingDate, 12), [meetingDate]);

  const isMonth = windowKey.kind === 'month';
  const isCustom = windowKey.kind === 'custom';

  // Pre-select the most recent month in the dropdown when the user is not
  // currently on a 'month' window — gives them a sensible default to pick.
  const monthValue = isMonth
    ? `${windowKey.year}-${String(windowKey.month).padStart(2, '0')}`
    : '';

  return (
    <div className="mb-4 lg:mb-5 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        {WINDOW_QUICK_PICKS.map((opt) => {
          const active = opt.matches(windowKey);
          return (
            <button
              key={opt.label}
              onClick={() => setWindowKey(opt.key)}
              className={`h-9 lg:h-10 px-4 rounded-full text-xs lg:text-sm font-bold transition-colors ${
                active
                  ? 'bg-kaya-gold text-kaya-chocolate'
                  : 'bg-white/8 text-white/80 hover:bg-white/15'
              }`}
            >
              {opt.label}
            </button>
          );
        })}

        {/* Months dropdown — wraps native <select> for keyboard + a11y */}
        <label className={`relative h-9 lg:h-10 inline-flex items-center rounded-full text-xs lg:text-sm font-bold transition-colors cursor-pointer ${
          isMonth ? 'bg-kaya-gold text-kaya-chocolate' : 'bg-white/8 text-white/80 hover:bg-white/15'
        }`}>
          <select
            value={monthValue}
            onChange={(e) => {
              if (!e.target.value) return;
              const [y, m] = e.target.value.split('-').map((n) => Number(n));
              setWindowKey({ kind: 'month', year: y, month: m });
            }}
            className="appearance-none bg-transparent border-0 pl-4 pr-8 h-full font-bold text-inherit focus:outline-none cursor-pointer"
          >
            <option value="" className="text-kaya-chocolate">Months ▾</option>
            {months.map((m) => (
              <option key={m.label} value={`${(m.key as Extract<WindowKey, {kind:'month'}>).year}-${String((m.key as Extract<WindowKey, {kind:'month'}>).month).padStart(2,'0')}`} className="text-kaya-chocolate">
                {m.label}
              </option>
            ))}
          </select>
          <span aria-hidden className="pointer-events-none absolute right-3 text-[10px]">▾</span>
        </label>

        <button
          onClick={() => setWindowKey({ kind: 'custom', from: customFrom, to: customTo })}
          className={`h-9 lg:h-10 px-4 rounded-full text-xs lg:text-sm font-bold transition-colors ${
            isCustom ? 'bg-kaya-gold text-kaya-chocolate' : 'bg-white/8 text-white/80 hover:bg-white/15'
          }`}
        >
          📅 Custom
        </button>
      </div>

      {isCustom && (
        <div className="flex flex-wrap items-center gap-2 text-xs lg:text-sm">
          <span className="text-white/60">From</span>
          <input
            type="date"
            value={customFrom}
            max={customTo}
            onChange={(e) => {
              const v = e.target.value;
              setCustomFrom(v);
              setWindowKey({ kind: 'custom', from: v, to: customTo });
            }}
            className="h-9 px-2 rounded-kaya-sm bg-white/10 border border-white/15 text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          />
          <span className="text-white/60">to</span>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            onChange={(e) => {
              const v = e.target.value;
              setCustomTo(v);
              setWindowKey({ kind: 'custom', from: customFrom, to: v });
            }}
            className="h-9 px-2 rounded-kaya-sm bg-white/10 border border-white/15 text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          />
        </div>
      )}
    </div>
  );
}

// ── Loading state ─────────────────────────────────────────────────────────
function LoadingState() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-24 rounded-kaya-lg bg-white/5 border border-white/10 animate-pulse" />
      ))}
    </div>
  );
}

// ── Date helpers ──────────────────────────────────────────────────────────
//
// Kaya's canonical date format is DD-MMM-YYYY (e.g. "15-May-2026"). We
// build it by hand from the YYYY-MM-DD string so locale never re-orders
// the parts — US users would otherwise read 03/05 as Mar 5 instead of
// May 3 (or vice-versa for the rest of the world). One unambiguous
// format keeps the meeting talk friction-free.
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatPretty(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  return `${String(d).padStart(2, '0')}-${MONTH_ABBR[m - 1]}-${y}`;
}

// Same format — kept as a separate name so future call sites can diverge
// (e.g. a future short variant without the year) without a sweep.
const formatShort = formatPretty;

// ─────────────────────────────────────────────────────────────────────────
// POINTS TAB
// ─────────────────────────────────────────────────────────────────────────

function PointsTab({ leaderboard, childById }: { leaderboard: KidReviewStats[]; childById: Map<string, Child> }) {
  if (leaderboard.length === 0) {
    return <EmptyState>No kids on this family yet.</EmptyState>;
  }
  const top = leaderboard[0]?.totalPoints ?? 0;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
      {leaderboard.map((s, i) => {
        const child = childById.get(s.childId);
        if (!child) return null;
        const isTop = s.totalPoints > 0 && s.totalPoints === top;
        return (
          <div
            key={s.childId}
            className={`relative rounded-kaya-lg p-4 lg:p-5 border ${
              isTop ? 'bg-kaya-gold/15 border-kaya-gold/50' : 'bg-white/5 border-white/10'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="text-3xl lg:text-4xl shrink-0">{child.avatarEmoji}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm lg:text-base font-bold truncate">{child.name}</p>
                <p className="text-[10px] lg:text-[11px] uppercase tracking-wider text-white/50 font-semibold">
                  #{i + 1}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-display text-2xl lg:text-3xl font-black leading-none ${isTop ? 'text-kaya-gold' : ''}`}>
                  {fmt(s.totalPoints)}
                </p>
                <p className="text-[10px] text-white/50 mt-0.5">pts</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
              <span>Routines: <span className="text-white font-semibold">{fmt(s.pointsFromRatings)}</span></span>
              <span>Awards: <span className="text-white font-semibold">{fmt(s.pointsFromAwards)}</span></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BEHAVIOUR TAB — comments left when ratings were submitted
// ─────────────────────────────────────────────────────────────────────────

function BehaviourTab({ comments, childById }: { comments: CommentEntry[]; childById: Map<string, Child> }) {
  if (comments.length === 0) {
    return (
      <EmptyState>
        No notes left this window. When a parent or helper writes a comment while
        rating a routine, it shows up here for the family to discuss.
      </EmptyState>
    );
  }

  // Group comments by child for the per-kid section layout.
  const byChild = new Map<string, CommentEntry[]>();
  for (const c of comments) {
    const bucket = byChild.get(c.childId) ?? [];
    bucket.push(c);
    byChild.set(c.childId, bucket);
  }

  return (
    <div className="space-y-5 lg:space-y-6">
      {[...byChild.entries()].map(([childId, entries]) => {
        const child = childById.get(childId);
        if (!child) return null;
        return (
          <section key={childId} className="rounded-kaya-lg bg-white/5 border border-white/10 p-4 lg:p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">{child.avatarEmoji}</span>
              <h3 className="font-display text-lg lg:text-xl font-black">{child.name}</h3>
              <span className="text-[11px] text-white/50">
                {entries.length} note{entries.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="space-y-3">
              {entries.map((e) => (
                <li key={e.ratingId} className="bg-black/20 rounded-kaya-sm p-3 lg:p-4 border-l-2 border-kaya-gold/60">
                  <div className="flex items-center gap-2 mb-1.5 text-[10px] lg:text-[11px] uppercase tracking-wider text-white/50 font-semibold">
                    <span className="normal-case">{formatShort(e.date)}</span>
                    <span aria-hidden>·</span>
                    <span>{e.period === 'morning' ? '☀️ Morning' : '🌙 Evening'}</span>
                    <span aria-hidden>·</span>
                    <span className="text-white/70">{e.ratedByName}</span>
                  </div>
                  <p className="text-sm lg:text-base leading-relaxed text-white/90">
                    &ldquo;{e.comment}&rdquo;
                  </p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LADDER TAB — countdown reveal -> per-kid columns of COMPLETE routines
// ─────────────────────────────────────────────────────────────────────────

function LadderTab({
  children, routines, ratings, range, childById, pointSystem, onAwardBonus,
}: {
  children: Child[];
  routines: Routine[];
  ratings: DailyRating[];
  range: { from: string; to: string; days: string[]; label: string };
  childById: Map<string, Child>;
  pointSystem: PointSystemConfig;
  onAwardBonus: (child: Child, points: number, reason: string) => Promise<void>;
}) {
  void pointSystem; // currently unused — bonus award row only on the Belt for now
  void onAwardBonus;
  const ladderByKid = useMemo(() => {
    const m = new Map<string, LadderRow[]>();
    for (const c of children) {
      m.set(c.id, computeLadderRows(c, routines, ratings, range));
    }
    return m;
  }, [children, routines, ratings, range]);

  // Pre-compute the per-kid COMPLETE counts so we can spot the champion(s).
  const completeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, rows] of ladderByKid.entries()) {
      m.set(id, rows.filter((r) => r.complete).length);
    }
    return m;
  }, [ladderByKid]);

  const maxComplete = Math.max(0, ...completeCounts.values());

  // The "signature" of the data — used to reset the reveal when the window
  // changes underneath us (so the grid hides again, honest suspense).
  const dataKey = useMemo(
    () => `${range.from}|${range.to}|${[...completeCounts.entries()].sort().map(([k, v]) => `${k}:${v}`).join(',')}`,
    [range.from, range.to, completeCounts],
  );

  return (
    <Reveal dataKey={dataKey} hiddenLabel="Tap to reveal the Ladder">
      {children.length === 0 ? (
        <EmptyState>No kids on this family yet.</EmptyState>
      ) : maxComplete === 0 ? (
        <EmptyState>No completed ladder rungs this window. Routines need an Excellent on every rated day to count.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
          {children.map((child) => {
            const rows = ladderByKid.get(child.id) ?? [];
            const completed = rows.filter((r) => r.complete);
            const isChampion = (completeCounts.get(child.id) ?? 0) === maxComplete && maxComplete > 0;
            return (
              <div key={child.id} className="rounded-kaya-lg bg-white/5 border border-white/10 p-3 lg:p-4 space-y-3">
                <div className="text-center">
                  <div className="text-4xl lg:text-5xl mb-1">{child.avatarEmoji}</div>
                  <p className={`font-display text-lg lg:text-xl font-black ${isChampion ? 'text-kaya-gold' : 'text-white'}`}>
                    {child.name}
                  </p>
                  <p className="text-[11px] uppercase tracking-wider text-white/50 font-semibold">
                    {completed.length} complete{completed.length === 1 ? '' : 's'}
                    {isChampion && <span className="ml-1 text-kaya-gold">★</span>}
                  </p>
                </div>
                {completed.length === 0 ? (
                  <p className="text-xs text-white/50 italic text-center py-4">No completed rungs.</p>
                ) : (
                  <div className="space-y-2.5">
                    {completed.map((row) => (
                      <LadderCard key={row.routineId} row={row} lastDate={range.to} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Reveal>
  );
}

// Cap how many day chips a single Ladder card renders. With Lifetime
// windows the underlying row can carry hundreds of days; 30 chips is
// already a tall stack on mobile, and beyond that the parent can't
// usefully read it. Older days are summarised with a "+N earlier" note.
const LADDER_DAYS_DISPLAY_LIMIT = 30;

function LadderCard({ row, lastDate }: { row: LadderRow; lastDate: string }) {
  const overflow = Math.max(0, row.days.length - LADDER_DAYS_DISPLAY_LIMIT);
  const visible = row.days.slice(0, LADDER_DAYS_DISPLAY_LIMIT);
  return (
    <div className="rounded-kaya-sm bg-black/25 border border-white/10 p-3">
      <div className="text-center mb-2">
        <p className="text-xs lg:text-sm font-bold flex items-center justify-center gap-1.5">
          <span aria-hidden>{row.icon}</span>
          <span>{row.label}</span>
        </p>
        <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">
          {row.period === 'morning' ? '☀️ Morning' : '🌙 Evening'}
        </p>
      </div>
      <div className="space-y-1">
        {visible.map((d) => {
          const isLast = d.date === lastDate;
          const isExcellent = d.status === 'excellent';
          return (
            <div
              key={d.date}
              className={`text-center text-[11px] font-bold py-1 px-2 rounded-full ${
                isLast
                  ? 'bg-kaya-gold text-kaya-chocolate'
                  : isExcellent
                  ? 'bg-emerald-500/80 text-emerald-50'
                  : 'bg-white/5 text-white/40 line-through'
              }`}
            >
              {formatShort(d.date)}{d.hasComment ? ' 📝' : ''}
            </div>
          );
        })}
        {overflow > 0 && (
          <p className="text-center text-[10px] uppercase tracking-wider text-white/40 font-semibold pt-1">
            + {overflow} earlier day{overflow === 1 ? '' : 's'}
          </p>
        )}
      </div>
      {row.complete && (
        <p className="text-center text-[11px] font-bold text-emerald-300 mt-2">
          🎉 COMPLETE!
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BELT TAB — most Excellents in a single day, with Excellent/Bad toggle
// ─────────────────────────────────────────────────────────────────────────

function BeltTab({
  dayScores, routines, childById, pointSystem, onAwardBonus, rangeLabel,
}: {
  dayScores: DayScore[];
  routines: Routine[];
  childById: Map<string, Child>;
  pointSystem: PointSystemConfig;
  onAwardBonus: (child: Child, points: number, reason: string) => Promise<void>;
  rangeLabel: string;
}) {
  const [kind, setKind] = useState<'excellent' | 'bad'>('excellent');
  const [index, setIndex] = useState(0);
  const [bonus, setBonus] = useState(5);
  const [awardedKeys, setAwardedKeys] = useState<Set<string>>(new Set());
  const [awardingKey, setAwardingKey] = useState<string | null>(null);

  const ranked = useMemo(() => topDays(dayScores, kind), [dayScores, kind]);

  // Reset the cycle when the underlying ranking changes.
  const rankKey = useMemo(
    () => `${kind}|${ranked.map((r) => `${r.childId}:${r.date}:${r.excellentCount}:${r.badCount}`).join(',')}`,
    [kind, ranked],
  );
  useEffect(() => {
    setIndex(0);
  }, [rankKey]);

  const champion = ranked[index];

  const routineById = useMemo(() => {
    const m = new Map<string, Routine>();
    for (const r of routines) m.set(r.id, r);
    return m;
  }, [routines]);

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* Title + by-line */}
      <div className="text-center">
        <h2 className="font-display text-2xl lg:text-3xl font-black flex items-center justify-center gap-2">
          <span aria-hidden>🏆</span> Excellent Belt
        </h2>
        <p className="text-xs lg:text-sm text-white/60 mt-1">
          {kind === 'excellent' ? (
            <>
              Most <span className="font-semibold text-white">&ldquo;Excellent&rdquo;</span> in a day wins
              {' · '}<span className="italic">by Diella ✨</span>
            </>
          ) : (
            // Per Elia 2026-05-16: Bad has no Champion framing. Plain
            // descriptive subtitle, no celebration language.
            <>Days with the most <span className="font-semibold text-white">&ldquo;Bad&rdquo;</span> ratings, listed straight.</>
          )}
        </p>
      </div>

      {/* Excellent / Bad toggle */}
      <div className="flex justify-center gap-2">
        {(['excellent', 'bad'] as const).map((k) => {
          const active = kind === k;
          return (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`h-10 lg:h-11 px-5 rounded-kaya-sm text-xs lg:text-sm font-bold transition-colors ${
                active
                  ? k === 'excellent'
                    ? 'bg-kaya-gold text-kaya-chocolate'
                    : 'bg-rose-500 text-white'
                  : 'bg-white/8 text-white/70 hover:bg-white/15'
              }`}
            >
              {k === 'excellent' ? '🥇 Excellent' : '⚠️ Bad'}
            </button>
          );
        })}
      </div>

      {kind === 'excellent' ? (
        // Excellent side — keep the suspense + champion + pagination.
        <Reveal dataKey={rankKey} hiddenLabel="Tap to reveal the Belt champion">
          {ranked.length === 0 ? (
            <EmptyState>No Excellent ratings recorded this window.</EmptyState>
          ) : champion ? (
            <ChampionCard
              score={champion.excellentCount}
              scoreLabel="Excellents"
              child={childById.get(champion.childId)}
              date={champion.date}
              routineIds={champion.excellentRoutineIds}
              routineById={routineById}
              rank={index + 1}
              totalRanked={ranked.length}
              kind="excellent"
              bonus={bonus}
              onBonusChange={setBonus}
              awarded={awardedKeys.has(`${champion.childId}|${champion.date}`)}
              awarding={awardingKey === `${champion.childId}|${champion.date}`}
              onAward={async () => {
                const child = childById.get(champion.childId);
                if (!child) return;
                const key = `${champion.childId}|${champion.date}`;
                setAwardingKey(key);
                try {
                  await onAwardBonus(child, bonus, `Excellent Belt — ${formatShort(champion.date)} · ${rangeLabel}`);
                  setAwardedKeys((prev) => new Set(prev).add(key));
                } finally {
                  setAwardingKey(null);
                }
              }}
              allowBonus
              diamondMinPoints={pointSystem.diamondMinPoints}
            />
          ) : null}

          {ranked.length > 1 && (
            <div className="flex justify-center mt-5 lg:mt-6">
              <button
                onClick={() => setIndex((i) => (i + 1) % ranked.length)}
                className="inline-flex items-center gap-2 h-11 lg:h-12 px-6 rounded-kaya-sm border-2 border-kaya-gold/70 text-kaya-gold font-bold text-sm lg:text-base hover:bg-kaya-gold/10 transition-colors"
              >
                <span aria-hidden>✨</span>
                <span>Reveal Next</span>
                <span aria-hidden>✨</span>
              </button>
            </div>
          )}
        </Reveal>
      ) : (
        // Bad side — plain list, no countdown / champion / Reveal Next.
        <BadDaysList ranked={ranked} childById={childById} routineById={routineById} />
      )}
    </div>
  );
}

// Plain list of bad days. No reveal, no champion framing, no bonus. Just
// the data so the family can talk about each tough day together.
function BadDaysList({
  ranked, childById, routineById,
}: {
  ranked: DayScore[];
  childById: Map<string, Child>;
  routineById: Map<string, Routine>;
}) {
  if (ranked.length === 0) {
    return <EmptyState>No Bad ratings recorded this window — nice.</EmptyState>;
  }
  return (
    <ul className="space-y-2.5">
      {ranked.map((day) => {
        const child = childById.get(day.childId);
        if (!child) return null;
        return (
          <li
            key={`${day.childId}|${day.date}`}
            className="rounded-kaya-sm bg-black/25 border-l-2 border-rose-400/60 border border-white/10 p-3 lg:p-4"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl lg:text-3xl shrink-0">{child.avatarEmoji}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm lg:text-base truncate">{child.name}</p>
                <p className="text-[11px] tracking-wider text-white/50 font-semibold">
                  {formatShort(day.date)}
                </p>
              </div>
              <p className="font-display text-xl lg:text-2xl font-black text-rose-300 leading-none shrink-0">
                {day.badCount}
                <span className="text-xs text-white/50 font-bold ml-1">bad</span>
              </p>
            </div>
            {day.badRoutineIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {day.badRoutineIds.map((id) => {
                  const r = routineById.get(id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border border-rose-400/30 bg-rose-500/15 text-rose-100"
                    >
                      {r?.icon && <span aria-hidden>{r.icon}</span>}
                      <span>{r?.label ?? id}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChampionCard({
  score, scoreLabel, child, date, routineIds, routineById, rank, totalRanked,
  kind, bonus, onBonusChange, awarded, awarding, onAward, allowBonus, diamondMinPoints,
}: {
  score: number;
  scoreLabel: string;
  child: Child | undefined;
  date: string;
  routineIds: string[];
  routineById: Map<string, Routine>;
  rank: number;
  totalRanked: number;
  kind: 'excellent' | 'bad';
  bonus: number;
  onBonusChange: (n: number) => void;
  awarded: boolean;
  awarding: boolean;
  onAward: () => Promise<void> | void;
  allowBonus: boolean;
  diamondMinPoints: number;
}) {
  if (!child) return null;
  const accent = kind === 'excellent' ? 'text-emerald-300 border-emerald-400/40' : 'text-rose-300 border-rose-400/40';
  const chipAccent = kind === 'excellent'
    ? 'bg-emerald-500/20 text-emerald-100 border-emerald-400/30'
    : 'bg-rose-500/20 text-rose-100 border-rose-400/30';
  return (
    <div className={`rounded-kaya-lg bg-black/25 border ${accent} p-5 lg:p-8`}>
      <div className="text-center">
        <div className="text-5xl lg:text-6xl mb-2">{kind === 'excellent' ? '🥇' : '⚠️'}</div>
        <p className="text-[11px] lg:text-xs uppercase tracking-[0.22em] font-bold text-kaya-gold/80 mb-2">
          {kind === 'excellent' ? 'Belt Champion' : 'Toughest Day'}
        </p>
        <p className="font-display text-2xl lg:text-4xl font-black flex items-center justify-center gap-2">
          <span>{child.avatarEmoji}</span>
          <span>{child.name}</span>
        </p>
        <p className={`font-display text-xl lg:text-2xl font-black mt-1 ${kind === 'excellent' ? 'text-emerald-300' : 'text-rose-300'}`}>
          {score} {scoreLabel}{' '}
          <span className="text-white/60 font-bold text-base lg:text-lg">({formatShort(date)})</span>
        </p>
        {totalRanked > 1 && (
          <p className="text-[10px] uppercase tracking-wider text-white/40 mt-1 font-semibold">
            Showing #{rank} of {totalRanked}
          </p>
        )}

        {routineIds.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5 mt-4">
            {routineIds.map((id) => {
              const r = routineById.get(id);
              const label = r?.label ?? id;
              return (
                <span
                  key={id}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] lg:text-xs font-semibold border ${chipAccent}`}
                >
                  {r?.icon && <span aria-hidden>{r.icon}</span>}
                  <span>{label}</span>
                </span>
              );
            })}
          </div>
        )}

        {allowBonus && (
          <div className="mt-5 pt-4 border-t border-white/10">
            <p className="text-[10px] uppercase tracking-wider text-white/50 font-bold mb-2">Reward</p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <label className="text-xs text-white/60">Bonus</label>
              <input
                type="number"
                min={1}
                max={50}
                value={bonus}
                onChange={(e) => onBonusChange(Math.max(1, Math.min(50, Number(e.target.value) || 0)))}
                className="w-16 h-9 px-2 rounded-kaya-sm bg-white/10 border border-white/15 text-white text-center text-sm font-bold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
              />
              <span className="text-xs text-white/60">pts</span>
              <span className="text-[10px] text-white/40 ml-1">
                {bonus >= diamondMinPoints ? '· Diamond' : '· Regular'}
              </span>
            </div>
            <button
              disabled={awarded || awarding}
              onClick={onAward}
              className={`mt-3 h-10 px-5 rounded-full text-xs lg:text-sm font-bold transition-colors ${
                awarded
                  ? 'bg-white/10 text-white/60 cursor-default'
                  : 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400'
              }`}
            >
              {awarded ? `✓ Awarded ${child.name}` : awarding ? 'Awarding…' : `+${bonus} → ${child.name}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Reveal wrapper — hides children behind a countdown until parent taps.
// Resets to hidden whenever `dataKey` changes so a window switch re-arms.
// ─────────────────────────────────────────────────────────────────────────

function Reveal({ children, dataKey, hiddenLabel }: {
  children: React.ReactNode;
  dataKey: string;
  hiddenLabel: string;
}) {
  const [state, setState] = useState<'hidden' | 'countdown' | 'revealed'>('hidden');
  const [count, setCount] = useState(COUNTDOWN_START);

  useEffect(() => {
    setState('hidden');
    setCount(COUNTDOWN_START);
  }, [dataKey]);

  useEffect(() => {
    if (state !== 'countdown') return;
    if (count <= 1) {
      const t = setTimeout(() => setState('revealed'), COUNTDOWN_TICK_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCount((c) => c - 1), COUNTDOWN_TICK_MS);
    return () => clearTimeout(t);
  }, [state, count]);

  if (state === 'hidden') {
    return (
      <div className="rounded-kaya-lg bg-white/5 border border-white/10 p-8 lg:p-12 text-center">
        <button
          onClick={() => { setCount(COUNTDOWN_START); setState('countdown'); }}
          className="px-6 py-3 rounded-full bg-kaya-gold text-kaya-chocolate font-bold text-sm lg:text-base hover:bg-kaya-gold-dark transition-colors shadow-lg"
        >
          {hiddenLabel} &nbsp;→
        </button>
      </div>
    );
  }

  if (state === 'countdown') {
    return (
      <div className="rounded-kaya-lg bg-white/5 border border-white/10 p-8 lg:p-12 text-center flex flex-col items-center">
        <p className="font-display font-black text-emerald-300 leading-none animate-pulse" style={{ fontSize: '6rem' }}>
          {count}
        </p>
        <p className="text-xs text-white/40 mt-2">Get ready…</p>
      </div>
    );
  }

  return (
    <div className="animate-slide-up space-y-4">
      {children}
      <div className="flex justify-center">
        <button
          onClick={() => setState('hidden')}
          className="text-[11px] text-white/40 hover:text-white/70 underline"
        >
          Hide again
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-kaya-lg bg-white/5 border border-white/10 p-8 text-center text-sm text-white/60 max-w-2xl mx-auto">
      {children}
    </div>
  );
}

// ── Fullscreen toggle ──────────────────────────────────────────────────
// One-tap browser fullscreen via the Fullscreen API. Works on iPad/iPhone
// Safari (with vendor prefix), Android Chrome, and desktop browsers —
// replaces the old "Press F11" hint which didn't help on phones/tablets.
// Hidden entirely when the API isn't supported (rare; very old browsers).
function FullscreenToggle() {
  const [isFs, setIsFs] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element };
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (!root.requestFullscreen && !root.webkitRequestFullscreen) {
      setSupported(false);
      return;
    }
    const onChange = () => setIsFs(!!(document.fullscreenElement || doc.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggle = useCallback(async () => {
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
      webkitFullscreenElement?: Element;
    };
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (document.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      } else {
        if (root.requestFullscreen) await root.requestFullscreen();
        else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
      }
    } catch {
      // Some browsers reject without a user-gesture chain; silently
      // ignore — the button's UI state will refresh on the next change
      // event anyway.
    }
  }, []);

  if (!supported) return null;
  return (
    <button
      onClick={toggle}
      aria-label={isFs ? 'Exit fullscreen' : 'Enter fullscreen'}
      title={isFs ? 'Exit fullscreen' : 'Enter fullscreen (works on phone, tablet, desktop)'}
      className="h-9 lg:h-10 px-3 lg:px-4 rounded-kaya-sm text-xs lg:text-sm font-semibold bg-white/10 hover:bg-white/15 transition-colors"
    >
      {isFs ? '⛶ Exit' : '⛶ Fullscreen'}
    </button>
  );
}
