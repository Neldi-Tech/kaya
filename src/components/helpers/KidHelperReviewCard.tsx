'use client';

// HP2 · "⭐ How was Donald this week?" — the kid's weekly review card +
// flow (Helper Performance 2.0, D10/D11/D12 — approved 2026-08-23).
//
// Renders ONLY in a kid's own session (role === 'kid'), only while the
// review window is open (Fri → Sun), and only for helpers the kid is
// assigned to with kids-review on. One card per helper: Start / Later,
// or "Sent ✓ · you can change it until Sunday". The flow is one scrolling
// screen: 4 face-taps, "One thing you liked", "One thing to change",
// optional note, Send to Mum & Dad 💌. Answers go through the Admin
// gateway — helpers never see them, and the helper isn't told the
// window is open. Renders nothing outside the window or with nothing
// to review, so it costs the page nothing on quiet days.

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { auth } from '@/lib/firebase';
import { FACES } from '@/lib/kidReviewQuestions';

interface PendingHelper {
  uid: string; name: string; first: string; preset: string;
  questions: { id: string; text: string; labels: [string, string, string, string] }[];
  liked: string[]; change: string[];
  existing: { answers: number[]; liked: string[]; change: string[]; note: string; submittedAt: number | null } | null;
}
interface Pending { ok: boolean; open: boolean; weekKey: string; weekLabel: string; closesAt: number | null; kidName: string; helpers: PendingHelper[] }

const PRESET_EMOJI: Record<string, string> = { nanny: '🤱', tutor: '📚', driver: '🚗', gardener: '🌿', grandparent: '👵', security: '🛡️', cleaner: '🧹', cook: '🍲', handyman: '🔧', custom: '🤝' };

export default function KidHelperReviewCard({ className = '' }: { className?: string }) {
  const { profile } = useAuth();
  const [data, setData] = useState<Pending | null>(null);
  const [openFor, setOpenFor] = useState<PendingHelper | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch('/api/helpers/kid-review?mode=pending', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      setData((await res.json()) as Pending);
    } catch { /* quiet */ }
  }, []);
  useEffect(() => {
    if (profile?.role !== 'kid') return;
    load();
  }, [profile?.role, load]);

  if (profile?.role !== 'kid' || !data?.open || data.helpers.length === 0) return null;

  return (
    <div className={className}>
      <div className="space-y-2">
        {data.helpers.map((h) => {
          const done = !!h.existing?.submittedAt;
          return (
            <div key={h.uid} className="rounded-hive-lg border border-[#D9CCFA] bg-[#EFE8FF] p-3.5">
              <p className="font-nunito font-black text-[14px] text-[#2E1F66]">⭐ How was {h.first} this week?</p>
              <p className="text-[11px] text-[#5A4E8A] mt-0.5">
                {done
                  ? <>Sent ✓ · you can change it until Sunday night</>
                  : <>Quick — 4 taps. Only Mum &amp; Dad will see it. Closes Sunday night.</>}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpenFor(h)}
                  className={`h-9 px-4 rounded-hive-pill text-[12px] font-nunito font-black ${done ? 'bg-white text-[#5A3CB8] border-2 border-[#5A3CB8]' : 'bg-[#5A3CB8] text-white'}`}
                >
                  {done ? 'Change my answers' : 'Start'}
                </button>
                {!done && <span className="h-9 px-3 inline-flex items-center text-[11px] text-[#5A4E8A] font-nunito font-extrabold">Later is fine too</span>}
              </div>
            </div>
          );
        })}
      </div>
      {openFor && (
        <ReviewFlow
          helper={openFor}
          weekLabel={data.weekLabel}
          onClose={() => setOpenFor(null)}
          onSent={() => { setOpenFor(null); load(); }}
        />
      )}
    </div>
  );
}

