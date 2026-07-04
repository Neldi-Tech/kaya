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
import { useRouter, useSearchParams } from 'next/navigation';
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
  computeLadderRows, extractComments, recentMonths, beltChampions,
  WindowKey, KidReviewStats, DayScore, LadderRow, CommentEntry, BeltChampion,
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

// Sunday-Meeting v2 (2026-06-07) splits the old "Belt" tab in two:
//   • belt (NEW) — Excellent Belt® = perfect-day champion (every rated
//                 routine on that day was Excellent). Most weeks no one
//                 earns it — that's the point.
//   • star      — Excellent Star of the Day = the legacy "most-Excellents-
//                 in-a-day" celebration. Lighter daily recognition so the
//                 kid who scored 18/20 isn't invisible behind a perfect-day
//                 winner. Default bonus drops from 5 → 1 pt.
// The TabKey 'belt' is reused for the new (more prestigious) Belt; the
// historic logic moves under the new 'star' key.
type TabKey = 'points' | 'behaviour' | 'ladder' | 'belt' | 'star';
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'points',    label: 'Points',    icon: '💎' },
  { key: 'behaviour', label: 'Behaviour', icon: '📋' },
  { key: 'ladder',    label: 'Ladder',    icon: '🪜' },
  { key: 'belt',      label: 'Belt',      icon: '🏆' },
  { key: 'star',      label: 'Star',      icon: '⭐' },
];

const COUNTDOWN_START = 5;
const COUNTDOWN_TICK_MS = 900;

