'use client';

// 🗓️ Recognition Hit-Map (RR PR-3) — the parent rhythm, loud.
//
// Same bones as the Reflection Hit-Map: Week / Month / 3-mo / Custom, a
// compact calendar where every cell tells the story at a glance —
//   🟩 green  = a Shine Card was given that day (✨ marks spontaneous,
//               non-round days — every act of noticing paints)
//   🟨 gold   = 🤝 Double Shine day (both parents celebrated one kid)
//   🟥 red    = a round fired and 72h passed with no celebration
//   ⏳ cream  = a round fired and is still within its 72h window
//   cream     = no round scheduled that day
// Green/gold days OPEN: the day sheet lists what was provided (award
// type, category, giver, card №) and any parent can ＋ add a note to a
// card — even weeks later (📝 corner mark on days that carry notes).
// Counters: cards this week · 🔥 answered-round streak · per-parent split.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  listShineCards, listRounds, addShineCardNote,
  type ShineCard, type RecognitionRound,
} from '@/lib/shineCards';
import { toDisplayDate } from '@/lib/dates';

type View = 'week' | 'month' | '3mo' | 'custom';

const dayKeyLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function RecognitionHitMap() {
  const { profile } = useAuth();
  const familyId = profile?.familyId;

  const [cards, setCards] = useState<ShineCard[]>([]);
  const [rounds, setRounds] = useState<RecognitionRound[]>([]);
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [customFrom, setCustomFrom] = useState(() => dayKeyLocal(new Date(Date.now() - 29 * 86400_000)));
  const [customTo, setCustomTo] = useState(() => dayKeyLocal(new Date()));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useMemo(() => async () => {
    if (!familyId) return;
    const [c, r] = await Promise.all([
      listShineCards(familyId).catch(() => [] as ShineCard[]),
      listRounds(familyId).catch(() => [] as RecognitionRound[]),
    ]);
    setCards(c); setRounds(r);
  }, [familyId]);
  useEffect(() => { void reload(); }, [reload]);

  // ── Day classification ──────────────────────────────────────────
  const cardsByDay = useMemo(() => {
    const m = new Map<string, ShineCard[]>();
    for (const c of cards) {
      const k = dayKeyLocal(new Date(c.at));
      m.set(k, [...(m.get(k) || []), c]);
    }
    return m;
  }, [cards]);
  const roundDays = useMemo(() => new Set(rounds.map((r) => r.date)), [rounds]);

  const answeredRound = useMemo(() => (date: string): boolean => {
    // A round is "answered" when any Shine Card lands within 72h of it.
    const start = new Date(`${date}T00:00:00`).getTime();
    const end = start + 72 * 3600_000;
    return cards.some((c) => c.at >= start && c.at < end);
  }, [cards]);

  const todayKey = dayKeyLocal(new Date());
  const classify = (date: string): { cls: string; mark: string } => {
    const dayCards = cardsByDay.get(date) || [];
    const hasNotes = dayCards.some((c) => (c.notes?.length || 0) > 0);
    const noteMark = hasNotes ? '📝' : '';
    if (dayCards.length > 0) {
      if (dayCards.some((c) => c.doubleShine)) return { cls: 'gold', mark: noteMark || '🤝' };
      return { cls: 'green', mark: noteMark || (roundDays.has(date) ? '⭐' : '✨') };
    }
    if (roundDays.has(date)) {
      const roundStart = new Date(`${date}T00:00:00`).getTime();
      const windowOpen = Date.now() < roundStart + 72 * 3600_000;
      if (answeredRound(date)) return { cls: 'green', mark: '⭐' };
      return windowOpen ? { cls: 'off', mark: '⏳' } : { cls: 'red', mark: '' };
    }
    return date > todayKey ? { cls: 'future', mark: '' } : { cls: 'off', mark: '' };
  };

  // ── Counters ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const now = new Date();
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0);
    const weekCards = cards.filter((c) => c.at >= monday.getTime());
    const byGiver = new Map<string, number>();
    for (const c of weekCards) byGiver.set(c.byName, (byGiver.get(c.byName) || 0) + 1);
    // 🔥 consecutive answered rounds (skip rounds still in their window).
    let streak = 0;
    for (const r of [...rounds].sort((a, b) => b.date.localeCompare(a.date))) {
      const start = new Date(`${r.date}T00:00:00`).getTime();
      if (Date.now() < start + 72 * 3600_000 && !answeredRound(r.date)) continue;
      if (answeredRound(r.date)) streak++;
      else break;
    }
    return {
      weekCount: weekCards.length,
      streak,
      split: [...byGiver.entries()].map(([n, c]) => `${n} ${c}`).join(' · ') || '—',
    };
  }, [cards, rounds, answeredRound]);

  // ── Visible day range per view ──────────────────────────────────
  const days: string[] = useMemo(() => {
    const list: string[] = [];
    const push = (from: Date, to: Date) => {
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) list.push(dayKeyLocal(d));
    };
    if (view === 'week') {
      const now = new Date();
      const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      push(monday, sunday);
    } else if (view === 'month') {
      const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      push(from, to);
    } else if (view === '3mo') {
      const from = new Date(anchor.getFullYear(), anchor.getMonth() - 2, 1);
      const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      push(from, to);
    } else {
      const from = new Date(`${customFrom}T00:00:00`);
      const to = new Date(`${customTo}T00:00:00`);
      if (from <= to && (to.getTime() - from.getTime()) / 86400_000 <= 200) push(from, to);
    }
    return list;
  }, [view, anchor, customFrom, customTo]);

  // Leading blanks so the grid starts on Monday.
  const leadingBlanks = useMemo(() => {
    if (days.length === 0) return 0;
    const first = new Date(`${days[0]}T00:00:00`);
    return (first.getDay() + 6) % 7;
  }, [days]);

  const monthLabel = view === '3mo'
    ? `${new Date(anchor.getFullYear(), anchor.getMonth() - 2, 1).toLocaleDateString('en-GB', { month: 'short' })} – ${anchor.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
    : anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const CLS: Record<string, string> = {
    green: 'bg-[#A9D9B4] text-[#1d4a2a] cursor-pointer shadow-[inset_0_0_0_1.5px_#7fc290]',
    gold: 'bg-gradient-to-br from-[#F3D06A] to-[#D4A017] text-[#5c4102] cursor-pointer',
    red: 'bg-[#F9D9D4] text-[#a34335]',
    off: 'bg-[#F4F0E8] text-[#c9c0ae]',
    future: 'bg-white border border-dashed border-kaya-warm-dark text-[#c9c0ae]',
  };

  const openCards = openDay ? (cardsByDay.get(openDay) || []) : [];

  return (
    <div className="space-y-3">
      {/* Counters */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-kaya-warm rounded-kaya-sm p-2.5 text-center">
          <p className="font-display font-black text-lg">{stats.weekCount}</p>
          <p className="text-[8.5px] uppercase tracking-wider font-bold text-kaya-sand">Cards this week</p>
        </div>
        <div className="bg-kaya-warm rounded-kaya-sm p-2.5 text-center">
          <p className="font-display font-black text-lg">🔥 {stats.streak}</p>
          <p className="text-[8.5px] uppercase tracking-wider font-bold text-kaya-sand">Rounds answered in a row</p>
        </div>
        <div className="bg-kaya-warm rounded-kaya-sm p-2.5 text-center">
          <p className="font-display font-black text-[12px] leading-tight mt-1 truncate">{stats.split}</p>
          <p className="text-[8.5px] uppercase tracking-wider font-bold text-kaya-sand mt-0.5">This week — who gave</p>
        </div>
      </div>

      {/* View toggles + month nav */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(['week', 'month', '3mo', 'custom'] as const).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)}
            className={`px-2.5 py-1.5 rounded-full text-[10.5px] font-extrabold border ${view === v ? 'bg-kaya-chocolate text-white border-transparent' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}>
            {v === 'week' ? 'Week' : v === 'month' ? 'Month' : v === '3mo' ? '3 mo' : 'Custom'}
          </button>
        ))}
        {(view === 'month' || view === '3mo') && (
          <span className="ml-auto flex items-center gap-2 text-[12px] font-black">
            <button type="button" onClick={() => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1))} className="px-1.5 text-kaya-sand">‹</button>
            {monthLabel}
            <button type="button" onClick={() => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1))} className="px-1.5 text-kaya-sand">›</button>
          </span>
        )}
        {view === 'custom' && (
          <span className="ml-auto flex items-center gap-1.5">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 px-2 rounded-kaya-sm border border-kaya-warm-dark text-[11px] font-bold bg-white" />
            <span className="text-[11px] text-kaya-sand font-bold">→</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 px-2 rounded-kaya-sm border border-kaya-warm-dark text-[11px] font-bold bg-white" />
          </span>
        )}
      </div>

      {/* The map */}
      <div>
        <div className="grid grid-cols-7 gap-[5px] max-w-[300px]">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => (
            <span key={`${l}${i}`} className="text-[9px] font-extrabold text-kaya-sand text-center uppercase">{l}</span>
          ))}
          {Array.from({ length: leadingBlanks }, (_, i) => <span key={`b${i}`} />)}
          {days.map((date) => {
            const { cls, mark } = classify(date);
            const tappable = (cardsByDay.get(date) || []).length > 0;
            return (
              <button
                key={date}
                type="button"
                disabled={!tappable}
                onClick={() => { setOpenDay(date); setNoteFor(null); setNoteText(''); }}
                className={`relative h-[30px] rounded-[7px] text-[10px] font-extrabold flex items-center justify-center ${CLS[cls]} ${date === todayKey ? 'outline outline-2 outline-[#6B3FE0] outline-offset-1' : ''}`}
                title={date}
              >
                {parseInt(date.slice(8), 10)}
                {mark && <span className="absolute -top-1 -right-1 text-[8px]">{mark}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex gap-3 flex-wrap mt-2.5 text-[10px] font-bold text-kaya-sand">
          <span><span className="inline-block w-2.5 h-2.5 rounded-[3px] bg-[#A9D9B4] align-[-1px]" /> celebrated ⭐/✨</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-[3px] bg-gradient-to-br from-[#F3D06A] to-[#D4A017] align-[-1px]" /> 🤝 Double Shine</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-[3px] bg-[#F9D9D4] align-[-1px]" /> round missed</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-[3px] bg-[#F4F0E8] align-[-1px]" /> quiet day</span>
        </div>
      </div>

      {/* Day sheet */}
      {openDay && (
        <div className="rounded-kaya border-[1.5px] border-[#7fc290] bg-[#F4FBF6] p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-[12.5px] font-black flex-1">⭐ {toDisplayDate(openDay) || openDay} · {openCards.length} recognition{openCards.length === 1 ? '' : 's'}</p>
            <button type="button" onClick={() => setOpenDay(null)} className="text-kaya-sand font-black px-1">×</button>
          </div>
          {openCards.map((c) => (
            <div key={c.id} className="py-2 border-b border-dashed border-[#bfe3cb] last:border-b-0">
              <p className="text-[12.5px] font-bold">
                {c.kidEmoji} {c.kidName} · {c.pointsLabel}
                {c.category && <span className="ml-1.5 px-2 py-0.5 rounded-full bg-white border border-[#bfe3cb] text-[9.5px] font-extrabold text-kaya-sand">{c.category}</span>}
              </p>
              <p className="text-[11.5px] italic text-[#4a6b55] mt-0.5">&ldquo;{c.quote}&rdquo; — {c.byName} · 🌟 Card №{c.n}{c.doubleShine ? ' · 🤝' : ''}</p>
              {(c.notes || []).map((nte, i) => (
                <p key={i} className="text-[11px] mt-1 bg-white border border-dashed border-[#bfe3cb] rounded-lg px-2.5 py-1.5">
                  📝 <b>Note:</b> {nte.text} <span className="text-[#7fa78c]">— {nte.byName}</span>
                </p>
              ))}
              {noteFor === c.id ? (
                <div className="flex gap-2 mt-1.5">
                  <input value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={300} autoFocus
                    placeholder="Add context to this memory…"
                    className="flex-1 h-8 px-2.5 rounded-kaya-sm border border-[#bfe3cb] text-[11.5px] bg-white focus:outline-none" />
                  <button type="button" disabled={busy || !noteText.trim()}
                    onClick={async () => {
                      if (!familyId) return;
                      setBusy(true);
                      try { await addShineCardNote(familyId, c.id, noteText); setNoteFor(null); setNoteText(''); await reload(); }
                      catch { /* keep text for retry */ }
                      setBusy(false);
                    }}
                    className="h-8 px-3 rounded-kaya-sm bg-kaya-gold text-white text-[11px] font-black disabled:opacity-50">Add</button>
                </div>
              ) : (
                <button type="button" onClick={() => { setNoteFor(c.id); setNoteText(''); }}
                  className="text-[11px] font-extrabold mt-1" style={{ color: '#1d6b3c' }}>＋ add a note</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
