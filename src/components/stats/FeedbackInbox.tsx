'use client';

// 📬 Feedback — the kid's in-app Heat Reports (Points Emails 2.0, approved
// 23-Aug-2026, E6 / D3). Same card as the email, as a list inside My Stats:
// every routine rating (🔥 heat row · tally · reasons · 🌱 focus) and every
// award (reason card), newest first, with the kid's reflection inline
// (existing /api/stats/reflection — freeze-after-meeting unchanged).
//
// Why here: My Stats already holds the ratings, the parent notes and the
// reflection writer; this is a second VIEW of that data, not a new store.
// "Kids can see this feedback" holds with or without an email pointer.
//
// • Reasons obey the family's "Include your reasons" switch for kids;
//   parents always see them (it's their own note).
// • Tone follows pointsMode for kids (encouragement → 🌱 Growing, no score;
//   badges-only → no numbers).
// • Unread dot = device-local "seen" stamp (localStorage) — no write path.
// • ?reflect=<ratingId> (from the email's 💭 button) opens that card.

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import type { DailyRating, Award, Routine, RatingValue } from '@/lib/firestore';
import { toDisplayDate } from '@/lib/dates';

type PointsMode = 'full' | 'badges-only' | 'encouragement';

interface Props {
  childId: string;
  kidFirst: string;
  routines: Routine[];
  ratings: DailyRating[];
  awards: Award[];
  pointsMode: PointsMode;
  isKid: boolean;
  includeReasons: boolean;
  canReflect: boolean;
  openRatingId?: string | null;
  onReflectionSaved?: (ratingId: string, routineId: string, text: string) => void;
}

const TONE = {
  ex: { bg: '#E3F5EA', bd: '#BFE6CC', fg: '#2E9E5B', t: '🌟' },
  gd: { bg: '#FFF3CC', bd: '#F1DD98', fg: '#9A7300', t: '👍' },
  bd: { bg: '#FDE8EC', bd: '#F3C0C9', fg: '#B8434F', t: '👎' },
  gr: { bg: '#FFF0E0', bd: '#F5D3AE', fg: '#B86A1C', t: '🌱' },
  sk: { bg: '#F1EEE6', bd: '#DDD7CA', fg: '#B8B2A4', t: '—' },
};
type ToneKey = keyof typeof TONE;
const toneOf = (v: RatingValue | undefined, kidMode: PointsMode | null): ToneKey =>
  v === 'excellent' ? 'ex' : v === 'good' ? 'gd' : v === 'bad' ? (kidMode === 'encouragement' ? 'gr' : 'bd') : 'sk';

const seenKey = (childId: string) => `kayaFeedbackSeen:${childId}`;

type Item =
  | { kind: 'rating'; id: string; at: number; r: DailyRating }
  | { kind: 'award'; id: string; at: number; a: Award };