export default function MeetingReviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Autopilot — when this reveal screen is opened from the presenter
  // (`/meetings/review?from=present`), the Close button returns the
  // family to the presenter with `?advance=1` so the meeting moves on
  // to the next agenda step instead of dropping back to the hub.
  // Sunday-Meeting v2 · 2026-06-07.
  const fromPresent = searchParams?.get('from') === 'present';
  const closeHref = fromPresent ? '/meetings/present?advance=1' : '/meetings';
  const { profile } = useAuth();
  const { family, children } = useFamily();

  // Default to Lifetime per Elia 2026-05-16. Custom-window state is held
  // separately so toggling chip → Custom → chip doesn't lose the dates.
  const [windowKey, setWindowKey] = useState<WindowKey>({ kind: 'lifetime' });
  const [customFrom, setCustomFrom] = useState<string>(todayString());
  const [customTo, setCustomTo] = useState<string>(todayString());
  const [tab, setTab] = useState<TabKey>('points');
  // "?" guide — explains Belt vs Star vs Ladder so a parent picking up
  // the meeting cold can read the rules in one screen.
  const [guideOpen, setGuideOpen] = useState(false);
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
              onClick={() => router.push(closeHref)}
              className="h-9 lg:h-10 px-3 lg:px-4 rounded-kaya-sm text-xs lg:text-sm font-semibold bg-white/10 hover:bg-white/15 transition-colors"
              title={fromPresent ? 'Close & continue to the next meeting step' : 'Close'}
            >
              {fromPresent ? '✕ Done · continue →' : '✕ Close'}
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
        <div className="flex items-end gap-1 lg:gap-2 mb-6 lg:mb-8 border-b border-white/10 overflow-x-auto -mx-2 px-2">
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
          {/* Right-aligned "?" — opens the Belt/Star/Ladder explainer. */}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            aria-label="How Belt, Star and Ladder work"
            title="How Belt, Star and Ladder work"
            className="shrink-0 self-center mb-1 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/80 text-sm font-extrabold flex items-center justify-center transition-colors"
          >
            ?
          </button>
        </div>

        {/* ── Tab content ──────────────────────────────────────────── */}
        {loading && <LoadingState />}

        {!loading && tab === 'points' && (
          <PointsTab leaderboard={result!.leaderboard} childById={childById} pointSystem={pointSystem} />
        )}

        {!loading && tab === 'behaviour' && (
          <BehaviourTab
            comments={comments!}
            dayScores={dayScores!}
            routines={routines}
            childById={childById}
          />
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
          <BeltChampionTab
            dayScores={dayScores!}
            children={children}
            childById={childById}
            pointSystem={pointSystem}
            onAwardBonus={awardBonus}
            rangeLabel={range.label}
          />
        )}

        {!loading && tab === 'star' && (
          <BeltTab
            dayScores={dayScores!}
            routines={routines}
            childById={childById}
            pointSystem={pointSystem}
            onAwardBonus={awardBonus}
            rangeLabel={range.label}
          />
        )}

        <p className="text-center text-[11px] lg:text-xs text-white/45 mt-8 lg:mt-10">
          Excellent Belt&reg; · Excellent Star&reg; · Excellent Ladder&reg;{' '}
          · <span className="text-kaya-gold-light/80 font-display font-extrabold tracking-wider">Designed by Diella ✨</span>
        </p>
      </div>

      {guideOpen && <ReviewGuide onClose={() => setGuideOpen(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// REVIEW GUIDE — one-screen explainer for the Belt / Star / Ladder
// (and the colour rule on the Ladder bars). Designed to be readable by
// a parent who just walked into the meeting. Sunday-Meeting v2.
// ─────────────────────────────────────────────────────────────────────────

function ReviewGuide({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center bg-black/60 backdrop-blur-sm p-3 lg:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="How Belt, Star and Ladder work"
    >
      <div
        className="relative w-full max-w-md lg:max-w-lg max-h-[88vh] overflow-y-auto bg-kaya-chocolate text-white rounded-3xl border border-white/15 shadow-2xl p-5 lg:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close guide"
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white text-base flex items-center justify-center transition-colors"
        >
          ✕
        </button>

        <p className="text-[10px] uppercase tracking-[0.24em] font-extrabold text-kaya-gold-light/90">
          How this works
        </p>
        <h2 className="font-display text-2xl lg:text-3xl font-black mt-1 mb-5">
          Belt, Star, &amp; Ladder
        </h2>

        <div className="space-y-4 text-sm lg:text-[15px] leading-relaxed">
          <div className="rounded-2xl border border-kaya-gold/40 bg-kaya-gold/10 p-4">
            <p className="font-display text-lg font-black flex items-center gap-2">🏆 Excellent Belt</p>
            <p className="text-white/85 mt-1">
              <b>A perfect day.</b> Every rated routine that day was Excellent — no Goods, no Bads.
              The <b>Belt Champion</b> is whoever earned the most perfect days in the window.
              Most weeks no one wins it — that&apos;s the point. It&apos;s an honour.
            </p>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-4">
            <p className="font-display text-lg font-black flex items-center gap-2">⭐ Excellent Star of the Day</p>
            <p className="text-white/85 mt-1">
              <b>Whoever had the most Excellents that day</b> — even without a perfect sweep.
              A lighter daily &ldquo;well done&rdquo; (default <b>1 pt</b>) so the kid who scored 18/20 isn&apos;t invisible
              behind a perfect-day winner.
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.07] p-4">
            <p className="font-display text-lg font-black flex items-center gap-2">🪜 Excellent Ladder</p>
            <p className="text-white/85 mt-1">
              Per-kid trophy grid: only the routines where <b>every rated day</b> in the window was Excellent.
              Each cell shows that day&apos;s actual rating colour:
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] font-bold">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/80 text-emerald-50">Excellent</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-kaya-gold text-kaya-chocolate">Good</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/85 text-rose-50">Bad</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 text-white/55">Skip / unrated</span>
            </p>
            <p className="text-white/85 mt-2">
              An <span className="text-emerald-200 font-extrabold">★ All-Excellent</span> badge appears when every
              rated day in the window is green — that&apos;s a ladder rung won.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <p className="text-[11px] uppercase tracking-wider font-bold text-white/55 mb-1">Ties &amp; bonuses</p>
            <p className="text-white/75 text-[13.5px]">
              Belt ties = multiple champions; you choose whether to split the bonus.
              Star ties = use &ldquo;Reveal Next&rdquo; to honour each day in turn.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full h-12 rounded-full bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-sm transition-colors"
        >
          Got it
        </button>
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
const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function formatPretty(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  // Day-of-week leads (SM3.1 · 4b) — kids anchor memories to days, not
  // numbers, so "Mon · 29-Jun-2026" lands where "29-Jun-2026" doesn't.
  const dow = DAY_ABBR[new Date(y, m - 1, d).getDay()];
  return `${dow} · ${String(d).padStart(2, '0')}-${MONTH_ABBR[m - 1]}-${y}`;
}

// Same format — kept as a separate name so future call sites can diverge
// (e.g. a future short variant without the year) without a sweep.
const formatShort = formatPretty;

// ─────────────────────────────────────────────────────────────────────────
// POINTS TAB
// ─────────────────────────────────────────────────────────────────────────

function PointsTab({
  leaderboard,
  childById,
  pointSystem,
}: {
  leaderboard: KidReviewStats[];
  childById: Map<string, Child>;
  pointSystem: PointSystemConfig;
}) {
  if (leaderboard.length === 0) {
    return <EmptyState>No kids on this family yet.</EmptyState>;
  }
  // Compute true House Points per kid:
  //   HP = floor(routine_pts / pointsPerHousePoint) + bonus_pts
  // The naive `totalPoints` (routine + bonus) was a raw-points sum,
  // which inflated the headline number (e.g. 2,116 routine + 162 bonus
  // = 2,278 instead of the actual ~183 HP a family talks about).
  const ppHP = Math.max(1, pointSystem.routines.pointsPerHousePoint);
  const housePointsOf = (s: KidReviewStats) =>
    Math.floor(s.pointsFromRatings / ppHP) + s.pointsFromAwards;

  const ranked = [...leaderboard].sort((a, b) => housePointsOf(b) - housePointsOf(a));
  const topHP = ranked[0] ? housePointsOf(ranked[0]) : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
      {ranked.map((s, i) => {
        const child = childById.get(s.childId);
        if (!child) return null;
        const hp = housePointsOf(s);
        const hpFromRoutine = Math.floor(s.pointsFromRatings / ppHP);
        const isTop = hp > 0 && hp === topHP;

        // Permanent commentary — explains where the HP headline came
        // from. Leads with the raw routine total (the number kids see
        // accumulating day-to-day), then how that converts to HP, then
        // bonus HP, then qualitative counts.
        const bits: string[] = [];
        if (s.pointsFromRatings) bits.push(`${fmt(s.pointsFromRatings)} routine pts → ${fmt(hpFromRoutine)} HP`);
        if (s.pointsFromAwards) bits.push(`${fmt(s.pointsFromAwards)} bonus HP`);
        if (s.ladderRoutineIds.length) bits.push(`${s.ladderRoutineIds.length} kept Excellent`);
        if (s.beltDays.length) bits.push(`${s.beltDays.length} Excellent day${s.beltDays.length === 1 ? '' : 's'}`);
        const commentary = bits.join(' · ') || 'no points this window yet';

        return (
          <div
            key={s.childId}
            className={`relative rounded-kaya-lg p-4 sm:p-5 lg:p-6 border text-center ${
              isTop
                ? 'bg-gradient-to-br from-kaya-gold/25 via-kaya-gold/10 to-transparent border-kaya-gold/60'
                : 'bg-white/5 border-white/10'
            }`}
          >
            {/* Top strip: rank + avatar + name */}
            <div className="flex items-center justify-center gap-2 mb-3 flex-wrap">
              <span className={`text-[10px] lg:text-[11px] uppercase tracking-wider font-bold ${isTop ? 'text-kaya-gold-light' : 'text-white/50'}`}>
                #{i + 1}
              </span>
              <span className="text-xl sm:text-2xl lg:text-3xl">{child.avatarEmoji}</span>
              <span className="text-[13px] sm:text-sm lg:text-base font-display font-extrabold truncate max-w-[120px] sm:max-w-none">{child.name}</span>
            </div>
            {/* HERO — House Points, the headline. Scaled so the number
                stays comfortable from phone (~44px) to laptop (~72px)
                to TV cast (~96px). */}
            <p
              className={`font-display font-black leading-none tracking-[-0.04em] ${isTop ? 'text-kaya-gold' : 'text-white'}`}
              style={{ fontSize: 'clamp(38px, 5.5vw, 72px)' }}
            >
              {fmt(hp)}
            </p>
            <p className="text-[10px] lg:text-[11px] uppercase tracking-[0.18em] font-bold text-white/55 mt-1">
              House Points
            </p>
            {/* Always-on commentary — what makes up the headline */}
            <p className="mt-3 text-[11.5px] lg:text-[12.5px] text-white/65 leading-snug">
              {commentary}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BEHAVIOUR TAB — comments left when ratings were submitted
// ─────────────────────────────────────────────────────────────────────────

type BehaviourFilter = 'all' | 'excellent' | 'bad';

function BehaviourTab({
  comments,
  dayScores,
  routines,
  childById,
}: {
  comments: CommentEntry[];
  dayScores: DayScore[];
  routines: Routine[];
  childById: Map<string, Child>;
}) {
  // Filter chip — All / Excellent comments only / Bad comments only.
  // Resets to All whenever the window changes so a parent who picked
  // Bad for last week isn't surprised by an empty tab this week.
  const [filter, setFilter] = useState<BehaviourFilter>('all');
  // Per-kid filter — declutters the tab when a family has 3+ kids. The
  // value 'all' shows every kid stacked; a child id shows just that
  // kid's section. Reset to 'all' whenever the underlying window
  // changes so a stale selection doesn't hide everything next week.
  const [kidFilter, setKidFilter] = useState<string>('all');
  useEffect(() => { setFilter('all'); setKidFilter('all'); }, [comments]);
  // Aggregate dayScores per kid → routines completed + excellent count +
  // worst (lowest-excellent) day. Build this regardless of whether there
  // are comments — the tab now leads with the count + dip callout and
  // comments slot in below.
  const routineNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of routines) m.set(r.id, r.label);
    return m;
  }, [routines]);

  const perKid = useMemo(() => {
    const m = new Map<string, {
      totalRated: number;
      excellentCount: number;
      badCount: number;
      worstDay: DayScore | null;
    }>();
    for (const ds of dayScores) {
      const cur = m.get(ds.childId) ?? { totalRated: 0, excellentCount: 0, badCount: 0, worstDay: null };
      cur.totalRated += ds.totalRated;
      cur.excellentCount += ds.excellentCount;
      cur.badCount += ds.badCount;
      // "Worst" = highest bad count; tiebreak by lowest excellent count.
      const isWorse = !cur.worstDay
        || ds.badCount > cur.worstDay.badCount
        || (ds.badCount === cur.worstDay.badCount && ds.excellentCount < cur.worstDay.excellentCount);
      if ((ds.badCount > 0 || ds.totalRated > 0) && isWorse) cur.worstDay = ds;
      m.set(ds.childId, cur);
    }
    return m;
  }, [dayScores]);

  // Filter comments by tone first, THEN bucket by kid — so the
  // per-kid sections show only the comments matching the active chip.
  const filteredComments = useMemo(() => {
    if (filter === 'all') return comments;
    return comments.filter((c) => c.tone === filter);
  }, [comments, filter]);

  const commentsByChild = useMemo(() => {
    const m = new Map<string, CommentEntry[]>();
    for (const c of filteredComments) {
      const bucket = m.get(c.childId) ?? [];
      bucket.push(c);
      m.set(c.childId, bucket);
    }
    return m;
  }, [filteredComments]);

  // Per-tone counts for the filter chip badges.
  const toneCounts = useMemo(() => {
    let excellent = 0; let bad = 0; let neutral = 0;
    for (const c of comments) {
      if (c.tone === 'excellent') excellent++;
      else if (c.tone === 'bad') bad++;
      else neutral++;
    }
    return { excellent, bad, neutral, all: comments.length };
  }, [comments]);

  // Render one section per kid that has either stats or comments.
  const kidIds = new Set<string>([
    ...Array.from(perKid.keys()),
    ...Array.from(commentsByChild.keys()),
  ]);

  if (kidIds.size === 0) {
    return (
      <EmptyState>
        No routine activity yet this window. Once kids start getting rated, behaviour stats and notes will land here.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5 lg:space-y-6">
      {/* Subtle bobbing animation for the kid avatars — playful but
          quiet enough not to compete with the content. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes kaya-kid-bob {
            0%,100% { transform: translateY(0) rotate(0deg); }
            50%     { transform: translateY(-4px) rotate(-3deg); }
          }
          .kaya-kid-bob { animation: kaya-kid-bob 2400ms ease-in-out infinite; transform-origin: 50% 70%; }
          @keyframes kaya-tag-pop {
            0%   { transform: scale(.4); opacity: 0; }
            70%  { transform: scale(1.15); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
          .kaya-tag-pop { animation: kaya-tag-pop 500ms ease-out both; }`,
        }}
      />

      {/* Per-kid filter — declutters the tab when there are multiple
          kids. Only shows when there's more than one kid with
          activity in the window. */}
      {kidIds.size > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] lg:text-[11px] uppercase tracking-wider font-bold text-white/45 mr-1">
            Kid:
          </span>
          {(() => {
            const onAll = kidFilter === 'all';
            return (
              <button
                type="button"
                onClick={() => setKidFilter('all')}
                aria-pressed={onAll}
                className={`px-3.5 py-1.5 rounded-full text-[12px] lg:text-[13px] font-display font-extrabold transition-colors ${
                  onAll ? 'bg-kaya-gold text-kaya-chocolate' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                All kids <span className="ml-1 opacity-70 font-bold">{kidIds.size}</span>
              </button>
            );
          })()}
          {Array.from(kidIds).map((childId) => {
            const child = childById.get(childId);
            if (!child) return null;
            const on = kidFilter === childId;
            return (
              <button
                type="button"
                key={childId}
                onClick={() => setKidFilter(childId)}
                aria-pressed={on}
                className={`px-3 py-1.5 rounded-full text-[12px] lg:text-[13px] font-display font-extrabold transition-colors flex items-center gap-1.5 ${
                  on ? 'bg-kaya-gold text-kaya-chocolate' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <span className="text-base leading-none">{child.avatarEmoji || '👧'}</span>
                {child.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Tone filter — All / Excellent / Bad */}
      {comments.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] lg:text-[11px] uppercase tracking-wider font-bold text-white/45 mr-1">
            Notes:
          </span>
          {([
            { id: 'all' as const,       label: 'All',           count: toneCounts.all,       cls: 'bg-white/10 text-white hover:bg-white/20', active: 'bg-kaya-gold text-kaya-chocolate' },
            { id: 'excellent' as const, label: '👍 Excellent',  count: toneCounts.excellent, cls: 'bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20', active: 'bg-emerald-500 text-white' },
            { id: 'bad' as const,       label: '👎 Bad',        count: toneCounts.bad,       cls: 'bg-rose-500/10 text-rose-200 hover:bg-rose-500/20', active: 'bg-rose-500 text-white' },
          ]).map((f) => {
            const on = filter === f.id;
            return (
              <button
                type="button"
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={on}
                className={`px-3.5 py-1.5 rounded-full text-[12px] lg:text-[13px] font-display font-extrabold transition-colors ${on ? f.active : f.cls}`}
              >
                {f.label} <span className="ml-1 opacity-70 font-bold">{f.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {Array.from(kidIds).map((childId) => {
        const child = childById.get(childId);
        if (!child) return null;
        // Per-kid filter — when a specific kid is selected, hide the
        // other kids' sections so the parent reads one focused view.
        if (kidFilter !== 'all' && kidFilter !== childId) return null;
        const stats = perKid.get(childId);
        const entries = commentsByChild.get(childId) ?? [];
        const worst = stats?.worstDay || null;
        const worstReasonRoutines = worst
          ? worst.badRoutineIds.map((id) => routineNameById.get(id) || id).filter(Boolean)
          : [];
        // If the tone filter is narrowing, only render kids that still
        // have anything to show under that filter (otherwise the
        // section is just an empty header).
        if (filter !== 'all' && entries.length === 0) return null;
        return (
          <section key={childId} className="rounded-kaya-lg bg-white/5 border border-white/10 p-4 lg:p-5">
            {/* Header — name + headline routine count */}
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className="text-3xl inline-block kaya-kid-bob">{child.avatarEmoji}</span>
              <h3 className="font-display text-lg lg:text-xl font-black">{child.name}</h3>
              {stats && stats.totalRated > 0 && (
                <span className="text-[11px] lg:text-[12px] font-display font-extrabold px-2.5 py-1 rounded-full bg-kaya-gold/20 text-kaya-gold-light uppercase tracking-wider">
                  {stats.totalRated} routines · {stats.excellentCount} Excellent
                </span>
              )}
              {entries.length > 0 && (
                <span className="text-[10px] lg:text-[11px] text-white/45 uppercase tracking-wider font-semibold ml-auto">
                  {entries.length} {filter === 'all' ? 'note' : `${filter}`}{entries.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {/* Worst day callout — only when viewing All or Bad, since
                it's about Bad ratings. Hide on the Excellent filter. */}
            {filter !== 'excellent' && worst && worst.badCount > 0 && (
              <div className="bg-rose-500/10 border-l-2 border-rose-400/70 rounded-kaya-sm p-3 lg:p-4 mb-3">
                <div className="text-[10px] lg:text-[11px] uppercase tracking-wider font-bold text-rose-300 mb-1">
                  Lowest day · {formatShort(worst.date)}
                </div>
                <p className="text-[13px] lg:text-sm text-white/85 leading-snug">
                  {worst.badCount} "Bad" rating{worst.badCount === 1 ? '' : 's'}
                  {worst.excellentCount > 0 && ` · still ${worst.excellentCount} Excellent`}
                  {worstReasonRoutines.length > 0 && (
                    <> on <span className="text-rose-200 font-semibold">{worstReasonRoutines.slice(0, 3).join(', ')}</span></>
                  )}
                  .
                </p>
              </div>
            )}

            {/* Comments — each tagged with its tone so a parent can
                spot Excellent moments and dips at a glance. */}
            {entries.length > 0 ? (
              <ul className="space-y-3">
                {entries.map((e) => {
                  const isExcellent = e.tone === 'excellent';
                  const isBad = e.tone === 'bad';
                  return (
                    <li
                      key={e.ratingId}
                      className={`rounded-kaya-sm p-3 lg:p-4 border-l-2 ${
                        isExcellent
                          ? 'bg-emerald-500/8 border-emerald-400/70'
                          : isBad
                          ? 'bg-rose-500/8 border-rose-400/70'
                          : 'bg-black/20 border-kaya-gold/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5 text-[10px] lg:text-[11px] uppercase tracking-wider text-white/50 font-semibold flex-wrap">
                        <span className={`kaya-tag-pop normal-case px-2 py-0.5 rounded-full font-display font-extrabold text-[10px] tracking-wider ${
                          isExcellent
                            ? 'bg-emerald-500/30 text-emerald-100'
                            : isBad
                            ? 'bg-rose-500/30 text-rose-100'
                            : 'bg-white/10 text-white/65'
                        }`}>
                          {isExcellent ? '👍 Excellent' : isBad ? '👎 Bad' : '· Neutral'}
                        </span>
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
                  );
                })}
              </ul>
            ) : (
              <p className="text-[12px] text-white/40 italic">
                {filter === 'all'
                  ? 'No notes left this window.'
                  : `No ${filter} notes this window.`}
              </p>
            )}
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
  // Exclude the meeting day from the streak rendering — Sunday isn't
  // rated yet, so the "streak" we celebrate is everything BEFORE it.
  // If the family pulls a 7-day window, the streak is 6 days.
  const streakDays = row.days.filter((d) => d.date !== lastDate);
  const overflow = Math.max(0, streakDays.length - LADDER_DAYS_DISPLAY_LIMIT);
  const visible = streakDays.slice(0, LADDER_DAYS_DISPLAY_LIMIT);

  // A row is a "true" streak only when every visible (non-meeting) day
  // is Excellent. `row.complete` already encodes this for the full
  // window — we re-state it explicitly here to highlight the whole
  // streak in gold instead of just one cell.
  const fullStreak = visible.length > 0 && visible.every((d) => d.status === 'excellent');

  return (
    <div className={`rounded-kaya-sm border p-3 ${
      fullStreak ? 'bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent border-emerald-400/50' : 'bg-black/25 border-white/10'
    }`}>
      <div className="text-center mb-2">
        <p className="text-xs lg:text-sm font-bold flex items-center justify-center gap-1.5">
          <span aria-hidden>{row.icon}</span>
          <span>{row.label}</span>
        </p>
        <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">
          {row.period === 'morning' ? '☀️ Morning' : '🌙 Evening'}
        </p>
        {fullStreak && (
          <p className="mt-1.5">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-[0.12em] bg-emerald-500/20 text-emerald-200 border border-emerald-400/40">
              ★ All-Excellent · {visible.length} {visible.length === 1 ? 'day' : 'days'}
            </span>
          </p>
        )}
      </div>
      <div className="space-y-1">
        {visible.map((d) => {
          // Sunday-Meeting v2 (b3): one colour per rating, every bar, every
          // kid. Replaces the older "fullStreak-conditional gold-or-emerald"
          // rule that surfaced different colours for the same Excellent
          // depending on the streak state — readers couldn't tell whether
          // "gold" meant Good or "extra-Excellent". Now: Excellent=green,
          // Good=gold, Bad=red, Skip/Unrated=grey. Streak earns the badge
          // above, not a re-paint of the cells.
          const cls =
            d.status === 'excellent' ? 'bg-emerald-500/85 text-emerald-50' :
            d.status === 'good'      ? 'bg-kaya-gold text-kaya-chocolate' :
            d.status === 'bad'       ? 'bg-rose-500/85 text-rose-50' :
                                       'bg-white/5 text-white/40 line-through';
          return (
            <div
              key={d.date}
              className={`text-center text-[11px] font-bold py-1 px-2 rounded-full ${cls}`}
              title={`${formatShort(d.date)} · ${d.status}`}
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
// STAR-OF-THE-DAY TAB — most Excellents in a single day (the lighter,
// daily recognition introduced in Sunday-Meeting v2). The component is
// still named BeltTab for git-history reasons, but the rendered copy +
// default bonus are tuned for the Star (1 pt) rather than the Belt.
// The perfect-day Belt now lives in BeltChampionTab below.
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
  // Star is purely about excellence. Default bonus is 1 pt — a "well
  // done" sticker — much lighter than the Belt's Diamond-tier reward.
  const [index, setIndex] = useState(0);
  const [bonus, setBonus] = useState(1);
  const [awardedKeys, setAwardedKeys] = useState<Set<string>>(new Set());
  const [awardingKey, setAwardingKey] = useState<string | null>(null);

  const ranked = useMemo(() => topDays(dayScores, 'excellent'), [dayScores]);

  // Reset the cycle when the underlying ranking changes.
  const rankKey = useMemo(
    () => ranked.map((r) => `${r.childId}:${r.date}:${r.excellentCount}`).join(','),
    [ranked],
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
          <span aria-hidden>⭐</span> Excellent Star of the Day
        </h2>
        <p className="text-xs lg:text-sm text-white/60 mt-1">
          Whoever logged the most <span className="font-semibold text-white">&ldquo;Excellent&rdquo;</span> on a day
          {' · '}<span className="italic">a lighter daily &ldquo;well done&rdquo;</span>
        </p>
      </div>

      <Reveal dataKey={rankKey} hiddenLabel="Tap to reveal the Star of the Day">
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
            championLabel="Star of the Day"
            championEmoji="⭐"
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
                await onAwardBonus(child, bonus, `Excellent Star — ${formatShort(champion.date)} · ${rangeLabel}`);
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BELT CHAMPION TAB — perfect-day champion(s) for the window. Sunday-
// Meeting v2. A perfect day = every rated routine on that day was
// Excellent. Most weeks no one earns it — the empty state ("no Belt
// this week — aim for a perfect day!") IS the design.
// ─────────────────────────────────────────────────────────────────────────

function BeltChampionTab({
  dayScores, children, childById, pointSystem, onAwardBonus, rangeLabel,
}: {
  dayScores: DayScore[];
  children: Child[];
  childById: Map<string, Child>;
  pointSystem: PointSystemConfig;
  onAwardBonus: (child: Child, points: number, reason: string) => Promise<void>;
  rangeLabel: string;
}) {
  void children; // currently unused — surfaced for future "everyone got 0" UX
  // Belt-bonus default is the family's Diamond floor (typically 5 pts)
  // because a perfect day is a Diamond-tier honour, not a "well done".
  const [bonus, setBonus] = useState(Math.max(5, pointSystem.diamondMinPoints));
  const [awardedKeys, setAwardedKeys] = useState<Set<string>>(new Set());
  const [awardingKey, setAwardingKey] = useState<string | null>(null);

  const champions = useMemo(() => beltChampions(dayScores), [dayScores]);
  const winners = useMemo(() => champions.filter((c) => c.isChampion), [champions]);
  const runners = useMemo(() => champions.filter((c) => !c.isChampion), [champions]);

  const dataKey = useMemo(
    () => champions.map((c) => `${c.childId}:${c.count}`).join(',') || 'empty',
    [champions],
  );

  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="text-center">
        <h2 className="font-display text-2xl lg:text-3xl font-black flex items-center justify-center gap-2">
          <span aria-hidden>🏆</span> Excellent Belt
        </h2>
        <p className="text-xs lg:text-sm text-white/60 mt-1">
          A <span className="font-semibold text-white">perfect day</span> — every rated routine was Excellent
          {' · '}<span className="italic">by Diella ✨</span>
        </p>
      </div>

      <Reveal dataKey={dataKey} hiddenLabel="Tap to reveal the Belt Champion">
        {winners.length === 0 ? (
          <EmptyState>
            <p className="font-display font-black text-xl lg:text-2xl text-white/85 mb-1">No Belt this week 🏆</p>
            <p className="text-white/55">Nobody had a perfect day yet — every rated routine has to be Excellent.</p>
            <p className="text-white/55 mt-1">Aim for one this week!</p>
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {winners.map((w) => {
              const child = childById.get(w.childId);
              if (!child) return null;
              const key = `${w.childId}|belt|${w.count}`;
              return (
                <BeltChampionCard
                  key={w.childId}
                  champion={w}
                  child={child}
                  rangeLabel={rangeLabel}
                  bonus={bonus}
                  onBonusChange={setBonus}
                  awarded={awardedKeys.has(key)}
                  awarding={awardingKey === key}
                  diamondMinPoints={pointSystem.diamondMinPoints}
                  onAward={async () => {
                    setAwardingKey(key);
                    try {
                      await onAwardBonus(child, bonus, `Excellent Belt — ${w.count} perfect day${w.count === 1 ? '' : 's'} · ${rangeLabel}`);
                      setAwardedKeys((prev) => new Set(prev).add(key));
                    } finally {
                      setAwardingKey(null);
                    }
                  }}
                />
              );
            })}

            {runners.length > 0 && (
              <div className="rounded-kaya-lg bg-white/[0.04] border border-white/10 p-4 lg:p-5">
                <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-white/50 mb-3">Runners-up</p>
                <ul className="space-y-1.5">
                  {runners.map((r) => {
                    const child = childById.get(r.childId);
                    if (!child) return null;
                    return (
                      <li key={r.childId} className="flex items-center gap-2 text-sm">
                        <span aria-hidden className="text-base">{child.avatarEmoji}</span>
                        <span className="font-bold text-white/85">{child.name}</span>
                        <span className="text-white/55">— {r.count} perfect day{r.count === 1 ? '' : 's'}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </Reveal>
    </div>
  );
}

function BeltChampionCard({
  champion, child, rangeLabel, bonus, onBonusChange, awarded, awarding, onAward, diamondMinPoints,
}: {
  champion: BeltChampion;
  child: Child;
  rangeLabel: string;
  bonus: number;
  onBonusChange: (n: number) => void;
  awarded: boolean;
  awarding: boolean;
  onAward: () => Promise<void> | void;
  diamondMinPoints: number;
}) {
  const days = champion.days;
  const recent = days.slice(0, 3);
  return (
    <div className="rounded-kaya-lg bg-gradient-to-br from-kaya-gold/15 via-amber-500/5 to-transparent border border-kaya-gold/60 p-5 lg:p-8">
      <div className="text-center">
        <div className="text-5xl lg:text-6xl mb-2">🏆</div>
        <p className="text-[11px] lg:text-xs uppercase tracking-[0.22em] font-bold text-kaya-gold-light mb-2">
          Belt Champion · {rangeLabel}
        </p>
        <p className="font-display text-2xl lg:text-4xl font-black flex items-center justify-center gap-2">
          <span aria-hidden>{child.avatarEmoji}</span>
          <span>{child.name}</span>
        </p>
        <p className="font-display text-xl lg:text-2xl font-black mt-1 text-kaya-gold-light">
          {champion.count} perfect day{champion.count === 1 ? '' : 's'}
        </p>

        {recent.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5 mt-4">
            {recent.map((d) => (
              <span
                key={d.date}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] lg:text-xs font-semibold border border-kaya-gold/40 bg-kaya-gold/15 text-kaya-gold-light"
              >
                ✓ {formatShort(d.date)}
              </span>
            ))}
            {days.length > recent.length && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold text-white/55">
                + {days.length - recent.length} more
              </span>
            )}
          </div>
        )}

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
            onClick={onAward}
            disabled={awarded || awarding}
            className="mt-3 inline-flex items-center gap-2 h-11 px-6 rounded-kaya-sm bg-kaya-gold hover:bg-kaya-gold-dark disabled:opacity-50 disabled:cursor-not-allowed text-kaya-chocolate font-display font-extrabold text-sm transition-colors"
          >
            {awarded ? '✓ Awarded' : awarding ? 'Awarding…' : '🏆 Give the Belt bonus'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChampionCard({
  score, scoreLabel, child, date, routineIds, routineById, rank, totalRanked,
  kind, championLabel, championEmoji,
  bonus, onBonusChange, awarded, awarding, onAward, allowBonus, diamondMinPoints,
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
  /** Sunday-Meeting v2: lets the same card render under different
   *  scope labels — "Star of the Day", "Belt Champion", etc. */
  championLabel?: string;
  championEmoji?: string;
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
        <div className="text-5xl lg:text-6xl mb-2">
          {championEmoji ?? (kind === 'excellent' ? '🥇' : '⚠️')}
        </div>
        <p className="text-[11px] lg:text-xs uppercase tracking-[0.22em] font-bold text-kaya-gold/80 mb-2">
          {championLabel ?? (kind === 'excellent' ? 'Belt Champion' : 'Toughest Day')}
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
  // When the countdown lands on 0 → reveal, mount a short celebration
  // overlay (sparkles + flowers cascade) so the reveal lands with a
  // pop. Auto-clears after ~3s — the underlying content stays visible.
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    setState('hidden');
    setCount(COUNTDOWN_START);
    setCelebrating(false);
  }, [dataKey]);

  useEffect(() => {
    if (state !== 'countdown') return;
    if (count <= 1) {
      const t = setTimeout(() => {
        setState('revealed');
        setCelebrating(true);
        setTimeout(() => setCelebrating(false), 3500);
      }, COUNTDOWN_TICK_MS);
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
    <div className="animate-slide-up space-y-4 relative">
      {celebrating && <RevealCelebration />}
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
// RevealCelebration — fires once when the countdown lands on the
// Ladder / Belt reveal. Flowers cascade down + sparkles twinkle.
// Self-cleaning via the parent's `celebrating` timer.
// ─────────────────────────────────────────────────────────────────────────
function RevealCelebration() {
  const flowers = useMemo(() => {
    const glyphs = ['🌸', '🌼', '🌷', '🌹', '💐', '🌺', '✨', '⭐', '🎉'];
    return Array.from({ length: 28 }, (_, i) => ({
      glyph: glyphs[i % glyphs.length],
      left: Math.random() * 100,
      delay: Math.random() * 0.8,
      duration: 2.4 + Math.random() * 1.4,
      size: 24 + Math.random() * 24,
    }));
  }, []);
  return (
    <div className="fixed inset-0 z-[60] pointer-events-none overflow-hidden">
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes kaya-reveal-flower-fall {
            0%   { transform: translateY(-15vh) rotate(0deg);   opacity: 0; }
            10%  { opacity: 1; }
            100% { transform: translateY(115vh) rotate(720deg); opacity: 1; }
          }`,
        }}
      />
      {flowers.map((f, i) => (
        <span
          key={i}
          className="absolute top-0 select-none"
          style={{
            left: `${f.left}%`,
            fontSize: `${f.size}px`,
            animation: `kaya-reveal-flower-fall ${f.duration}s linear ${f.delay}s forwards`,
          }}
        >
          {f.glyph}
        </span>
      ))}
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
