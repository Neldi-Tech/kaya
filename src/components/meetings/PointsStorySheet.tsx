'use client';

// 📖 Points Story + 💡 meanings (Sunday Meeting upgrade · PR3 · approved
// design v2, 21-Sep-2026 · S5–S8 · R6–R10).
//
// Tap a kid's card on the Points tab → a pop-up OVER the page (no
// navigation — it must work on the cast screen). Same pattern Elia approved
// for the Hive Meaning Sheet: 1st the MEANING, 2nd the STORY — every rating
// and award behind the big number, adding up to it exactly, with a ✓ line.
// Same sheet for kids and parents. Pure front-end: it reads the ratings +
// awards the Points Review page has already loaded.

import { useMemo, useState, type ReactNode } from 'react';
import type { Child, Routine, DailyRating, Award } from '@/lib/firestore';
import {
  computePointsStory, computeKeptBreakdown,
  type WindowRange, type StoryDay, type PointsStory,
} from '@/lib/meetingReview';
import { fmt } from '@/lib/format';

export type MeaningTerm = 'routine' | 'bonus' | 'kept';
type Filter = 'all' | 'routine' | 'bonus' | 'kept';

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parts(yyyyMmDd: string) { const [y, m, d] = yyyyMmDd.split('-').map(Number); return { y, m, d }; }
/** "Wed · 16-Sep" — the year lives in the sheet's header. */
function dayLabel(date: string): string {
  const { y, m, d } = parts(date);
  if (!y || !m || !d) return date;
  return `${DAY_ABBR[new Date(y, m - 1, d).getDay()]} · ${String(d).padStart(2, '0')}-${MONTH_ABBR[m - 1]}`;
}
function fullDay(date: string): string {
  const { y, m, d } = parts(date);
  if (!y || !m || !d) return date;
  return `${DAY_ABBR[new Date(y, m - 1, d).getDay()]} · ${String(d).padStart(2, '0')}-${MONTH_ABBR[m - 1]}-${y}`;
}
function clock(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
const first = (n: string) => (n || '').split(' ')[0];

const KIND_LABEL: Record<string, string> = {
  diamond: '💎 Diamond', regular: '🎁 Award', reducing: '🔻 Points taken away', kudos: '👏 Kudos', improvement_note: '📝 Improvement note',
};

export interface PointsStoryProps {
  child: Child;
  rank: number;
  of: number;
  routines: Routine[];
  ratings: DailyRating[];
  awards: Award[];
  range: WindowRange;
  pointsPerHousePoint: number;
  /** Open straight on a meaning pop-up (a tapped term) instead of the story. */
  initialMeaning?: MeaningTerm | null;
  onClose: () => void;
}

export default function PointsStorySheet({
  child, rank, of, routines, ratings, awards, range, pointsPerHousePoint, initialMeaning = null, onClose,
}: PointsStoryProps) {
  const story = useMemo(
    () => computePointsStory(child, routines, ratings, awards, range, pointsPerHousePoint),
    [child, routines, ratings, awards, range, pointsPerHousePoint],
  );
  const kept = useMemo(() => computeKeptBreakdown(child, routines, ratings), [child, routines, ratings]);
  const [meaning, setMeaning] = useState<MeaningTerm | null>(initialMeaning);
  const [filter, setFilter] = useState<Filter>('all');
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [keptAll, setKeptAll] = useState(false);

  const name = first(child.name);
  // F9 — a long window (Lifetime, a year) groups by month first.
  const byMonth = story.days.length > 45;
  const visibleDays = story.days.filter((d) =>
    filter === 'routine' ? d.periods.length > 0 : filter === 'bonus' ? d.awards.length > 0 : true);
  const months = useMemo(() => {
    const m = new Map<string, StoryDay[]>();
    for (const d of visibleDays) { const k = d.date.slice(0, 7); m.set(k, [...(m.get(k) || []), d]); }
    return Array.from(m.entries());
  }, [visibleDays]);
  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); apply(n);
  };

  return (
    <div
      className="fixed inset-0 z-[65] flex items-end lg:items-center justify-center bg-black/60 backdrop-blur-sm p-3 lg:p-6"
      onClick={onClose} role="dialog" aria-modal="true" aria-label={`${name}'s points story`}
    >
      <div
        className="relative w-full max-w-lg lg:max-w-2xl max-h-[90vh] overflow-y-auto bg-kaya-chocolate text-white rounded-3xl border border-white/15 shadow-2xl p-4 lg:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {meaning ? (
          <Meaning term={meaning} name={name} story={story} kept={kept} rangeLabel={range.label}
            onStory={() => { setMeaning(null); if (meaning === 'kept') setFilter('kept'); else if (meaning === 'bonus') setFilter('bonus'); else setFilter('routine'); }}
            onClose={onClose} />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="text-3xl lg:text-4xl" aria-hidden>{child.avatarEmoji}</span>
              <div className="min-w-0 flex-1">
                <p className="font-display font-black text-[16px] lg:text-xl leading-tight">
                  {filter === 'kept' ? `${fmt(kept.kept.length)} routine${kept.kept.length === 1 ? '' : 's'} kept Excellent` : `${name}'s ${fmt(story.hp)} House Point${story.hp === 1 ? '' : 's'}`}
                </p>
                <p className="text-[11px] lg:text-xs text-white/60 font-bold">
                  {filter === 'kept' ? 'Excellent on every day they were rated' : `${range.label} · ${fullDay(range.from)} → ${fullDay(range.to)} · #${rank} of ${of}`}
                </p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center shrink-0">✕</button>
            </div>

            {filter !== 'kept' && (
              <>
                <Lbl>① How {fmt(story.hp)} was built</Lbl>
                <Equation story={story} />
                <p className={`text-[11px] font-black mt-2 ${story.reconciles ? 'text-emerald-300' : 'text-amber-200'}`}>
                  {story.reconciles ? `✓ adds up — every point below is counted in the ${fmt(story.hp)}` : 'ⓘ a few entries sit outside the days shown — the big number is still the true total'}
                </p>
              </>
            )}

            <div className="flex flex-wrap gap-1.5 mt-3">
              <Chip on={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
              <Chip on={filter === 'routine'} onClick={() => setFilter('routine')}>⭐ Routine · {fmt(story.routinePts)} pts</Chip>
              <Chip on={filter === 'bonus'} onClick={() => setFilter('bonus')}>🎁 Bonus · {signed(story.bonusHp).replace('+', '')} HP</Chip>
              <Chip on={filter === 'kept'} onClick={() => setFilter('kept')}>🪜 Kept Excellent · {fmt(kept.kept.length)}</Chip>
            </div>

            {filter === 'kept' ? (
              <KeptView kept={kept} showAll={keptAll} onShowAll={() => setKeptAll(true)} />
            ) : (
              <>
                <Lbl>② The story, day by day</Lbl>
                {visibleDays.length === 0 && (
                  <p className="text-[12.5px] text-white/55 italic py-3">
                    {filter === 'bonus' ? 'No bonus awards in this window yet.' : filter === 'routine' ? 'No routine ratings in this window yet.' : 'Nothing recorded in this window yet.'}
                  </p>
                )}
                {byMonth ? months.map(([mk, days]) => {
                  const open = openMonths.has(mk);
                  const { y, m } = parts(`${mk}-01`);
                  const rp = days.reduce((s, d) => s + d.routinePts, 0);
                  const bh = days.reduce((s, d) => s + d.bonusHp, 0);
                  return (
                    <div key={mk} className="mt-1.5">
                      <button type="button" onClick={() => toggle(openMonths, mk, setOpenMonths)} aria-expanded={open}
                        className="w-full flex items-center gap-2 rounded-xl bg-white/[0.07] border border-white/10 px-3 py-2 text-left">
                        <span className="text-[12.5px] font-black">{MONTH_FULL[m - 1]} {y}</span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {filter !== 'bonus' && <Tag tone="rt">{fmt(rp)} routine pts</Tag>}
                          {filter !== 'routine' && bh !== 0 && <Tag tone={bh < 0 ? 'rd' : 'bn'}>{signed(bh)} HP</Tag>}
                          <span className="text-white/50 text-xs">{open ? '⌄' : '›'}</span>
                        </span>
                      </button>
                      {open && <div className="pl-2">{days.map((d) => <DayRow key={d.date} d={d} filter={filter} open={openDays.has(d.date)} onToggle={() => toggle(openDays, d.date, setOpenDays)} />)}</div>}
                    </div>
                  );
                }) : visibleDays.map((d) => (
                  <DayRow key={d.date} d={d} filter={filter} open={openDays.has(d.date)} onToggle={() => toggle(openDays, d.date, setOpenDays)} />
                ))}
              </>
            )}

            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-4 text-[11px] font-bold text-kaya-gold-light/90">
              <span className="text-white/45">What do the words mean?</span>
              <button type="button" className="underline decoration-dotted" onClick={() => setMeaning('routine')}>Routine points</button>
              <button type="button" className="underline decoration-dotted" onClick={() => setMeaning('bonus')}>Bonus HP</button>
              <button type="button" className="underline decoration-dotted" onClick={() => setMeaning('kept')}>Kept Excellent</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────

function Lbl({ children }: { children: ReactNode }) {
  return <p className="text-[10px] uppercase tracking-[0.16em] font-extrabold text-kaya-gold-light mt-4 mb-2">{children}</p>;
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`px-2.5 py-1.5 rounded-full text-[11px] font-black transition-colors ${on ? 'bg-kaya-gold text-kaya-chocolate' : 'bg-white/[0.08] text-white/75 hover:bg-white/15'}`}>
      {children}
    </button>
  );
}
function Tag({ tone, children }: { tone: 'rt' | 'bn' | 'gn' | 'am' | 'rd'; children: ReactNode }) {
  const cls = tone === 'rt' ? 'bg-white/10 text-white/85' : tone === 'bn' ? 'bg-kaya-gold/25 text-kaya-gold-light'
    : tone === 'gn' ? 'bg-emerald-500/25 text-emerald-200' : tone === 'am' ? 'bg-amber-500/25 text-amber-200' : 'bg-rose-500/25 text-rose-200';
  return <span className={`text-[10px] font-black rounded-full px-2 py-0.5 whitespace-nowrap ${cls}`}>{children}</span>;
}
function Box({ big, small, total = false }: { big: string; small: ReactNode; total?: boolean }) {
  return (
    <div className={`flex-1 min-w-0 rounded-xl px-1.5 py-2 text-center border ${total ? 'bg-kaya-gold/20 border-kaya-gold/60' : 'bg-white/[0.07] border-white/10'}`}>
      <p className={`font-display font-black text-[17px] lg:text-xl leading-none ${total ? 'text-kaya-gold' : ''}`}>{big}</p>
      <p className="text-[9.5px] lg:text-[10.5px] text-white/60 font-bold mt-1 leading-tight">{small}</p>
    </div>
  );
}
function Op({ children }: { children: ReactNode }) { return <span className="self-center text-white/50 text-sm font-black shrink-0">{children}</span>; }

