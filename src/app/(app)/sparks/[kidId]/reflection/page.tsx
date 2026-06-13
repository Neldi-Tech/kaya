'use client';

// Kaya Sparks · Daily Reflection (/sparks/[kidId]/reflection).
//
// 7th Sparks area (2026-06-07). Scan-first: the kid writes how their
// school day went BY HAND and scans the page — Claude reads the
// handwriting (/api/sparks/ai/extract, kind:'reflection') — confirms the
// text, saves it, then Kaya gives warm STRUCTURED feedback
// (/api/sparks/ai/reflect). Typing is a secondary path the parent gates
// per-kid + per-weekday. A school-day-aware streak proves consistency.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useLocale } from '@/lib/useLocale';
import { subscribeToSparksProfile } from '@/lib/sparks/firestore';
import { uploadSparksPhoto } from '@/lib/sparks/uploadPhoto';
import type { SparksProfile } from '@/lib/sparks/schema';
import {
  type ReflectionEntry, type ReflectionFeedback, type ReflectionAIRead,
  reflectionDayKey, readReflectionSettings, typingAllowedOn,
  subscribeToReflection, subscribeToReflections,
  saveReflection, saveReflectionFeedback, saveReflectionAIRead,
  computeReflectionStreak,
  maybeAwardStreakMilestone, type StreakAwardResult,
  subscribeToWeeklyReviews,
} from '@/lib/sparks/reflection';
import type { ReflectionWeekReview } from '@/lib/sparks/schema';
import { toDisplayDate } from '@/lib/dates';
import AreaScreen from '@/components/sparks/AreaScreen';
import CelebrationBurst from '@/components/sparks/CelebrationBurst';

const VIOLET = '#5A3CB8';

