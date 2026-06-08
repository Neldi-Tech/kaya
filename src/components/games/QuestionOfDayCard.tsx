'use client';

// Kaya Games — Question of the Day card for My Day.
//
// One shared daily question for the WHOLE family (parents + kids alike). Answer
// it to keep your streak alive — streaks pay Fun-Points, with a bonus burst
// every few days (the family's target, default 3). Self-contained: it ensures
// today's question, reads the player's streak, and posts the answer. Fails safe
// — if anything is unavailable it simply renders nothing.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { FUN_EMOJI } from '@/lib/gamesFun';
import {
  ensureQotd, readMyStreak, answeredToday,
  answerQotd, type QotdDoc, type QotdStreak, type QotdAnswerResult,
} from '@/lib/qotd';

export default function QuestionOfDayCard({ meId }: { meId: string | null }) {
  const { profile } = useAuth();
  const familyId = profile?.familyId;

  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState<QotdDoc | null>(null);
  const [streak, setStreak] = useState<QotdStreak>({ last: '', streak: 0, best: 0 });
  const [doneToday, setDoneToday] = useState(false);

  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QotdAnswerResult | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!familyId || !meId) return;
    (async () => {
      const [question, s] = await Promise.all([ensureQotd(familyId), readMyStreak(familyId, meId)]);
      if (cancelled) return;
      setQ(question);
      setStreak(s);
      setDoneToday(answeredToday(s));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [familyId, meId]);

  if (!familyId || !meId) return null;

  // After a fresh answer, OR if they'd already answered today, the correct
  // choice is revealed (we never hide the learning).
  const revealed = doneToday || result != null;
  const correctIdx = q?.answer ?? -1;
  const streakNow = result?.streak ?? streak.streak;

  async function pick(i: number) {
    if (submitting || revealed || !q) return;
    setSelected(i);
    setSubmitting(true);
    setErr('');
    const res = await answerQotd(i);
    if (res.error || res.skipped) {
      setErr('Could not save that — try again.');
      setSelected(null);
      setSubmitting(false);
      return;
    }
    setResult(res);
    setDoneToday(true);
    setSubmitting(false);
  }

  return (
    <div className="rounded-kaya overflow-hidden shadow-[0_4px_14px_rgba(26,18,64,0.08)] mb-3">
      {/* Header */}
      <div className="px-4 py-2.5 flex items-center justify-between text-white"
        style={{ background: 'linear-gradient(120deg,#6B3FE0,#9b6bff)' }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">🌟</span>
          <span className="font-display font-black text-sm leading-tight">Question of the Day</span>
        </div>
        {streakNow > 0 && (
          <span className="bg-white/20 rounded-full px-2.5 py-0.5 text-xs font-black whitespace-nowrap">
            🔥 {streakNow}-day streak
          </span>
        )}
      </div>

      <div className="bg-games-card p-4">
        {loading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-4 w-3/4 rounded bg-games-bg" />
            <div className="h-9 rounded-kaya bg-games-bg" />
            <div className="h-9 rounded-kaya bg-games-bg" />
          </div>
        ) : !q ? null : (
          <>
            {q.context && (
              <span className="inline-block bg-games-bg text-games-violet-deep text-[11px] font-bold rounded-full px-2.5 py-1 mb-2">
                {q.context}
              </span>
            )}
            <p className="font-display font-extrabold text-games-ink text-[15px] leading-snug mb-3">{q.q}</p>

            <div className="flex flex-col gap-2">
              {q.choices.map((c, i) => {
                const isCorrect = revealed && i === correctIdx;
                const isWrongPick = revealed && i === selected && i !== correctIdx;
                const base = 'w-full text-left rounded-kaya px-3 py-2.5 text-sm font-bold transition border';
                const cls = isCorrect
                  ? 'bg-games-teal/15 border-games-teal text-games-ink'
                  : isWrongPick
                    ? 'bg-rose-50 border-rose-300 text-rose-700'
                    : revealed
                      ? 'bg-games-bg border-transparent text-games-ink-soft opacity-70'
                      : 'bg-games-bg border-transparent text-games-ink hover:border-games-violet active:scale-[0.99]';
                return (
                  <button key={i} type="button" disabled={submitting || revealed} onClick={() => pick(i)} className={`${base} ${cls}`}>
                    <span className="inline-flex items-center gap-2">
                      {isCorrect && <span>✅</span>}
                      {isWrongPick && <span>❌</span>}
                      {submitting && selected === i && !revealed && <span className="animate-pulse">⏳</span>}
                      <span>{c}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {err && <p className="text-xs text-rose-600 mt-2 font-semibold">{err}</p>}

            {/* Result / done footer */}
            {revealed && (
              <div className="mt-3">
                {result && (
                  <div className={`rounded-kaya px-3 py-2 text-sm font-extrabold flex items-center justify-between ${result.correct ? 'bg-games-teal/15 text-games-ink' : 'bg-games-bg text-games-ink'}`}>
                    <span>{result.correct ? '✅ Correct!' : '💡 Good try!'}</span>
                    {result.funAwarded ? <span className="text-games-violet-deep">+{result.funAwarded} {FUN_EMOJI}</span> : null}
                  </div>
                )}
                {result?.milestone && (
                  <div className="rounded-kaya px-3 py-2 mt-2 text-sm font-black text-white text-center"
                    style={{ background: 'linear-gradient(120deg,#11C5A8,#6B3FE0)' }}>
                    🎉 {result.streak}-day streak — bonus {FUN_EMOJI}!
                  </div>
                )}
                {q.fact && (
                  <div className="rounded-kaya bg-games-bg px-3 py-2 mt-2">
                    <p className="text-[11px] font-black uppercase tracking-wide text-games-violet-deep mb-0.5">Did you know?</p>
                    <p className="text-[13px] text-games-ink leading-snug">{q.fact}</p>
                  </div>
                )}
                {doneToday && !result && (
                  <p className="text-[11px] text-games-ink-soft mt-2 text-center">You’ve done today’s question — new one tomorrow 🌙</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