export default function FeedbackInbox(p: Props) {
  const kidMode: PointsMode | null = p.isKid ? p.pointsMode : null;
  const showNumbers = !p.isKid || p.pointsMode === 'full';
  const showReasons = !p.isKid || p.includeReasons;

  const [open, setOpen] = useState<string | null>(p.openRatingId || null);
  const [seenAt, setSeenAt] = useState<number>(0);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftTask, setDraftTask] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Device-local unread stamp.
  useEffect(() => {
    try { setSeenAt(Number(localStorage.getItem(seenKey(p.childId)) || 0)); } catch { /* ignore */ }
  }, [p.childId]);
  const markSeen = () => {
    const now = Date.now();
    setSeenAt(now);
    try { localStorage.setItem(seenKey(p.childId), String(now)); } catch { /* ignore */ }
  };
  useEffect(() => { if (p.openRatingId) setOpen(p.openRatingId); }, [p.openRatingId]);
  // Scroll the deep-linked card into view once it exists.
  useEffect(() => {
    if (!p.openRatingId) return;
    const el = document.getElementById(`feedback-${p.openRatingId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [p.openRatingId, p.ratings.length]);

  const items: Item[] = useMemo(() => {
    const tsOf = (x: { createdAt?: unknown }, fallbackDate?: string): number => {
      const c = x.createdAt as { toMillis?: () => number; seconds?: number } | undefined;
      if (c?.toMillis) return c.toMillis();
      if (c?.seconds) return c.seconds * 1000;
      return fallbackDate ? new Date(`${fallbackDate}T12:00:00`).getTime() : 0;
    };
    const rs: Item[] = p.ratings.filter((r) => r.childId === p.childId).map((r) => ({ kind: 'rating', id: r.id, at: tsOf(r, r.date), r }));
    const as: Item[] = p.awards.filter((a) => a.childId === p.childId && ((a.points || 0) > 0 || a.kind === 'kudos')).map((a) => ({ kind: 'award', id: a.id, at: tsOf(a), a }));
    return [...rs, ...as].sort((x, y) => y.at - x.at).slice(0, 40);
  }, [p.ratings, p.awards, p.childId]);

  const unread = items.filter((i) => i.at > seenAt).length;
  const visible = showAll ? items : items.slice(0, 5);

  if (items.length === 0) return null;

  const routineOf = (id: string) => p.routines.find((r) => r.id === id);
  const taskRows = (r: DailyRating) => Object.entries(r.ratings || {}).map(([rid, v]) => {
    const rt = routineOf(rid);
    return { id: rid, icon: rt?.icon || '•', label: rt?.label || rid, v, note: (r.ratingNotes?.[rid] || '').trim(),
      pts: v === 'excellent' ? (rt?.pointsExcellent ?? 2) : v === 'good' ? (rt?.pointsGood ?? 1) : 0 };
  });
  const scoreOf = (r: DailyRating) => {
    let e = 0, m = 0;
    for (const t of taskRows(r)) { if (t.v === 'skip') continue; const rt = routineOf(t.id); e += t.pts; m += Math.max(rt?.pointsExcellent ?? 2, rt?.pointsGood ?? 1, rt?.pointsBad ?? 0); }
    return m > 0 ? Math.round((e / m) * 100) : null;
  };

  async function saveReflection(ratingId: string, routineId: string) {
    if (!routineId) { setMsg('Pick a task first.'); return; }
    setBusy(true); setMsg('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/stats/reflection', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ratingId, routineId, text: draft }),
      });
      if (res.status === 409) setMsg('🔒 This week already met — the record is frozen now.');
      else if (!res.ok) setMsg('Could not save — try again.');
      else { setMsg('✅ Saved — your family sees it in their next report.'); p.onReflectionSaved?.(ratingId, routineId, draft); }
    } catch { setMsg('Could not save — try again.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand flex-1">
          📬 {p.isKid ? 'My feedback' : `${p.kidFirst}’s feedback`}
          {unread > 0 && <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[9.5px] font-black text-white" style={{ background: '#E06A7B' }}>{unread} new</span>}
        </p>
        {unread > 0 && <button type="button" onClick={markSeen} className="text-[10.5px] font-bold text-kaya-sand">Mark all read</button>}
      </div>
      <div className="space-y-2">
        {visible.map((it) => {
          const isOpen = open === it.id;
          const fresh = it.at > seenAt;
          if (it.kind === 'award') {
            const a = it.a;
            const diamond = a.kind === 'diamond';
            return (
              <div key={it.id} id={`feedback-${it.id}`} className="relative border border-kaya-warm-dark rounded-kaya-sm p-2.5">
                {fresh && <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: '#E06A7B' }} />}
                <p className="text-[12.5px] font-extrabold">{diamond ? '💎' : a.kind === 'kudos' ? '👏' : '🎖️'} {a.kind === 'kudos' ? 'Kudos' : `+${a.points} bonus`}{a.category ? ` · ${a.category}` : ''}</p>
                <p className="text-[10.5px] text-kaya-sand font-bold">from {(a.awardedByName || 'family').split(' ')[0]} · {toDisplayDate(new Date(it.at).toISOString().slice(0, 10))}</p>
                {a.reason && showReasons && <p className="text-[11.5px] mt-1 leading-snug" style={{ color: '#3B3430' }}>“{a.reason}”</p>}
              </div>
            );
          }
          const r = it.r;
          const tasks = taskRows(r);
          const tally = { ex: 0, gd: 0, bd: 0 };
          tasks.forEach((t) => { if (t.v === 'excellent') tally.ex++; else if (t.v === 'good') tally.gd++; else if (t.v === 'bad') tally.bd++; });
          const score = scoreOf(r);
          const bads = tasks.filter((t) => t.v === 'bad');
          const focus = (bads.length ? bads : tasks.filter((t) => t.v === 'good'))[0];
          const reasons = tasks.filter((t) => t.note).sort((x, y) => (x.v === 'bad' ? 0 : 1) - (y.v === 'bad' ? 0 : 1));
          const myRefl = Object.entries(r.reflections || {}).filter(([, v]) => v?.text);
          return (
            <div key={it.id} id={`feedback-${it.id}`} className={`relative border rounded-kaya-sm p-2.5 ${isOpen ? 'border-kaya-gold bg-kaya-gold/5' : 'border-kaya-warm-dark'}`}>
              {fresh && <span className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: '#E06A7B' }} />}
              <button type="button" className="w-full text-left" onClick={() => {
                const next = isOpen ? null : it.id;
                setOpen(next); setMsg('');
                if (next) { setDraftTask(focus?.id || tasks[0]?.id || ''); const ex = myRefl.find(([rid]) => rid === (focus?.id || tasks[0]?.id)); setDraft(ex?.[1]?.text || ''); }
              }}>
                <p className="text-[12.5px] font-extrabold pr-4">
                  {r.period === 'morning' ? '☀️' : '🌙'} {toDisplayDate(r.date)} {r.period}{showNumbers ? ` · +${r.totalPoints}` : ''}{showNumbers && score != null ? ` · ${score}%` : ''}
                </p>
                <p className="text-[10.5px] text-kaya-sand font-bold">rated by {(r.ratedByName || 'family').split(' ')[0]}{myRefl.length ? ' · 💭 you replied' : ''}</p>
                <div className="flex gap-[3px] mt-1.5">
                  {tasks.map((t) => <span key={t.id} title={t.label} className="flex-1 h-2.5 rounded-[3px]" style={{ background: TONE[toneOf(t.v, kidMode)].fg }} />)}
                </div>
                {!isOpen && reasons.length > 0 && showReasons && (
                  <p className="text-[11px] mt-1.5 leading-snug truncate" style={{ color: '#3B3430' }}>
                    {reasons.slice(0, 2).map((t) => `${TONE[toneOf(t.v, kidMode)].t} ${t.label} — “${t.note}”`).join(' · ')}
                  </p>
                )}
              </button>
              {isOpen && (
                <div className="mt-2.5">
                  <div className="grid grid-cols-4 gap-1">
                    {tasks.map((t) => { const c = TONE[toneOf(t.v, kidMode)]; return (
                      <div key={t.id} className="rounded-lg p-1.5 text-center" style={{ background: c.bg, border: `1px solid ${c.bd}` }}>
                        <div className="text-[15px] leading-none">{t.icon}</div>
                        <div className="text-[9px] font-bold leading-tight mt-0.5 truncate">{t.label}</div>
                        <div className="text-[9.5px] font-black mt-0.5" style={{ color: c.fg }}>{showNumbers ? (t.v === 'skip' ? '—' : `+${t.pts}`) : c.t}</div>
                      </div>
                    ); })}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {tally.ex > 0 && <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: TONE.ex.bg, color: TONE.ex.fg }}>🌟 {tally.ex} excellent</span>}
                    {tally.gd > 0 && <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: TONE.gd.bg, color: TONE.gd.fg }}>👍 {tally.gd} good</span>}
                    {tally.bd > 0 && <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: TONE[toneOf('bad', kidMode)].bg, color: TONE[toneOf('bad', kidMode)].fg }}>{TONE[toneOf('bad', kidMode)].t} {tally.bd} {kidMode === 'encouragement' ? 'growing' : 'needs work'}</span>}
                  </div>
                  {showReasons && reasons.length > 0 && (
                    <div className="mt-2.5">
                      <p className="text-[10.5px] font-black">🗒️ {p.isKid ? `${(r.ratedByName || 'Family').split(' ')[0]}’s notes` : 'The reasons'}</p>
                      {reasons.map((t) => (
                        <div key={t.id} className="mt-1 pl-2 py-1 rounded-r-lg" style={{ borderLeft: `3px solid ${TONE[toneOf(t.v, kidMode)].fg}`, background: '#FFFDF7' }}>
                          <p className="text-[11px] font-extrabold">{TONE[toneOf(t.v, kidMode)].t} {t.icon} {t.label}</p>
                          <p className="text-[11px] leading-snug" style={{ color: '#3B3430' }}>“{t.note}”</p>
                        </div>
                      ))}
                      {r.comment && !p.isKid && <p className="text-[11px] italic mt-1.5" style={{ color: '#3B3430' }}>“{r.comment}”</p>}
                    </div>
                  )}
                  {focus && (
                    <div className="mt-2.5 rounded-lg px-2.5 py-1.5" style={{ background: 'linear-gradient(135deg,#FFF4D6,#FFE9B3)', border: '1px solid #F1DD98' }}>
                      <p className="text-[11px] font-extrabold">🎯 {p.isKid ? 'Tomorrow’s one thing' : 'Tomorrow’s focus'}: {focus.icon} {focus.label}{showReasons && focus.note ? ` — ${focus.note}` : ''}</p>
                    </div>
                  )}
                  {myRefl.length > 0 && (
                    <div className="mt-2.5">
                      <p className="text-[10.5px] font-black">💭 {p.isKid ? 'My side' : `${p.kidFirst}’s side`}</p>
                      {myRefl.map(([rid, v]) => (
                        <p key={rid} className="text-[11px] mt-0.5 leading-snug" style={{ color: '#3B3430' }}><b>{routineOf(rid)?.icon} {routineOf(rid)?.label || rid}:</b> “{v!.text}” <span className="text-kaya-sand">— {v!.byName}</span></p>
                      ))}
                    </div>
                  )}
                  {p.canReflect && (
                    <div className="mt-2.5 rounded-xl p-2.5" style={{ background: '#F5F0FF', border: '1px solid #E0D4FF' }}>
                      <p className="text-[9.5px] font-black uppercase tracking-wider" style={{ color: '#6B3FE0' }}>💭 {p.isKid ? 'Tell your side' : 'Add a note'}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tasks.filter((t) => t.v !== 'skip').map((t) => (
                          <button key={t.id} type="button" onClick={() => { setDraftTask(t.id); setDraft(r.reflections?.[t.id]?.text || ''); }}
                            className={`px-2 py-0.5 rounded-full text-[10.5px] font-extrabold ${draftTask === t.id ? 'bg-kaya-chocolate text-white' : 'bg-white border border-kaya-warm-dark text-kaya-sand'}`}>
                            {t.icon} {t.label}
                          </button>
                        ))}
                      </div>
                      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={400}
                        placeholder={p.isKid ? 'Was something in the way? What will you try tomorrow?' : 'A note for the record…'}
                        className="mt-1.5 w-full text-[12px] p-2 rounded-lg border border-kaya-warm-dark bg-white focus:outline-none focus:ring-2 focus:ring-kaya-gold/40" />
                      <div className="flex items-center gap-2 mt-1.5">
                        <button type="button" disabled={busy} onClick={() => void saveReflection(r.id, draftTask)}
                          className="px-3 py-1.5 rounded-full text-[11px] font-black text-white disabled:opacity-50" style={{ background: '#6B3FE0' }}>
                          {busy ? 'Saving…' : 'Save'}
                        </button>
                        {msg && <span className="text-[10.5px] font-bold text-kaya-sand">{msg}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {items.length > 5 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-[11px] font-extrabold text-kaya-sand">
          {showAll ? 'Show less' : `Show all ${items.length} ›`}
        </button>
      )}
      <p className="text-[10px] text-kaya-sand mt-2 leading-relaxed">
        {p.isKid ? 'Every routine rating and award lands here — the same colours as your emails. Tap one to see the notes and tell your side.' : 'What the kid sees (notes follow the “Include your reasons” switch). Replies land in your next Heat Report and in Reports → Behaviour.'}
      </p>
    </section>
  );
}