// Read a File → base64 (no data: prefix) for the extract API.
function fileToBase64(file: File): Promise<{ b64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const comma = s.indexOf(',');
      resolve({ b64: comma >= 0 ? s.slice(comma + 1) : s, mime: file.type || 'image/jpeg' });
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function ReflectionPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const { profile: authProfile } = useAuth();
  const { children } = useFamily();
  const familyId = authProfile?.familyId;
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);
  const kidName = kid?.name || 'Kid';
  const sw = useLocale() === 'sw';

  const today = reflectionDayKey();
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [todayEntry, setTodayEntry] = useState<ReflectionEntry | null>(null);
  const [recent, setRecent] = useState<ReflectionEntry[]>([]);

  // Draft state
  const [draft, setDraft] = useState('');
  const [scanUrl, setScanUrl] = useState<string | undefined>();
  const [source, setSource] = useState<'scan' | 'typed'>('scan');
  const [mode, setMode] = useState<'idle' | 'scanning' | 'review'>('idle');
  const [saving, setSaving] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [err, setErr] = useState('');
  /** Slice 7n · streak awards fired by this submit; surfaced as a
   *  celebratory chip so the kid sees the reward immediately. */
  const [streakAwards, setStreakAwards] = useState<StreakAwardResult[]>([]);
  /** Slice 7p · one-shot confetti burst when this submit adds a new
   *  day to the streak (or hits a milestone). */
  const [celebrate, setCelebrate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Slice 7o · live weekly reviews subscription (latest 8 weeks).
  const [weeklyReviews, setWeeklyReviews] = useState<ReflectionWeekReview[]>([]);

  useEffect(() => {
    if (!familyId || !kidId) return;
    const u1 = subscribeToSparksProfile(familyId, kidId, setProfile);
    const u2 = subscribeToReflection(familyId, kidId, today, setTodayEntry);
    const u3 = subscribeToReflections(familyId, kidId, setRecent);
    const u4 = subscribeToWeeklyReviews(familyId, kidId, setWeeklyReviews);
    return () => { u1(); u2(); u3(); u4(); };
  }, [familyId, kidId, today]);

  const settings = readReflectionSettings(profile);
  const canType = typingAllowedOn(settings, today);
  const streak = useMemo(() => computeReflectionStreak(recent), [recent]);
  const isParent = authProfile?.role === 'parent';
  const canWrite = !isParent || authProfile?.role === 'parent'; // kid (own) or parent

  // ── Scan flow ──
  const onScanPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !familyId) return;
    setErr(''); setMode('scanning');
    try {
      // Upload the page (so the parent can see the original), then OCR it.
      const up = await uploadSparksPhoto(familyId, `reflection_${kidId}_${today}`, file).catch(() => null);
      const { b64, mime } = await fileToBase64(file);
      const res = await fetch('/api/sparks/ai/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64, mediaType: mime, kind: 'reflection' }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.skipped) {
        // AI off — let the kid type what they wrote instead.
        setErr(sw ? 'Uchanganuzi haupatikani sasa — andika kwa mkono kisha andika hapa.' : 'Scanning is off right now — type what you wrote.');
        setSource('typed'); setMode('review'); setScanUrl(up?.fullUrl);
        return;
      }
      setDraft((data?.text as string || '').trim());
      setScanUrl(up?.fullUrl);
      setSource('scan');
      setMode('review');
    } catch (e2) {
      setErr((e2 as Error).message || 'Scan failed');
      setMode('idle');
    }
  };

  // ── Save + request feedback ──
  const save = async () => {
    if (!familyId || !draft.trim() || !authProfile?.uid) return;
    setSaving(true); setErr('');
    try {
      await saveReflection(familyId, {
        kidId, date: today, text: draft.trim(), source, scanUrl, by: authProfile.uid,
      });
      setMode('idle');

      // Slice 7n · fire streak-milestone awards if any landed today.
      // Computed against the entries currently in `recent` plus the row
      // we just wrote (recent will refresh from the subscription, but
      // this gives instant feedback to the kid).
      try {
        const next = recent.some((r) => r.date === today)
          ? recent
          : [
              ({ kidId, date: today, text: draft.trim(), source } as unknown as ReflectionEntry),
              ...recent,
            ];
        const liveStreak = computeReflectionStreak(next);
        const fired = await maybeAwardStreakMilestone({
          familyId,
          kidId,
          date: today,
          streakCurrent: liveStreak.current,
          rewards: profile?.reflection_streak,
          awardedBy: authProfile.uid,
          awardedByName: authProfile.displayName || kidName,
        });
        if (fired.length > 0) setStreakAwards(fired);
        // Slice 7p · fire confetti on milestone hits AND when today
        // simply added a fresh day to the streak (≥ 2 consecutive).
        const addedFreshDay = !recent.some((r) => r.date === today) && (liveStreak.current >= 2);
        if (fired.length > 0 || addedFreshDay) setCelebrate(true);
      } catch { /* best-effort */ }

      // Slice 7q · fire parent email/digest alerts (best-effort).
      void (async () => {
        try {
          await fetch('/api/sparks/notify-submission', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              familyId,
              kidId,
              kidName,
              area: 'reflection',
              title: toDisplayDate(today),
              summary: draft.trim().slice(0, 280),
              link: `/sparks/${kidId}/reflection`,
            }),
          });
        } catch { /* best-effort */ }
      })();

      // Slice 7p · post-scan AI read (mood + theme + Kaya response).
      // Best-effort — silently skipped if the AI key is absent or
      // the call fails. Fires in parallel with the feedback below.
      void (async () => {
        try {
          const res = await fetch('/api/sparks/ai/reflection-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: draft.trim(), firstName: kidName.split(' ')[0] }),
          });
          const data = await res.json().catch(() => ({}));
          if (data && !data.skipped && !data.error && data.mood_emoji) {
            await saveReflectionAIRead(familyId, kidId, today, data as ReflectionAIRead);
          }
        } catch { /* best-effort */ }
      })();

      // Best-effort structured feedback (degrades silently if AI off).
      setFeedbackBusy(true);
      try {
        const res = await fetch('/api/sparks/ai/reflect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: draft.trim(), firstName: kidName }),
        });
        const fb = await res.json().catch(() => ({}));
        if (fb && !fb.skipped && !fb.error && fb.wentWell) {
          await saveReflectionFeedback(familyId, kidId, today, fb as ReflectionFeedback);
        }
      } catch { /* feedback is best-effort */ }
      finally { setFeedbackBusy(false); }
    } catch (e2) {
      setErr((e2 as Error).message || 'Could not save'); setMode('idle');
    } finally {
      setSaving(false);
    }
  };

  const startTyping = () => { setSource('typed'); setDraft(todayEntry?.text || ''); setMode('review'); };

  const heroSub = streak.current > 0
    ? (sw ? `🔥 Mfululizo wa siku ${streak.current}` : `🔥 ${streak.current}-day streak`)
    : (sw ? 'Anza mfululizo wako leo' : 'Start your streak today');

  return (
    <AreaScreen kidId={kidId} kidName={kidName} area="reflection" subtitle={heroSub}>
      {/* Slice 7p · streak fire confetti — fires once when the kid
          adds a new day to the streak or hits a milestone. */}
      {celebrate && <CelebrationBurst onDone={() => setCelebrate(false)} />}

      {/* Slice 7o · Weekly review card — only when the Sunday cron has
          generated at least one review for the kid. Renders the most
          recent week at the top of the page. */}
      {weeklyReviews.length > 0 && (
        <WeeklyReviewCard review={weeklyReviews[0]} kidFirstName={kidName.split(' ')[0]} />
      )}

      {/* Slice 7n · streak milestone reward chip — sits at the top of
          the page when this submit just unlocked one or more milestones. */}
      {streakAwards.length > 0 && (
        <div className="rounded-2xl border-2 border-[#D4A847] bg-gradient-to-br from-[#FFF1C9] to-[#FFFAEB] px-4 py-3 mb-3">
          <div className="text-[13px] font-display font-extrabold text-[#8A6800] flex items-center gap-2 flex-wrap">
            <span className="text-xl">🎉</span>
            <span>
              {streakAwards.length === 1
                ? `${streakAwards[0].label} unlocked!`
                : `${streakAwards.length} streak rewards unlocked!`}
            </span>
          </div>
          <div className="text-[12px] text-[#5A4500] mt-1 leading-snug">
            {streakAwards.map((a) => (
              <span key={a.days} className="inline-block bg-white border border-[#D4A847] rounded-full px-2.5 py-0.5 mr-1.5 mb-1 font-bold">
                🔥 {a.days}-day · +{a.points} pts
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStreakAwards([])}
            className="mt-1 text-[11px] font-bold text-[#8A6800] hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Already logged today → show the entry + Kaya's feedback. */}
      {todayEntry && mode === 'idle' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-nunito font-black text-[15px] text-[#0F1F44]">
              {toDisplayDate(today)}
            </div>
            <span className="text-[11px] font-nunito font-extrabold px-2.5 py-1 rounded-full bg-[#FFF1C9] text-[#8A6800]">
              {sw ? `🔥 siku ${streak.current}` : `🔥 ${streak.current}-day`}
            </span>
          </div>
          <div className="rounded-2xl border border-[#ECE4D3] bg-white p-3 text-[13px] text-[#0F1F44] leading-relaxed whitespace-pre-wrap">
            {todayEntry.text}
            {todayEntry.source === 'scan' && (
              <span className="ml-2 text-[10px] font-extrabold uppercase tracking-[1px] text-[#5A6488]">📷 {sw ? 'imechanganuliwa' : 'scanned'}</span>
            )}
          </div>

          {/* Slice 7p · AI-read card with mood + theme + Kaya response
              + 🔊 read aloud. Renders only after the post-save AI read
              has landed. */}
          {todayEntry.ai_read && (
            <AIReadCard read={todayEntry.ai_read} text={todayEntry.text} />
          )}

          <ReflectionFeedbackCard feedback={todayEntry.feedback} busy={feedbackBusy} sw={sw} />

          {canWrite && (
            <button
              type="button"
              onClick={() => { setDraft(todayEntry.text); setSource(todayEntry.source); setMode('review'); }}
              className="text-[12px] font-nunito font-extrabold text-[#5A3CB8] underline underline-offset-2"
            >
              {sw ? '✏️ Hariri tafakari ya leo' : '✏️ Edit today’s reflection'}
            </button>
          )}
        </div>
      ) : mode === 'review' ? (
        // ── Review / confirm the transcribed (or typed) text ──
        <div className="space-y-3">
          <div className="text-[11px] font-nunito font-black uppercase tracking-[1.2px] text-[#5A6488]">
            {source === 'scan'
              ? (sw ? '📖 Kaya imesoma ukurasa wako' : '📖 Kaya read your page')
              : (sw ? '✍️ Andika tafakari yako' : '✍️ Write your reflection')}
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder={sw ? 'Leo nilijifunza…' : 'Today I learned…'}
            className="w-full rounded-2xl border border-[#ECE4D3] bg-white p-3 text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#8E7BE0]/40"
          />
          {err && <p className="text-[12px] font-bold text-[#E36F6F]">{err}</p>}
          <div className="flex items-center gap-2">
            {source === 'scan' && (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="px-3.5 py-2 rounded-xl bg-white border border-[#ECE4D3] text-[#5A6488] font-nunito font-extrabold text-[12px]">
                ↻ {sw ? 'Changanua tena' : 'Re-scan'}
              </button>
            )}
            <button type="button" onClick={save} disabled={saving || !draft.trim()}
              className="ml-auto px-4 py-2 rounded-xl text-white font-nunito font-black text-[13px] disabled:opacity-50"
              style={{ background: VIOLET }}>
              {saving ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Inaonekana sawa · Hifadhi →' : 'Looks right · Save →')}
            </button>
          </div>
        </div>
      ) : (
        // ── Empty today → scan-first capture ──
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-nunito font-black text-[15px] text-[#0F1F44]">{toDisplayDate(today)}</div>
            {streak.current > 0 && (
              <span className="text-[11px] font-nunito font-extrabold px-2.5 py-1 rounded-full bg-[#FFF1C9] text-[#8A6800]">
                {sw ? `🔥 siku ${streak.current}` : `🔥 ${streak.current}-day streak`}
              </span>
            )}
          </div>
          <div className="text-[11px] font-nunito font-black uppercase tracking-[1.2px] text-[#5A6488]">
            {sw ? 'Andika kwa mkono, kisha changanua 📷' : 'Write it by hand, then scan 📷'}
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={mode === 'scanning'}
            className="w-full rounded-2xl border-2 border-dashed p-6 text-center transition disabled:opacity-60"
            style={{ borderColor: '#8E7BE0', background: '#EFE7FF', color: VIOLET }}
          >
            <div className="text-[30px]">📷</div>
            <div className="font-nunito font-black text-[15px] mt-1">
              {mode === 'scanning'
                ? (sw ? 'Kaya inasoma…' : 'Kaya is reading…')
                : (sw ? 'Changanua tafakari ya leo' : 'Scan today’s reflection')}
            </div>
            <div className="text-[11px] opacity-80 mt-0.5">{sw ? 'Kaya itasoma mwandiko wako' : 'Kaya reads your handwriting'}</div>
          </button>
          {err && <p className="text-[12px] font-bold text-[#E36F6F]">{err}</p>}
          {canType ? (
            <button type="button" onClick={startTyping}
              className="block mx-auto text-[11px] font-nunito font-extrabold text-[#5A6488] underline underline-offset-2">
              {sw ? '✍️ Andika badala yake' : '✍️ Type instead'}
            </button>
          ) : (
            <p className="text-center text-[10.5px] text-[#5A6488]">
              {sw ? '✍️ Kuandika kumezimwa leo (mzazi: changanua tu)' : '✍️ Typing is off today — scan your handwriting'}
            </p>
          )}
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onScanPicked} />

      {/* This-week strip */}
      <WeekStrip byDate={streak.byDate} sw={sw} />
    </AreaScreen>
  );
}

function ReflectionFeedbackCard({ feedback, busy, sw }: { feedback?: ReflectionFeedback; busy: boolean; sw: boolean }) {
  if (busy && !feedback) {
    return (
      <div className="rounded-2xl border p-3 text-[12px] text-[#5A6488] animate-pulse"
        style={{ background: 'linear-gradient(120deg,#EFE7FF,#E2F1FF)', borderColor: '#cdbdf0' }}>
        {sw ? 'Kaya inaandika maoni…' : 'Kaya is writing your feedback…'}
      </div>
    );
  }
  if (!feedback) return null;
  return (
    <div className="rounded-2xl border p-3 space-y-2.5"
      style={{ background: 'linear-gradient(120deg,#EFE7FF,#E2F1FF)', borderColor: '#cdbdf0', color: '#2c2056' }}>
      <div>
        <div className="font-nunito font-black text-[12px] text-[#1f7a44] flex items-center gap-1.5">🌟 {sw ? 'Kilichoenda vizuri' : 'What went well'}</div>
        <p className="text-[12.5px] leading-snug mt-0.5">{feedback.wentWell}</p>
      </div>
      {feedback.tip && (
        <div>
          <div className="font-nunito font-black text-[12px] text-[#9a5b00] flex items-center gap-1.5">💡 {sw ? 'Dokezo moja dogo' : 'One small tip'}</div>
          <p className="text-[12.5px] leading-snug mt-0.5">{feedback.tip}</p>
        </div>
      )}
      <div>
        <div className="font-nunito font-black text-[12px] flex items-center gap-1.5">👏 {sw ? 'Hongera' : 'Cheer'}</div>
        <p className="text-[12.5px] leading-snug mt-0.5">{feedback.cheer}</p>
      </div>
    </div>
  );
}

function WeekStrip({ byDate, sw }: { byDate: Record<string, boolean>; sw: boolean }) {
  const labels = sw ? ['J2', 'J3', 'J4', 'J5', 'I', 'J', 'JP'] : ['M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'];
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    return reflectionDayKey(d);
  });
  const logged = days.filter((k) => byDate[k]).length;
  return (
    <div className="mt-4 rounded-2xl border border-[#ECE4D3] bg-white p-3">
      <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-[#5A6488] mb-2">
        {sw ? 'Wiki hii' : 'This week'}
      </div>
      <div className="flex gap-1.5">
        {days.map((k, i) => {
          const on = !!byDate[k];
          const isToday = k === reflectionDayKey(today);
          return (
            <span key={k}
              className={`flex-1 h-8 rounded-lg grid place-items-center text-[11px] font-nunito font-extrabold border ${
                on ? 'bg-[#E9F6EF] border-[#BFE6CF] text-[#1f5235]'
                   : isToday ? 'bg-[#0F1F44] text-white border-transparent'
                   : 'bg-white border-[#ECE4D3] text-[#5A6488] opacity-60'
              }`}>
              {labels[i]}
            </span>
          );
        })}
      </div>
      <div className="text-[11px] text-[#5A6488] mt-2">
        {sw ? `Umeandika siku ${logged} wiki hii — endelea!` : `${logged} ${logged === 1 ? 'day' : 'days'} logged this week — keep it going!`}
      </div>
    </div>
  );
}

// ─── Slice 7o · Weekly review card ─────────────────────────────────
//
// Renders the latest review the Sunday cron generated. Themes, mood
// arc, verbatim highlights, Kaya's tip for next week, and a quiet
// AI-can-be-wrong disclaimer at the bottom.

function WeeklyReviewCard({ review, kidFirstName }: { review: ReflectionWeekReview; kidFirstName: string }) {
  const themes = Array.isArray(review.themes) ? review.themes.slice(0, 4) : [];
  const highlights = Array.isArray(review.highlights) ? review.highlights.slice(0, 3) : [];
  const moods = Array.isArray(review.mood_by_day) ? review.mood_by_day : [];

  return (
    <div className="mb-3 rounded-2xl overflow-hidden border border-[#ECE4D3] bg-white">
      <div className="px-4 py-3 text-white" style={{ background: 'linear-gradient(135deg,#FFB627,#FFD93D)', color: '#5A4500' }}>
        <div className="text-[11px] font-bold opacity-85">📅 Week of {toDisplayDate(review.weekStart)} – {toDisplayDate(review.weekEnd)} · {kidFirstName}</div>
        <div className="font-display font-extrabold text-[18px] mt-0.5">Your week in reflection</div>
      </div>

      <div className="p-4 space-y-3">
        <div className="bg-[#FBF7EE] rounded-xl px-3 py-2.5">
          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#5A6488] mb-1">🔥 Streak</div>
          <div className="text-[13px] font-extrabold text-[#0F1F44]">
            {review.loggedDays} of 7 days logged this week
          </div>
        </div>

        {themes.length > 0 && (
          <div className="bg-[#FBF7EE] rounded-xl px-3 py-2.5">
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#5A6488] mb-1.5">📊 Themes Kaya read</div>
            <div className="flex flex-wrap gap-1.5">
              {themes.map((t, idx) => (
                <span key={idx} className="inline-flex items-center gap-1 bg-[#E5D6FF] text-[#5A3CB8] text-[12px] font-extrabold rounded-full px-2.5 py-1">
                  <span>{t.emoji}</span>
                  <span>{t.label}</span>
                  <span className="opacity-70">· {t.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {highlights.length > 0 && (
          <div className="bg-[#FBF7EE] rounded-xl px-3 py-2.5">
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#5A6488] mb-1.5">🌟 Highlights · your own words</div>
            <ul className="m-0 p-0 list-none space-y-1.5">
              {highlights.map((h, idx) => (
                <li key={idx} className="bg-white border-l-[3px] border-[#D4A847] rounded-r px-2.5 py-1.5 text-[12.5px] italic text-[#0F1F44] leading-snug">
                  &ldquo;{h.quote}&rdquo;
                  <span className="not-italic text-[#5A6488] text-[10.5px] font-bold block mt-0.5">{toDisplayDate(h.date)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {moods.length > 0 && (
          <div className="bg-[#FBF7EE] rounded-xl px-3 py-2.5">
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#5A6488] mb-1.5">📈 Mood arc</div>
            <div className="flex flex-wrap gap-2 mb-1">
              {moods.map((m, idx) => (
                <span key={idx} className="text-[20px]" title={m.date}>{m.emoji}</span>
              ))}
            </div>
            {review.mood_summary && (
              <div className="text-[11.5px] text-[#5A6488] leading-snug">{review.mood_summary}</div>
            )}
          </div>
        )}

        {review.tip && (
          <div className="bg-[#E5D6FF] rounded-xl px-3 py-2.5">
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#5A3CB8] mb-1">💡 Kaya&apos;s tip for next week</div>
            <div className="text-[12.5px] text-[#1B1547] leading-snug">{review.tip}</div>
          </div>
        )}

        <div className="bg-[#FFFAEB] border border-dashed border-[#D4A847] rounded-lg px-3 py-2 text-[10.5px] text-[#5A4500] leading-snug">
          ⚠️ <strong>AI can read this wrong.</strong> Kaya summarised this week from {kidFirstName}&apos;s entries — give the originals a look if anything feels off.
        </div>
      </div>
    </div>
  );
}

// ─── Slice 7p · AI-read card + Read aloud ──────────────────────────
//
// Sits between the kid's typed/scanned text and the wentWell/tip/cheer
// feedback card. Shows the mood + theme Kaya read, a 1-2 sentence warm
// response, and a 🔊 Read aloud button that uses the browser's built-in
// SpeechSynthesis API (no extra service, free, works on iOS Safari).

function AIReadCard({ read, text }: { read: ReflectionAIRead; text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const supportsSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const speak = () => {
    if (!supportsSpeech) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    if (speaking) { setSpeaking(false); return; }
    const utter = new SpeechSynthesisUtterance(`${text}\n${read.kaya_response}`);
    utter.rate = 1; utter.pitch = 1;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    synth.speak(utter);
    setSpeaking(true);
  };

  return (
    <div className="rounded-2xl border-2 border-[#5A3CB8] bg-[#F6EFFF] px-4 py-3 text-[#1B1547]">
      <div className="flex items-center gap-2 font-display font-extrabold text-[14px]">
        <span aria-hidden>✨</span>
        <span>Kaya read your reflection</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2.5">
        <div className="bg-white rounded-xl px-3 py-2.5 border border-[#E5D6FF]">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#5A3CB8]">Mood</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-2xl leading-none">{read.mood_emoji}</span>
            <span className="text-[13px] font-bold text-[#0F1F44]">{read.mood_word}</span>
          </div>
        </div>
        <div className="bg-white rounded-xl px-3 py-2.5 border border-[#E5D6FF]">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#5A3CB8]">Theme</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-2xl leading-none">{read.theme_emoji}</span>
            <span className="text-[13px] font-bold text-[#0F1F44]">{read.theme_label}</span>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-xl px-3 py-2.5 mt-2 border border-[#E5D6FF] text-[13px] leading-snug text-[#0F1F44]">
        <strong className="text-[#5A3CB8]">Kaya:</strong> {read.kaya_response}
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={speak}
          disabled={!supportsSpeech}
          className="px-3 py-1.5 rounded-full text-[12px] font-extrabold text-white disabled:opacity-40"
          style={{ background: '#5A3CB8' }}
          title={supportsSpeech ? 'Hear your reflection + Kaya read aloud' : 'Read aloud not supported on this device'}
        >
          {speaking ? '⏹ Stop' : '🔊 Read aloud'}
        </button>
      </div>
      <div className="mt-2 text-[10.5px] text-[#5A6488] leading-snug">
        ⚠️ Kaya&apos;s mood read is a guess — your own words are the truth.
      </div>
    </div>
  );
}
