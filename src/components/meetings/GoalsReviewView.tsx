'use client';

// ── Goals Review (Sunday-Meeting v4 · 2026-06-21) ───────────────────────
// An independent tab (next to 📒 My Submissions on My Day + Workplan) with
// two parts:
//   1) "Review last week" — last week's goals, each markable ✓ done / ↻ not
//      yet, each with an optional NOTE (how it went). Saved onto this cycle's
//      submission (goalsReflection); the archive back-fills the prior entry.
//   2) "🎯 Goal Register" — every goal across every meeting, newest first,
//      with its status (✓ accomplished / ↻ carried / · not yet reviewed) and
//      note. A keepsake of the family's goal journey.
// Completing a goal fires a small confetti celebration; "not yet" stays
// gentle and supportive — never shaming.
//
// Self-contained: resolves identity from auth/family context so callers just
// render <GoalsReviewView />.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  getMeetingSubmission, setMeetingSubmission, meetingCycleKey,
} from '@/lib/meetingSubmissions';
import { getMeetingSubmissionHistory, type SubmissionHistoryDoc } from '@/lib/meetingSubmissionHistory';
import { toDisplayDate } from '@/lib/dates';

const PURPLE = '#9B5DE5';
const EMERALD = '#5BA88C';

interface ReviewLine { text: string; done: boolean; note: string }

