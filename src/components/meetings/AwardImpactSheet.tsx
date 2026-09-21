'use client';

// 📊 The Impact pop-up — "what it changes" (approved design v2, 21-Sep-2026 ·
// S10 · S11 · S16 · R17).
//
// Shown right after a kid PROPOSES a meeting award ("if a parent approves…")
// and right after a parent GIVES one ("done — it's in!"). For the child
// receiving it: Last 7 days now → new · This month now → new · the place it
// moves them to · the gap to the next place. This is the moment that shows
// the kids why the points matter — so it stays honest (F7): it counts only
// the award(s) in hand, and the real leaderboard never moves until a parent
// has approved.

import { impactHeadline, type ImpactRow } from '@/lib/meetingImpact';

export interface ImpactSheetData {
  mode: 'proposed' | 'done';
  /** One line under the headline, e.g. "🏆 Excellent Belt bonus → 💎 Diella". */
  subtitle: string;
  /** Who gave it (parent mode). */
  byName?: string;
  rows: ImpactRow[];
  /** Per-row badge for a bundle (🥇 🥈 🥉). */
  medals?: Record<string, string>;
  /** Footer for the bundle variant ("Month race: …"). */
  raceLine?: string;
}

const first = (n: string) => (n || '').split(' ')[0];

function Place({ w }: { w: ImpactRow['week'] }) {
  return (
    <>
      <span className={w.moved ? 'text-emerald-300 font-black' : 'text-white/60 font-extrabold'}>
        {w.moved ? `#${w.rankNow} → #${w.rankNext} ${w.rankNext < w.rankNow ? '🔼' : ''}` : `#${w.rankNext} · stays`}
      </span>
      {w.note && <><br /><span className={w.moved ? 'text-white/60 font-extrabold' : 'text-emerald-300 font-black'}>{w.note}</span></>}
    </>
  );
}

export default function AwardImpactSheet({ data, loading, onClose }: { data: ImpactSheetData; loading: boolean; onClose: () => void }) {
  const proposed = data.mode === 'proposed';
  const single = data.rows.length === 1 ? data.rows[0] : null;
  const total = data.rows.reduce((s, r) => s + r.points, 0);
  const headline = impactHeadline(data.rows);
  const cell = 'bg-white/[0.06] px-2 py-2 align-middle font-extrabold leading-snug';

  return (
    <div
      className="fixed inset-0 z-[68] flex items-end lg:items-center justify-center bg-black/65 backdrop-blur-sm p-3 lg:p-6"
      role="dialog" aria-modal="true" aria-label="What this award changes" onClick={onClose}
    >
      <div className="w-full max-w-md lg:max-w-lg bg-kaya-chocolate text-white rounded-3xl border border-white/15 shadow-2xl p-5 lg:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="text-center">
          <div className="text-3xl" aria-hidden>{proposed ? '📨' : '🎉'}</div>
          <p className="font-display font-black text-[17px] lg:text-xl mt-1">
            {proposed
              ? (single ? 'Sent to your parents!' : `${data.rows.length} awards sent to your parents`)
              : 'Done — it’s in!'}
          </p>
          <p className="text-[12px] lg:text-[13px] text-white/70 font-bold mt-1">
            {data.subtitle}{single ? <> · <b className="text-kaya-gold-light">+{total} HP</b></> : null}{!proposed && data.byName ? ` · by ${first(data.byName)}` : ''}
          </p>
        </div>

        <p className="text-[10px] uppercase tracking-[0.16em] font-extrabold text-kaya-gold-light text-center mt-4 mb-1.5">
          {proposed ? (single ? `If a parent approves, ${first(single.name)} goes…` : 'If approved — Last 7 days · This month') : (single ? `${first(single.name)} goes…` : 'Last 7 days · This month')}
        </p>

        {loading ? (
          <p className="text-center text-[12.5px] text-white/55 italic py-5">Adding it up…</p>
        ) : single ? (
          // S10 / S16 — one child: a row per window.
          <table className="w-full text-[12px] lg:text-[13px] border-separate" style={{ borderSpacing: '0 5px' }}>
            <thead>
              <tr className="text-[9px] uppercase tracking-[0.14em] text-white/50">
                <th className="text-left font-black px-2" /><th className="font-black">{proposed ? 'Now' : 'Was'}</th><th /><th className="font-black">{proposed ? 'New' : 'Now'}</th><th className="text-left font-black px-2">Place</th>
              </tr>
            </thead>
            <tbody>
              {([['Last 7 days', single.week], ['This month', single.month]] as const).map(([label, w]) => (
                <tr key={label}>
                  <td className={`${cell} rounded-l-xl`}>{label}</td>
                  <td className={`${cell} text-center text-white/60`}>{w.now}</td>
                  <td className={`${cell} text-center text-white/45`}>→</td>
                  <td className={`${cell} text-center text-kaya-gold font-black text-[18px]`}>{w.next}</td>
                  <td className={`${cell} rounded-r-xl text-[11px] lg:text-[12px]`}><Place w={w} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          // S11 — the whole podium: a row per child.
          <table className="w-full text-[11.5px] lg:text-[13px] border-separate" style={{ borderSpacing: '0 5px' }}>
            <thead>
              <tr className="text-[9px] uppercase tracking-[0.14em] text-white/50">
                <th /><th className="font-black">7 days</th><th className="font-black">Month</th><th className="text-left font-black px-2">Place</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.childId}>
                  <td className={`${cell} rounded-l-xl`}>{data.medals?.[r.childId] ? `${data.medals[r.childId]} ` : ''}{r.emoji} {first(r.name)} <b className="text-kaya-gold-light">+{r.points}</b></td>
                  <td className={`${cell} text-center`}><span className="text-white/55">{r.week.now} →</span> <b>{r.week.next}</b></td>
                  <td className={`${cell} text-center`}><span className="text-white/55">{r.month.now} →</span> <b>{r.month.next}</b></td>
                  <td className={`${cell} rounded-r-xl text-[11px]`}>
                    <span className={r.week.moved || r.month.moved ? 'text-emerald-300 font-black' : 'text-white/60'}>
                      {r.week.moved ? `#${r.week.rankNow}→#${r.week.rankNext}` : `#${r.week.rankNext}`} · {r.month.moved ? `#${r.month.rankNow}→#${r.month.rankNext}` : `#${r.month.rankNext}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && (headline || single) && (
          <p className="text-[12px] lg:text-[13px] text-center text-[#FBE3A0] font-extrabold mt-3 leading-relaxed">
            {headline && <>{headline}<br /></>}Every point counts.
          </p>
        )}
        {!loading && !single && data.raceLine && <p className="text-[11.5px] text-center text-white/60 font-bold mt-2">{data.raceLine}</p>}
        {proposed && <p className="text-[11px] text-center text-white/50 font-bold mt-2">Not added yet — waiting for a parent. Points count on the day they are approved.</p>}

        <div className="text-center mt-4">
          <button type="button" onClick={onClose} className="h-10 px-6 rounded-xl bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-[13px]">Got it</button>
        </div>
      </div>
    </div>
  );
}