function Equation({ story }: { story: PointsStory }) {
  return (
    <div className="flex items-stretch gap-1 lg:gap-1.5">
      <Box big={fmt(story.routinePts)} small={<>routine pts<br />÷ {fmt(story.ppHP)} per HP</>} />
      <Op>→</Op>
      <Box big={`${fmt(story.hpFromRoutine)} HP`} small={<>from routines<br />{fmt(story.leftover)} pts left over</>} />
      <Op>+</Op>
      <Box big={`${signed(story.bonusHp).replace('+', '')} HP`} small={<>bonus awards<br />{fmt(story.awardCount)} award{story.awardCount === 1 ? '' : 's'}</>} />
      <Op>=</Op>
      <Box total big={fmt(story.hp)} small="House Points" />
    </div>
  );
}

function DayRow({ d, filter, open, onToggle }: { d: StoryDay; filter: Filter; open: boolean; onToggle: () => void }) {
  return (
    <div className="mt-1.5 rounded-xl border border-white/10 bg-white/[0.04] overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-1.5 px-3 py-2 text-left">
        <span className="text-[12px] font-black whitespace-nowrap">{dayLabel(d.date)}</span>
        <span className="ml-auto flex flex-wrap justify-end items-center gap-1">
          {d.perfect && filter !== 'bonus' && <Tag tone="gn">🏆 perfect day</Tag>}
          {filter !== 'bonus' && d.periods.length > 0 && <Tag tone="rt">{fmt(d.routinePts)} routine pts</Tag>}
          {filter !== 'routine' && d.awards.length > 0 && <Tag tone={d.bonusHp < 0 ? 'rd' : 'bn'}>{signed(d.bonusHp)} HP</Tag>}
          <span className="text-white/50 text-xs pl-0.5">{open ? '⌄' : '›'}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10 px-3 py-2 space-y-2">
          {filter !== 'bonus' && d.periods.map((p) => (
            <div key={p.period} className="flex items-start gap-2 text-[12px] leading-snug">
              <span aria-hidden>{p.period === 'morning' ? '🌅' : '🌙'}</span>
              <div className="flex-1 min-w-0">
                <p className="font-extrabold text-white/90">{p.period === 'morning' ? 'Morning' : 'Evening'} routines · {p.rated} rated</p>
                <p className="text-[11px] text-white/60 font-bold">
                  {[p.excellent ? `${p.excellent} 🌟 Excellent` : '', p.good ? `${p.good} 👍 Good` : '', p.bad ? `${p.bad} 👎 Bad` : '', p.skip ? `${p.skip} skipped` : ''].filter(Boolean).join(' · ')}
                  {p.ratedByName ? ` · rated by ${first(p.ratedByName)}` : ''}
                </p>
                {p.notExcellent.map((n, i) => (
                  <p key={`n${i}`} className={`text-[11px] font-bold mt-0.5 ${n.value === 'bad' ? 'text-rose-200' : 'text-amber-200'}`}>
                    {n.value === 'bad' ? '👎' : '👍'} {n.icon} {n.label}{n.note ? ` — “${n.note}”` : ''}
                  </p>
                ))}
                {p.praise.map((n, i) => <p key={`p${i}`} className="text-[11px] font-bold mt-0.5 text-emerald-200">🌟 {n.icon} {n.label} — “{n.note}”</p>)}
                {p.comment && <p className="text-[11px] text-white/70 font-bold mt-0.5">🗒 {first(p.ratedByName) || 'Note'}: “{p.comment}”</p>}
                {p.reflections.map((r, i) => <p key={`r${i}`} className="text-[11px] text-[#CDB8FF] font-bold mt-0.5">💭 My reflection · {r.label}: “{r.text}”</p>)}
              </div>
              <span className="font-black whitespace-nowrap">{fmt(p.points)} pts</span>
            </div>
          ))}
          {filter !== 'routine' && d.awards.map((a) => (
            <div key={a.id} className="flex items-start gap-2 text-[12px] leading-snug">
              <span aria-hidden>{a.points < 0 ? '🔻' : a.kind === 'diamond' ? '💎' : '🎁'}</span>
              <div className="flex-1 min-w-0">
                <p className="font-extrabold text-white/90">{KIND_LABEL[a.kind] ? `${KIND_LABEL[a.kind].replace(/^\S+\s/, '')} · ` : ''}“{a.reason || 'No reason written'}”</p>
                <p className="text-[11px] text-white/60 font-bold">
                  {[a.category, a.byName ? `given by ${first(a.byName)}` : '', a.at ? `${dayLabel(d.date).split(' · ')[1]} · ${clock(a.at)}` : ''].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className={`font-black whitespace-nowrap ${a.points < 0 ? 'text-rose-300' : a.points === 0 ? 'text-white/55' : 'text-kaya-gold-light'}`}>{a.points === 0 ? 'note' : `${signed(a.points)} HP`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KeptView({ kept, showAll, onShowAll }: { kept: ReturnType<typeof computeKeptBreakdown>; showAll: boolean; onShowAll: () => void }) {
  const list = showAll ? kept.kept : kept.kept.slice(0, 3);
  return (
    <>
      <Lbl>🪜 Kept all {kept.kept.length > 0 ? 'the way' : 'week'}</Lbl>
      {kept.kept.length === 0 && <p className="text-[12.5px] text-white/55 italic">No routine stayed Excellent on every rated day — yet. One great week changes that.</p>}
      {list.map((k) => (
        <div key={k.routineId} className="flex items-center gap-2 py-1.5 text-[12.5px]">
          <span aria-hidden>{k.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-white/90 truncate">{k.label} <span className="text-white/45 font-bold">({k.period})</span></p>
            <p className="text-[11px] text-white/55 font-bold">{k.excellentDays} of {k.excellentDays} day{k.excellentDays === 1 ? '' : 's'} 🌟</p>
          </div>
          <Tag tone="gn">kept</Tag>
        </div>
      ))}
      {!showAll && kept.kept.length > 3 && (
        <button type="button" onClick={onShowAll} className="text-[11.5px] font-black text-kaya-gold-light mt-0.5">+ {kept.kept.length - 3} more ›</button>
      )}
      <Lbl>😮 So close — slipped once ({kept.slippedOnce.length})</Lbl>
      {kept.slippedOnce.length === 0 && <p className="text-[12.5px] text-white/55 italic">Nothing slipped just once in this window.</p>}
      {kept.slippedOnce.map((s) => (
        <div key={s.routineId} className="flex items-center gap-2 py-1.5 text-[12.5px]">
          <span aria-hidden>{s.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-white/90 truncate">{s.label}</p>
            <p className="text-[11px] text-white/60 font-bold">
              {s.slip.value === 'bad' ? '👎 Bad' : s.slip.value === 'good' ? '👍 Good' : '⏭ Skipped'} on {dayLabel(s.slip.date)}
              {s.slip.note ? ` — “${s.slip.note}”` : s.excellentDays > 0 ? ' — Excellent every other day' : ''}
            </p>
          </div>
          <Tag tone={s.slip.value === 'bad' ? 'rd' : 'am'}>1 slip</Tag>
        </div>
      ))}
    </>
  );
}

// ── 💡 meanings (S7 · S8) — plain words first, then the kid's own numbers ──
function Meaning({ term, name, story, kept, rangeLabel, onStory, onClose }: {
  term: MeaningTerm; name: string; story: PointsStory; kept: ReturnType<typeof computeKeptBreakdown>; rangeLabel: string;
  onStory: () => void; onClose: () => void;
}) {
  const head = term === 'routine' ? { e: '⭐', t: 'Routine points' } : term === 'bonus' ? { e: '🎁', t: 'Bonus HP' } : { e: '🪜', t: 'Kept Excellent' };
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="text-3xl" aria-hidden>{head.e}</span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-black text-[16px] lg:text-xl leading-tight">{head.t}</p>
          <p className="text-[11px] text-white/60 font-bold">What it means</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center shrink-0">✕</button>
      </div>
      {term === 'routine' && (
        <>
          <p className="text-[13px] leading-relaxed text-white/90 font-bold mt-3">
            Points you earn every day from your <b>morning and evening routines</b>. The better the rating — 🌟 Excellent, 👍 Good — the more points.
          </p>
          <Lbl>{name}&apos;s numbers</Lbl>
          <div className="flex items-stretch gap-1.5">
            <Box big={fmt(story.routinePts)} small={<>routine pts<br />{rangeLabel.toLowerCase()}</>} />
            <Op>÷</Op>
            <Box big={fmt(story.ppHP)} small={<>pts make<br />1 House Point</>} />
            <Op>=</Op>
            <Box total big={`${fmt(story.hpFromRoutine)} HP`} small={`+ ${fmt(story.leftover)} left over`} />
          </div>
          <p className="text-[11px] text-white/55 font-bold mt-2">Your family&apos;s rate is {fmt(story.ppHP)} routine pts = 1 HP (a parent sets this in Settings → Point system).</p>
        </>
      )}
      {term === 'bonus' && (
        <>
          <p className="text-[13px] leading-relaxed text-white/90 font-bold mt-3">
            <b>House Points given on top of your routines</b> — when someone notices something great: awards from a parent, 💎 Diamonds, 👑 Leader&apos;s notes, 🎭 meeting roles, and the Ladder / Belt / Star bonuses. They count <b>1 for 1</b>. Points taken away show here too, in red.
          </p>
          <p className="text-[11px] text-white/55 font-bold mt-2">{name}: {fmt(story.awardCount)} award{story.awardCount === 1 ? '' : 's'} · {rangeLabel.toLowerCase()} = {signed(story.bonusHp).replace('+', '')} bonus HP.</p>
        </>
      )}
      {term === 'kept' && (
        <>
          <p className="text-[13px] leading-relaxed text-white/90 font-bold mt-3">
            The number of routines you kept at <b>🌟 Excellent on every single day they were rated</b>. One 👍 Good or 👎 Bad breaks that routine&apos;s streak. Days with no rating don&apos;t count against you. These are your <b>Ladder rungs</b> — most rungs wins the 🪜 Ladder.
          </p>
          <p className="text-[11px] text-white/55 font-bold mt-2">{name}: {fmt(kept.kept.length)} of {fmt(kept.activeRated)} routines kept · {fmt(kept.slippedOnce.length)} slipped once.</p>
        </>
      )}
      <button type="button" onClick={onStory} className="mt-4 h-10 px-4 rounded-xl bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-[13px]">📖 See the full story</button>
    </>
  );
}