export default function GoalsReviewView() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const familyId = family?.id;
  const uid = profile?.uid;
  const role = (profile?.role === 'kid' ? 'kid' : profile?.role === 'helper' ? 'helper' : 'parent') as 'kid' | 'parent' | 'helper';
  const scheduleDow = family?.meetingSetup?.schedule?.dayOfWeek;

  // Resolve a kid's childId (can be empty-string — match by email, never [0]).
  const childId = useMemo(() => {
    if (role !== 'kid' || !profile) return undefined;
    const direct = profile.childId?.trim();
    if (direct) return direct;
    const myEmail = profile.email?.toLowerCase() ?? '';
    if (!myEmail) return undefined;
    return (children || []).find((c: { id: string; emailLower?: string; email?: string }) =>
      (c.emailLower || c.email?.toLowerCase() || '') === myEmail)?.id;
  }, [role, profile, children]);

  const name = (profile?.displayName || 'friend').split(' ')[0];
  const avatarEmoji = useMemo(() => {
    if (role === 'kid' && childId) return (children || []).find((c: { id: string; avatarEmoji?: string }) => c.id === childId)?.avatarEmoji;
    return undefined;
  }, [role, childId, children]);

  const [hist, setHist] = useState<SubmissionHistoryDoc | null>(null);
  const [priorGoals, setPriorGoals] = useState<string[]>([]);
  const [review, setReview] = useState<ReviewLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const burstRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!familyId || !uid) return;
    let cancelled = false;
    Promise.all([
      getMeetingSubmissionHistory(familyId, uid).catch(() => null),
      getMeetingSubmission(familyId, uid).catch(() => null),
    ]).then(([h, sub]) => {
      if (cancelled) return;
      setHist(h);
      const latest = h?.entries.find((e) => (e.goals || []).length > 0);
      const goals = (latest?.goals || []).filter(Boolean);
      setPriorGoals(goals);
      // Seed the review: prefer this cycle's saved reflection, else the
      // archived reflection on the latest entry, else blank.
      const fromSub = sub?.goalsReflection;
      setReview(goals.map((g, i) => {
        const r = fromSub?.find((x) => x.text === g) || fromSub?.[i] || latest?.goalsReflection?.[i];
        return { text: g, done: !!r?.done, note: r?.note || '' };
      }));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [familyId, uid]);

  const setLine = (i: number, patch: Partial<ReviewLine>) => {
    setReview((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setSavedAt(null);
  };

  const celebrate = () => {
    const host = burstRef.current;
    if (!host) return;
    const icons = ['🎉', '✨', '🎊', '⭐', '💛'];
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('span');
      s.textContent = icons[i % icons.length];
      s.style.cssText = `position:absolute;left:${Math.random() * 100}%;top:0;font-size:${12 + Math.random() * 12}px;pointer-events:none;animation:gr-fall ${0.9 + Math.random()}s ease-in forwards`;
      host.appendChild(s);
      setTimeout(() => s.remove(), 2000);
    }
  };

  const save = async () => {
    if (!familyId || !uid) return;
    setSaving(true);
    const anyNewlyDone = review.some((l) => l.done);
    try {
      await setMeetingSubmission(familyId, uid, {
        name,
        emoji: avatarEmoji,
        childId,
        role,
        gratitudes: [],
        appreciations: [],
        goals: [],
        goalsReflection: review.map((l) => ({
          text: l.text,
          done: l.done,
          ...(l.note.trim() ? { note: l.note.trim() } : {}),
        })),
        cycleKey: meetingCycleKey(scheduleDow) ?? undefined,
      });
      setSavedAt(Date.now());
      if (anyNewlyDone) celebrate();
    } finally {
      setSaving(false);
    }
  };

  // Goal Register — all goals across history, newest first, with status+note.
  const register = useMemo(() => (hist?.entries || [])
    .flatMap((e) => (e.goals || []).map((g, i) => ({
      date: e.date,
      goal: g,
      done: e.goalsReflection?.[i]?.done,
      note: e.goalsReflection?.[i]?.note,
    })))
    .filter((r) => r.goal), [hist]);

  if (!familyId || !uid) return null;
  if (loading) {
    return <p className="text-center text-[13px] font-extrabold py-8" style={{ color: PURPLE }}>Loading your goals…</p>;
  }

  return (
    <div className="space-y-3" ref={burstRef} style={{ position: 'relative' }}>
      <style>{`@keyframes gr-fall{to{transform:translateY(420px) rotate(540deg);opacity:0}}`}</style>

      {/* ── Review last week ─────────────────────────────────────── */}
      {priorGoals.length > 0 ? (
        <div className="rounded-2xl border-2 p-4" style={{ borderColor: '#E8E0FF', background: 'linear-gradient(180deg,#F8F4FF,#fff)' }}>
          <p className="font-black text-[11px] uppercase tracking-wide" style={{ color: PURPLE }}>
            🔍 How did last week’s goals go?
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: '#5C6975' }}>
            Tap a goal to mark it — add a note either way. Your family hears it at the meeting.
          </p>

          <div className="mt-3 space-y-2.5">
            {review.map((l, i) => (
              <div key={i} className="rounded-xl bg-white border p-2.5" style={{ borderColor: '#F0E8FF' }}>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setLine(i, { done: true })}
                    className="flex-1 rounded-lg py-2 text-[12.5px] font-black border-2 transition-colors"
                    style={l.done
                      ? { background: EMERALD, borderColor: EMERALD, color: '#fff' }
                      : { background: '#fff', borderColor: '#E8E0D4', color: '#3D241A' }}
                  >✓ Did it</button>
                  <button
                    type="button"
                    onClick={() => setLine(i, { done: false })}
                    className="flex-1 rounded-lg py-2 text-[12.5px] font-black border-2 transition-colors"
                    style={!l.done
                      ? { background: '#F6E2B0', borderColor: '#D4A017', color: '#3D241A' }
                      : { background: '#fff', borderColor: '#E8E0D4', color: '#3D241A' }}
                  >↻ Not yet</button>
                </div>
                <p className="text-[13px] font-bold mt-2" style={{ color: '#3D241A' }}>{l.text}</p>
                <textarea
                  value={l.note}
                  onChange={(e) => setLine(i, { note: e.target.value })}
                  placeholder="Add a note — how did it go? What made it hard or easy?"
                  rows={2}
                  className="w-full mt-2 rounded-lg border px-2.5 py-2 text-[12.5px] resize-none"
                  style={{ borderColor: '#E8E0D4', background: '#FCFAF5', color: '#3D241A' }}
                />
                {!l.done && (
                  <p className="text-[10.5px] mt-1" style={{ color: '#B8860B' }}>↻ Carried to next week — you’ve got this 💪</p>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-10 px-5 rounded-full text-[12.5px] font-extrabold text-white transition-colors disabled:opacity-50"
              style={{ background: PURPLE }}
            >
              {saving ? 'Saving…' : savedAt ? '✓ Saved' : 'Save review'}
            </button>
            {savedAt && !saving && (
              <span className="text-[10.5px] font-bold" style={{ color: EMERALD }}>🎉 Saved — shows in the meeting.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border-2 p-5 text-center" style={{ borderColor: '#F0E8FF', background: '#fff' }}>
          <div className="text-3xl mb-1">🎯</div>
          <p className="font-black text-[14px]" style={{ color: '#2D1B5E' }}>No goals to review yet</p>
          <p className="text-[12px] mt-1" style={{ color: '#5C6975' }}>
            Set a goal in your meeting prep — next week you’ll review it here and mark how it went.
          </p>
        </div>
      )}

      {/* ── Goal Register ────────────────────────────────────────── */}
      {register.length > 0 && (
        <div className="rounded-2xl border-2 p-4" style={{ borderColor: '#E8E0FF', background: 'linear-gradient(180deg,#F5F0FF,#fff)' }}>
          <p className="font-black text-[11px] uppercase tracking-wide mb-3" style={{ color: PURPLE }}>
            🎯 Goal Register
          </p>
          <div className="space-y-2">
            {register.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black ${
                  r.done === true ? 'bg-emerald-100 text-emerald-600' :
                  r.done === false ? 'bg-amber-100 text-amber-500' :
                  'bg-white/60 text-[#9B8A72] border border-dashed border-[#9B8A72]/40'
                }`}>
                  {r.done === true ? '✓' : r.done === false ? '↻' : '·'}
                </span>
                <div className="flex-1 min-w-0">
                  <div>
                    <span className={`text-[12.5px] leading-snug ${r.done ? 'line-through text-[#9B8A72]' : ''}`} style={{ color: r.done ? undefined : '#3D241A' }}>
                      {r.goal}
                    </span>
                    <span className="ml-1.5 text-[10px]" style={{ color: '#9B8A72' }}>
                      {toDisplayDate(r.date) || r.date}
                    </span>
                  </div>
                  {r.note && (
                    <p className="text-[11.5px] italic mt-0.5" style={{ color: '#7C6A52' }}>“{r.note}”</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px]" style={{ color: '#9B8A72' }}>
            ✓ accomplished · ↻ carried · · not yet reviewed
          </p>
        </div>
      )}
    </div>
  );
}
