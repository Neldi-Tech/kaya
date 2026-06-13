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
  type ReflectionEntry, type ReflectionFeedback,
  reflectionDayKey, readReflectionSettings, typingAllowedOn,
  subscribeToReflection, subscribeToReflections,
  saveReflection, saveReflectionFeedback, computeReflectionStreak,
  maybeAwardStreakMilestone, type StreakAwardResult,
} from '@/lib/sparks/reflection';
import { toDisplayDate } from '@/lib/dates';
import AreaScreen from '@/components/sparks/AreaScreen';

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
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!familyId || !kidId) return;
    const u1 = subscribeToSparksProfile(familyId, kidId, setProfile);
    const u2 = subscribeToReflection(familyId, kidId, today, setTodayEntry);
    const u3 = subscribeToReflections(familyId, kidId, setRecent);
    return () => { u1(); u2(); u3(); };
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
      } catch { /* best-effort */ }
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