function ReviewFlow({ helper, weekLabel, onClose, onSent }: { helper: PendingHelper; weekLabel: string; onClose: () => void; onSent: () => void }) {
  const [answers, setAnswers] = useState<(number | null)[]>(helper.existing?.answers?.length === 4 ? helper.existing.answers : [null, null, null, null]);
  const [liked, setLiked] = useState<string[]>(helper.existing?.liked ?? []);
  const [change, setChange] = useState<string[]>(helper.existing?.change ?? []);
  const [note, setNote] = useState<string>(helper.existing?.note ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ stars: string } | null>(null);
  const complete = answers.every((a) => a !== null);
  const answered = answers.filter((a) => a !== null).length;

  const toggle = (list: string[], set: (v: string[]) => void, item: string, max = 3) => {
    if (list.includes(item)) set(list.filter((x) => x !== item));
    else if (item === 'nothing!') set(['nothing!']);
    else set([...list.filter((x) => x !== 'nothing!'), item].slice(-max));
  };

  const send = async () => {
    if (!complete) return;
    setSending(true); setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/helpers/kid-review', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ helperUid: helper.uid, answers, liked, change, note }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error === 'window-closed' ? 'The review window has closed for this week — see you Friday!' : 'Could not send. Try again.');
        return;
      }
      setSent({ stars: j.stars ?? '⭐' });
    } catch { setError('Could not send. Try again.'); }
    finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={`Review ${helper.first}`}>
      <div className="bg-hive-paper w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-hive-lg sm:rounded-hive-lg">
        <div className="sticky top-0 bg-gradient-to-br from-[#5A3CB8] to-[#9B5DE5] text-white p-4 flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[2px] font-nunito font-extrabold opacity-85">⭐ {helper.first} · this week</p>
            <h3 className="font-nunito font-black text-xl leading-tight">{sent ? 'Sent to Mum & Dad 💌' : 'Tap how it felt'}</h3>
            <p className="text-[11px] opacity-90 mt-0.5">{sent ? `Thank you! ${sent.stars}` : `${answered} of 4 · no wrong answers · ${weekLabel}`}</p>
          </div>
          <button type="button" onClick={sent ? onSent : onClose} aria-label="Close" className="p-1.5 rounded-full bg-white/15"><X size={18} /></button>
        </div>

        {sent ? (
          <div className="p-5 text-center space-y-3">
            <div className="text-5xl">{PRESET_EMOJI[helper.preset] ?? '🤝'}</div>
            <p className="font-nunito font-black text-lg">{sent.stars}</p>
            <p className="text-[12px] text-hive-muted">Only your parents see this. You can change it until Sunday night.</p>
            <button type="button" onClick={onSent} className="h-10 px-5 rounded-hive-pill bg-[#5A3CB8] text-white text-[13px] font-nunito font-black">Done</button>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {helper.questions.map((q, qi) => (
              <div key={q.id}>
                <p className="font-nunito font-black text-[14px]">{q.text}</p>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {FACES.map((f) => {
                    const on = answers[qi] === f.idx;
                    return (
                      <button
                        key={f.idx}
                        type="button"
                        onClick={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? f.idx : a)))}
                        aria-pressed={on}
                        className={`rounded-2xl border-2 py-2.5 text-center ${on ? 'border-[#7B5CD6] bg-[#EFE8FF]' : 'border-hive-line bg-hive-paper'}`}
                      >
                        <span className="text-3xl leading-none block">{f.emoji}</span>
                        <span className="block text-[10px] font-nunito font-extrabold text-hive-muted mt-1">{q.labels[f.idx]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div>
              <p className="font-nunito font-black text-[14px]">One thing you liked</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {helper.liked.map((c) => (
                  <button key={c} type="button" onClick={() => toggle(liked, setLiked, c)} aria-pressed={liked.includes(c)} className={`h-9 px-3 rounded-hive-pill border-2 text-[12px] font-nunito font-extrabold ${liked.includes(c) ? 'border-[#7B5CD6] bg-[#EFE8FF] text-[#5A3CB8]' : 'border-hive-line bg-hive-paper text-hive-ink'}`}>{c}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="font-nunito font-black text-[14px]">One thing to change</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {helper.change.map((c) => (
                  <button key={c} type="button" onClick={() => toggle(change, setChange, c)} aria-pressed={change.includes(c)} className={`h-9 px-3 rounded-hive-pill border-2 text-[12px] font-nunito font-extrabold ${change.includes(c) ? 'border-[#7B5CD6] bg-[#EFE8FF] text-[#5A3CB8]' : 'border-hive-line bg-hive-paper text-hive-ink'}`}>{c}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="font-nunito font-black text-[14px]">✏️ Anything else? <span className="text-hive-muted font-extrabold text-[11px]">(optional)</span></p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 280))}
                rows={2}
                placeholder="e.g. He waited for me when practice ran late."
                className="mt-2 w-full rounded-hive border border-hive-line bg-hive-paper p-3 text-[13px] focus:outline-none focus:border-[#7B5CD6]"
              />
            </div>
            {error && <p className="text-[12px] text-hive-rose font-bold">{error}</p>}
            <button
              type="button"
              onClick={send}
              disabled={!complete || sending}
              className="w-full h-12 rounded-hive-pill bg-[#5A3CB8] text-white font-nunito font-black text-[14px] disabled:opacity-50"
            >
              {sending ? 'Sending…' : complete ? 'Send to Mum & Dad 💌' : `Tap ${4 - answered} more face${4 - answered === 1 ? '' : 's'}`}
            </button>
            <p className="text-[10px] text-hive-muted text-center">Only your parents see this. {helper.first} is never shown it.</p>
          </div>
        )}
      </div>
    </div>
  );
}
