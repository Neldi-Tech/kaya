'use client';

// Kaya Games — Question of the Day card for My Day.
//
// One shared daily question for the WHOLE family (parents + kids alike).
// Answer it to keep your streak alive — streaks pay Fun-Points, with a bonus
// burst every few days (the family's target, default 3).
//
// 2026-07-19 redesign (Elia-approved mockup):
//   • Header carries the streak pill + a 7-day dot strip (gold = answered)
//     and the lifetime counter "Question #N · never repeats".
//   • Options are equal-height rows with A/B/C/D letter badges, all on one
//     aligned column.
//   • Footer: "N of M answered today" family line + a countdown to the next
//     question (local midnight).
//   • New moments: 🛡️ Streak Shield used · 🩹 streak repaired · 🎂 birthday
//     specials arrive pre-styled from the rotation.
//
// Self-contained and fails safe — if anything is unavailable it renders
// nothing (or skips the affected line).

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getFamilyMembers } from '@/lib/firestore';
import { FUN_EMOJI } from '@/lib/gamesFun';
import {
  ensureQotd, readMyStreak, answeredToday, todayKey,
  answerQotd, type QotdDoc, type QotdStreak, type QotdAnswerResult,
} from '@/lib/qotd';

const LETTERS = ['A', 'B', 'C', 'D'];

/** The last 7 local day-keys, oldest → today. */
function last7Days(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

/** "9h 12m" until the next local midnight. */
function untilMidnight(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(1, Math.round((next.getTime() - now.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function QuestionOfDayCard({ meId }: { meId: string | null }) {
  const { profile } = useAuth();
  const familyId = profile?.familyId;

  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState<QotdDoc | null>(null);
  const [streak, setStreak] = useState<QotdStreak>({ last: '', streak: 0, best: 0, days: [] });
  const [doneToday, setDoneToday] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);

  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QotdAnswerResult | null>(null);
  const [err, setErr] = useState('');

  // 2026-07-19 fix — the fetch is keyed to the LOCAL DAY, and the day key
  // refreshes when the app wakes (visibilitychange) or a minute ticks past
  // midnight. A warm phone / installed PWA no longer shows yesterday's
  // question forever (the root cause of "same question every day").
  const [dayKey, setDayKey] = useState(todayKey());
  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    const check = () => {
      setNowTick(new Date());
      setDayKey((k) => (todayKey() !== k ? todayKey() : k));
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!familyId || !meId) return;
    (async () => {
      const [question, s] = await Promise.all([ensureQotd(familyId), readMyStreak(familyId, meId)]);
      if (cancelled) return;
      setQ(question);
      setStreak(s);
      setDoneToday(answeredToday(s));
      // New day → clear yesterday's answer state so the fresh question is
      // answerable immediately.
      setSelected(null);
      setResult(null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [familyId, meId, dayKey]);

  // Family size for the "N of M answered today" line — one-shot, best-effort.
  useEffect(() => {
    if (!familyId) return;
    getFamilyMembers(familyId)
      .then((m) => setMemberCount(m.filter((x) => (x as { role?: string }).role !== 'guest').length || null))
      .catch(() => {});
  }, [familyId]);

  // 7-day dot strip — answered days in gold. After a fresh answer the server
  // returns the updated history; before that we use the read one.
  const dotDays = useMemo(() => {
    const have = new Set(result?.days ?? streak.days);
    return last7Days().map((d) => ({ d, on: have.has(d) }));
  }, [streak.days, result?.days]);

  if (!familyId || !meId) return null;

  // After a fresh answer, OR if they'd already answered today, the correct
  // choice is revealed (we never hide the learning).
  const revealed = doneToday || result != null;
  const correctIdx = q?.answer ?? -1;
  const streakNow = result?.streak ?? streak.streak;
  const answeredCount = (q?.answeredUids?.length ?? 0) + (result && !result.alreadyAnswered && !q?.answeredUids?.includes(meId) ? 1 : 0);
  const isBirthday = q?.subject === 'birthday';

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
      <div className="px-4 pt-2.5 pb-2 text-white"
        style={{ background: isBirthday ? 'linear-gradient(120deg,#E0563F,#F09B3C)' : 'linear-gradient(120deg,#6B3FE0,#9b6bff)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg">{isBirthday ? '🎂' : '🌟'}</span>
            <span className="font-display font-black text-sm leading-tight truncate">Question of the Day</span>
          </div>
          {streakNow > 0 && (
            <span className="bg-white/20 rounded-full px-2.5 py-0.5 text-xs font-black whitespace-nowrap shrink-0">
              🔥 {streakNow}-day streak
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-85 truncate">
            {typeof q?.serial === 'number' && q.serial > 0 ? `Question #${q.serial} · never repeats` : 'One fresh question · every day'}
          </span>
          <span className="flex gap-[3px] shrink-0" aria-label="Your last 7 days" title="Your last 7 days — gold = answered">
            {dotDays.map((d) => (
              <span key={d.d} className="w-2 h-2 rounded-[3px]" style={{ background: d.on ? '#FFD76A' : 'rgba(255,255,255,.28)' }} />
            ))}
          </span>
        </div>
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
                const base = 'w-full text-left rounded-kaya px-3 py-2.5 text-sm font-bold transition border flex items-center gap-2.5';
                const cls = isCorrect
                  ? 'bg-games-teal/15 border-games-teal text-games-ink'
                  : isWrongPick
                    ? 'bg-rose-50 border-rose-300 text-rose-700'
                    : revealed
                      ? 'bg-games-bg border-transparent text-games-ink-soft opacity-70'
                      : 'bg-games-bg border-transparent text-games-ink hover:border-games-violet active:scale-[0.99]';
                const badge = isCorrect
                  ? 'bg-games-teal text-white'
                  : isWrongPick
                    ? 'bg-rose-400 text-white'
                    : 'bg-white text-games-violet-deep';
                return (
                  <button key={i} type="button" disabled={submitting || revealed} onClick={() => pick(i)} className={`${base} ${cls}`}>
                    <span className={`w-6 h-6 rounded-lg grid place-items-center text-[11px] font-black shrink-0 ${badge}`}>
                      {isCorrect ? '✓' : isWrongPick ? '✕' : submitting && selected === i && !revealed ? '⏳' : LETTERS[i]}
                    </span>
                    <span className="min-w-0">{c}</span>
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
                {result?.shieldUsed && (
                  <div className="rounded-kaya px-3 py-2 mt-2 text-[13px] font-bold bg-sky-50 border border-sky-200 text-sky-800">
                    🛡️ Streak Shield used — yesterday&rsquo;s miss is forgiven. One shield refreshes every week.
                  </div>
                )}
                {result?.repaired && (
                  <div className="rounded-kaya px-3 py-2 mt-2 text-[13px] font-bold bg-amber-50 border border-amber-200 text-amber-800">
                    🩹 Streak restored! An old bug was eating your days — we gave them back.
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
                  <p className="text-[11px] text-games-ink-soft mt-2 text-center">You&rsquo;ve done today&rsquo;s question — new one tomorrow 🌙</p>
                )}
              </div>
            )}

            {/* Family progress + countdown */}
            <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-games-bg">
              <span className="text-[11px] font-bold text-games-violet-deep truncate">
                {answeredCount > 0
                  ? `👨‍👩‍👧‍👦 ${answeredCount}${memberCount ? ` of ${memberCount}` : ''} answered today`
                  : '👨‍👩‍👧‍👦 Be the first to answer today'}
              </span>
              <span className="text-[11px] font-bold text-games-ink-soft whitespace-nowrap shrink-0">
                ⏳ New question in {untilMidnight(nowTick)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
