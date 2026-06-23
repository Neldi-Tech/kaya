'use client';

// Kaya Sparks · Daily Reflection (/sparks/[kidId]/reflection).
//
// 7th Sparks area (2026-06-07). Scan-first: the kid writes how their
// school day went BY HAND and scans the page — Claude reads the
// handwriting (/api/sparks/ai/extract, kind:'reflection') — confirms the
// text, saves it, then Kaya gives warm STRUCTURED feedback
// (/api/sparks/ai/reflect). Typing is a secondary path the parent gates
// per-kid + per-weekday. A school-day-aware streak proves consistency.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useLocale } from '@/lib/useLocale';
import { subscribeToSparksProfile } from '@/lib/sparks/firestore';
import { uploadSparksPhoto } from '@/lib/sparks/uploadPhoto';
import type { SparksProfile } from '@/lib/sparks/schema';
import {
  type ReflectionEntry, type ReflectionFeedback, type ReflectionAIRead,
  type ReflectionAIScore,
  reflectionDayKey, readReflectionSettings, typingAllowedOn,
  subscribeToReflection, subscribeToReflections,
  saveReflection, saveReflectionFeedback, saveReflectionAIRead,
  saveReflectionParentRating, saveReflectionAIScore,
  computeReflectionStreak,
  maybeAwardStreakMilestone, type StreakAwardResult,
  subscribeToWeeklyReviews,
} from '@/lib/sparks/reflection';
import type { ReflectionWeekReview } from '@/lib/sparks/schema';
import { toDisplayDate } from '@/lib/dates';
import AreaScreen from '@/components/sparks/AreaScreen';
import CameraCaptureSheet from '@/components/messaging/CameraCaptureSheet';
import CelebrationBurst from '@/components/sparks/CelebrationBurst';
import PhotoLightbox from '@/components/sparks/PhotoLightbox';

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
  const [scanOpen, setScanOpen] = useState(false);
  /** Slice 7r · parent rate + feedback sheet open state. */
  const [rateOpen, setRateOpen] = useState(false);
  /** Slice 7r · "view scanned page" lightbox open state. */
  const [scanViewOpen, setScanViewOpen] = useState(false);

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

  // 2026-06-23 · scanned handwriting, indexed by day, so the weekly post +
  // recent list can show the real page next to the transcribed words.
  const scanByDate = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of recent) if (r.source === 'scan' && r.scanUrl) m[r.date] = r.scanUrl;
    return m;
  }, [recent]);
  const weekReview = weeklyReviews[0];
  const weekScans = useMemo(() => {
    if (!weekReview) return [] as Array<{ date: string; url: string }>;
    return recent
      .filter((r) => r.source === 'scan' && r.scanUrl && r.date >= weekReview.weekStart && r.date <= weekReview.weekEnd)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((r) => ({ date: r.date, url: r.scanUrl as string }));
  }, [recent, weekReview]);
  const recentScans = useMemo(
    () => recent.filter((r) => r.source === 'scan' && r.scanUrl && r.date !== today).slice(0, 8),
    [recent, today],
  );
  /** Open an arbitrary set of scanned pages in the shared lightbox. */
  const [scanGallery, setScanGallery] = useState<{ urls: string[]; index: number; caption: string } | null>(null);

  const isParent = authProfile?.role === 'parent';
  const canWrite = !isParent || authProfile?.role === 'parent'; // kid (own) or parent

  // ── Scan flow ──
  // Fed by CameraCaptureSheet (scan mode → AI auto-frame/crop/enhance gives a
  // clean page). Uploads the enhanced page, then OCRs it for the draft text.
  const processScanFile = async (file: File) => {
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

      // 2026-06-23 · AI soundness score (display-only % feedback). Best-effort,
      // parallel — degrades silently when the AI key is absent.
      void (async () => {
        try {
          const res = await fetch('/api/sparks/ai/reflection-score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: draft.trim(), firstName: kidName.split(' ')[0] }),
          });
          const data = await res.json().catch(() => ({}));
          if (data && !data.skipped && !data.error && typeof data.soundness === 'number') {
            await saveReflectionAIScore(familyId, kidId, today, data as ReflectionAIScore);
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
        <WeeklyReviewCard
          review={weeklyReviews[0]}
          kidFirstName={kidName.split(' ')[0]}
          weekScans={weekScans}
          scanByDate={scanByDate}
          onOpenScan={(urls, index, caption) => setScanGallery({ urls, index, caption })}
          sw={sw}
        />
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
          {/* Slice 7r · Scanned page thumbnail (parents + kid alike).
              Tap to open the original scan in a lightbox so the parent
              can verify what was actually uploaded vs the transcript. */}
          {todayEntry.source === 'scan' && todayEntry.scanUrl && (
            <button
              type="button"
              onClick={() => setScanViewOpen(true)}
              className="block w-full rounded-2xl overflow-hidden border border-[#ECE4D3] bg-[#FBF7EE] p-0 cursor-zoom-in"
              aria-label={sw ? 'Fungua ukurasa uliochanganuliwa' : 'Open scanned page'}
              title={sw ? 'Bonyeza kuona ukurasa' : 'Tap to view the scanned page'}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={todayEntry.scanUrl} alt="" className="w-full max-h-72 object-contain bg-white" />
              <div className="text-[10px] font-extrabold uppercase tracking-[1px] text-[#5A6488] px-3 py-1.5 bg-[#FBF7EE] flex items-center justify-between">
                <span>📷 {sw ? 'Imechanganuliwa' : 'Scanned page'}</span>
                <span className="text-[#5A3CB8]">🔍 {sw ? 'Bonyeza kuona' : 'Tap to view'}</span>
              </div>
            </button>
          )}
          <div className="rounded-2xl border border-[#ECE4D3] bg-white p-3 text-[13px] text-[#0F1F44] leading-relaxed whitespace-pre-wrap">
            {todayEntry.text}
            {todayEntry.source === 'scan' && (
              <span className="ml-2 text-[10px] font-extrabold uppercase tracking-[1px] text-[#5A6488]">📷 {sw ? 'imechanganuliwa' : 'scanned'}</span>
            )}
          </div>

          {/* 2026-06-23 · AI soundness score — display-only % feedback (like
              Home Projects' AI read), shown to parent + kid. */}
          {todayEntry.ai_score && (
            <div className="rounded-2xl border border-[#cdbdf0] bg-[#F6EFFF] px-4 py-3">
              <ScoreBar
                label={sw ? '🤖 Uimara wa tafakari' : '🤖 Reflection soundness'}
                tone="ai"
                percent={todayEntry.ai_score.soundness}
              />
              {todayEntry.ai_score.rationale && (
                <div className="mt-1.5 text-[12px] text-[#2c2056] leading-snug">{todayEntry.ai_score.rationale}</div>
              )}
              <div className="mt-1.5 text-[10px] text-[#5A6488] leading-snug">
                ⚠️ {sw ? 'Alama ya Kaya ni kadirio — maneno yako ndiyo ukweli.' : 'Kaya’s score is a guess — your own words are the truth.'}
              </div>
            </div>
          )}

          {/* Slice 7r · Parent rating + feedback display.
              When a parent has rated, both parent + kid see this card
              with the % scores (soundness + handwriting) + written
              feedback. Parent re-tap opens the sheet to edit. */}
          {todayEntry.parent_rating && (
            <div className="rounded-2xl border border-[#D4A847] bg-[#FFFAEB] px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#8A6800]">
                  👤 {todayEntry.parent_rating.ratedByName} {sw ? 'amekupa' : 'reviewed'}
                </span>
                {typeof todayEntry.parent_rating.stars === 'number' && (
                  <span className="text-[12px] font-extrabold rounded-full px-2 py-0.5 bg-[#FFF1C9] text-[#8A6800]">
                    {'⭐'.repeat(todayEntry.parent_rating.stars)}
                  </span>
                )}
              </div>
              {(typeof todayEntry.parent_rating.soundness_percent === 'number'
                || typeof todayEntry.parent_rating.handwriting_percent === 'number') && (
                <div className="mt-2 space-y-1.5">
                  {typeof todayEntry.parent_rating.soundness_percent === 'number' && (
                    <ScoreBar label={sw ? 'Uimara' : 'Soundness'} tone="parent" percent={todayEntry.parent_rating.soundness_percent} />
                  )}
                  {typeof todayEntry.parent_rating.handwriting_percent === 'number' && (
                    <ScoreBar label={sw ? '✍️ Mwandiko' : '✍️ Handwriting'} tone="parent" percent={todayEntry.parent_rating.handwriting_percent} />
                  )}
                </div>
              )}
              {todayEntry.parent_rating.notes && (
                <div className="mt-2 text-[13px] text-[#0F1F44] leading-snug whitespace-pre-wrap">
                  {todayEntry.parent_rating.notes}
                </div>
              )}
              {isParent && (
                <button
                  type="button"
                  onClick={() => setRateOpen(true)}
                  className="mt-2 text-[11px] font-extrabold text-[#5A3CB8] underline underline-offset-2"
                >
                  ✏️ {sw ? 'Hariri ukaguzi' : 'Edit review'}
                </button>
              )}
            </div>
          )}

          {/* Slice 7r · Parent-only "Rate + send feedback" button when
              no rating exists yet. Mirrors the Home Project + Revision
              rate flow. */}
          {isParent && !todayEntry.parent_rating && (
            <button
              type="button"
              onClick={() => setRateOpen(true)}
              className="w-full rounded-2xl border-2 border-dashed border-[#D4A847] bg-[#FFFAEB] hover:bg-[#FFF1C9] transition-colors py-3 px-4 text-center"
            >
              <div className="text-[18px]" aria-hidden>⭐</div>
              <div className="font-display font-extrabold text-[13.5px] text-[#8A6800]">
                {sw ? 'Toa nyota + andika maoni' : 'Rate + send feedback'}
              </div>
              <div className="text-[11px] text-[#5A4500] mt-0.5">
                {sw ? `${kidName.split(' ')[0]} ataona maoni yako` : `${kidName.split(' ')[0]} sees what you write`}
              </div>
            </button>
          )}

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
              <button type="button" onClick={() => setScanOpen(true)}
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
            onClick={() => setScanOpen(true)}
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

      {/* Scan camera — AI auto-frame · crop · enhance · multi-page (the same
          imaging Sparks captures + Business Projects use). Confirmed page is
          enhanced; OCR + draft happen in processScanFile. */}
      <CameraCaptureSheet
        open={scanOpen}
        mode="scan"
        contentTight
        onClose={() => setScanOpen(false)}
        onConfirm={(files) => { if (files[0]) return processScanFile(files[0]); }}
      />

      {/* 2026-06-23 · Recent handwriting — the actual scanned pages from
          earlier days, so the kid's notes are browsable, not just today's. */}
      {recentScans.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[#ECE4D3] bg-white p-3">
          <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-[#5A6488] mb-2">
            ✍️ {sw ? 'Mwandiko wa hivi karibuni' : 'Recent handwriting'}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {recentScans.map((r, i) => (
              <button
                key={r.date}
                type="button"
                onClick={() => setScanGallery({ urls: recentScans.map((s) => s.scanUrl as string), index: i, caption: toDisplayDate(r.date) })}
                className="flex-none w-[78px] rounded-lg overflow-hidden border border-[#ECE4D3] bg-white cursor-zoom-in"
                aria-label={`${sw ? 'Fungua ukurasa' : 'Open scan'} ${toDisplayDate(r.date)}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.scanUrl} alt="" className="w-full h-[96px] object-cover bg-white" />
                <div className="text-[8.5px] font-extrabold text-[#5A6488] text-center py-1">{toDisplayDate(r.date)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* This-week strip */}
      <WeekStrip byDate={streak.byDate} sw={sw} />

      {/* Slice 7r · scanned-page lightbox. Shows the original handwriting
          full-screen so the parent can verify what was uploaded vs the
          transcript. Only mounts when there's a scan to show. */}
      {scanViewOpen && todayEntry?.scanUrl && (
        <PhotoLightbox
          photos={[todayEntry.scanUrl]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setScanViewOpen(false)}
          caption={sw ? 'Tafakari ya leo' : "Today's reflection"}
          subCaption={toDisplayDate(today)}
        />
      )}

      {/* 2026-06-23 · shared scanned-page gallery (weekly post + recent
          handwriting strip). Mounts only when a thumbnail is tapped. */}
      {scanGallery && scanGallery.urls.length > 0 && (
        <PhotoLightbox
          photos={scanGallery.urls}
          index={scanGallery.index}
          onIndexChange={(i) => setScanGallery((g) => (g ? { ...g, index: i } : g))}
          onClose={() => setScanGallery(null)}
          caption={scanGallery.caption}
          subCaption={sw ? 'Mwandiko' : 'Handwritten note'}
        />
      )}

      {/* Slice 7r · Parent rate + feedback sheet. */}
      {rateOpen && todayEntry && (
        <ReflectionRatingSheet
          open={rateOpen}
          onClose={() => setRateOpen(false)}
          entry={todayEntry}
          kidName={kidName}
          authorName={authProfile?.displayName || 'Parent'}
          onSave={async ({ stars, soundness_percent, handwriting_percent, notes }) => {
            if (!familyId || !authProfile?.uid) return;
            await saveReflectionParentRating(familyId, kidId, today, {
              stars,
              soundness_percent,
              handwriting_percent,
              notes,
              ratedByName: authProfile.displayName || 'Parent',
            });
            setRateOpen(false);
          }}
        />
      )}
    </AreaScreen>
  );
}

// 2026-06-23 · coral→green % bar (mirrors RatingDisplay on Home Projects).
// `tone` only tints the % chip — AI reads violet, parent reads gold.
function ScoreBar({ label, percent, tone }: { label: string; percent: number; tone: 'ai' | 'parent' }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const chip = tone === 'ai'
    ? 'text-[#5A3CB8] bg-[#E5D6FF]'
    : 'text-[#8A6800] bg-[#FFF1C9]';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10.5px] font-extrabold text-[#0F1F44] w-[112px] flex-none">{label}</span>
      <div className="flex-1 h-1.5 bg-white border border-[#ECE4D3] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #FF6B6B, #6BCB77)' }} />
      </div>
      <span className={`text-[10px] font-extrabold rounded-full px-1.5 py-0.5 ${chip}`}>{pct}%</span>
    </div>
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

function WeeklyReviewCard({
  review, kidFirstName, weekScans, scanByDate, onOpenScan, sw,
}: {
  review: ReflectionWeekReview;
  kidFirstName: string;
  /** Scanned handwriting pages from this week, oldest → newest. */
  weekScans: Array<{ date: string; url: string }>;
  /** date → scanUrl, so a highlight can show the page it came from. */
  scanByDate: Record<string, string>;
  onOpenScan: (urls: string[], index: number, caption: string) => void;
  sw: boolean;
}) {
  const themes = Array.isArray(review.themes) ? review.themes.slice(0, 4) : [];
  const highlights = Array.isArray(review.highlights) ? review.highlights.slice(0, 3) : [];
  const moods = Array.isArray(review.mood_by_day) ? review.mood_by_day : [];
  const railUrls = weekScans.map((s) => s.url);

  return (
    <div className="mb-3 rounded-2xl overflow-hidden border border-[#ECE4D3] bg-white">
      <div className="px-4 py-3 text-white" style={{ background: 'linear-gradient(135deg,#FFB627,#FFD93D)', color: '#5A4500' }}>
        <div className="text-[11px] font-bold opacity-85">📅 Week of {toDisplayDate(review.weekStart)} – {toDisplayDate(review.weekEnd)} · {kidFirstName}</div>
        <div className="font-display font-extrabold text-[18px] mt-0.5">Your week in reflection</div>
      </div>

      <div className="p-4 space-y-3">
        {/* 2026-06-23 · Handwritten notes from this week — the real scanned
            pages, so the post shows the handwriting, not only the words. */}
        {weekScans.length > 0 && (
          <div className="bg-[#FBF7EE] rounded-xl px-3 py-2.5">
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#5A6488] mb-1.5">
              ✍️ {sw ? 'Mwandiko wa wiki hii' : 'Handwritten this week'}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {weekScans.map((s, i) => (
                <button
                  key={s.date}
                  type="button"
                  onClick={() => onOpenScan(railUrls, i, toDisplayDate(s.date))}
                  className="flex-none w-[78px] rounded-lg overflow-hidden border border-[#ECE4D3] bg-white cursor-zoom-in"
                  aria-label={`${sw ? 'Fungua ukurasa' : 'Open scan'} ${toDisplayDate(s.date)}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt="" className="w-full h-[96px] object-cover bg-white" />
                  <div className="text-[8.5px] font-extrabold text-[#5A6488] text-center py-1">
                    {toDisplayDate(s.date)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

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
              {highlights.map((h, idx) => {
                const scan = scanByDate[h.date];
                return (
                  <li key={idx} className="bg-white border-l-[3px] border-[#D4A847] rounded-r px-2.5 py-1.5 flex gap-2.5">
                    {scan && (
                      <button
                        type="button"
                        onClick={() => onOpenScan([scan], 0, toDisplayDate(h.date))}
                        className="flex-none w-[44px] h-[56px] rounded overflow-hidden border border-[#ECE4D3] bg-white cursor-zoom-in"
                        aria-label={sw ? 'Fungua mwandiko' : 'Open handwritten page'}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={scan} alt="" className="w-full h-full object-cover" />
                      </button>
                    )}
                    <div className="text-[12.5px] italic text-[#0F1F44] leading-snug">
                      &ldquo;{h.quote}&rdquo;
                      <span className="not-italic text-[#5A6488] text-[10.5px] font-bold block mt-0.5">
                        {toDisplayDate(h.date)}{scan ? ` · 📷 ${sw ? 'kutoka mwandiko' : 'from the scan'}` : ''}
                      </span>
                    </div>
                  </li>
                );
              })}
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

// ─── Slice 7r · Parent rating + feedback sheet ─────────────────────
//
// Bottom sheet (matches the revision RatingSheet pattern). Shows the
// scanned page + transcript at the top, then a 1-5 star picker + a
// free-text notes field. Save writes parent_rating on the reflection
// doc via /api/sparks/reflection action=rating (parent-only).

function ReflectionRatingSheet({
  open, onClose, entry, kidName, authorName, onSave,
}: {
  open: boolean;
  onClose: () => void;
  entry: ReflectionEntry;
  kidName: string;
  authorName: string;
  onSave: (args: {
    stars?: number; soundness_percent?: number; handwriting_percent?: number; notes?: string;
  }) => Promise<void>;
}) {
  const [stars, setStars] = useState<number | null>(entry.parent_rating?.stars ?? null);
  // 2026-06-23 · two 0-100 sliders — soundness (of the reflection) +
  // handwriting (neatness). Seed from the prior rating, else the AI
  // soundness read (a sensible starting point the parent can nudge).
  const [soundness, setSoundness] = useState<number>(
    entry.parent_rating?.soundness_percent ?? entry.ai_score?.soundness ?? 70,
  );
  const [handwriting, setHandwriting] = useState<number>(entry.parent_rating?.handwriting_percent ?? 70);
  const [notes, setNotes] = useState<string>(entry.parent_rating?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStars(entry.parent_rating?.stars ?? null);
    setSoundness(entry.parent_rating?.soundness_percent ?? entry.ai_score?.soundness ?? 70);
    setHandwriting(entry.parent_rating?.handwriting_percent ?? 70);
    setNotes(entry.parent_rating?.notes ?? '');
    setSaving(false);
    setError(null);
  }, [open, entry.parent_rating, entry.ai_score?.soundness]);

  if (!open) return null;

  const canSave = !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true); setError(null);
    try {
      await onSave({
        stars: stars ?? undefined,
        soundness_percent: soundness,
        handwriting_percent: handwriting,
        notes: notes.trim() || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-label={`Rate ${kidName}'s reflection`}
        className="relative w-full sm:max-w-md max-h-[92vh] sm:max-h-[88vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl"
      >
        <div className="px-5 pt-5 pb-4 text-white" style={{ background: 'linear-gradient(135deg,#1B1547 0%,#5A3CB8 100%)' }}>
          <div className="text-[12px] opacity-85">📔 Daily Reflection</div>
          <h2 className="font-display font-extrabold text-[18px] m-0 mt-0.5">
            Rate · {kidName}
          </h2>
        </div>

        <div className="p-5 space-y-4">
          {entry.scanUrl && (
            <div className="rounded-2xl overflow-hidden bg-[#FBF7EE] border border-[#ECE4D3]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={entry.scanUrl} alt="" className="w-full max-h-48 object-contain bg-white" />
            </div>
          )}

          <div className="rounded-xl bg-[#FBF7EE] border border-[#ECE4D3] p-3 text-[12.5px] text-[#0F1F44] leading-snug whitespace-pre-wrap max-h-32 overflow-y-auto">
            {entry.text}
          </div>

          {/* 2026-06-23 · % scoring — soundness + handwriting on coral→green
              sliders (the Home Projects pattern). Parents check both. */}
          {entry.ai_score && (
            <div className="rounded-xl bg-[#F6EFFF] border border-[#cdbdf0] px-3 py-2 text-[11.5px] text-[#2c2056]">
              🤖 Kaya scored soundness <b>{entry.ai_score.soundness}%</b>
              {entry.ai_score.rationale ? ` — ${entry.ai_score.rationale}` : ''}
            </div>
          )}
          <div>
            <label htmlFor="refl-sound" className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] flex items-center justify-between mb-2">
              <span>Soundness · the reflection</span>
              <span className="text-[12px] font-extrabold text-[#8A6800] bg-[#FFF1C9] rounded-full px-2.5 py-0.5">{soundness}%</span>
            </label>
            <input id="refl-sound" type="range" min={0} max={100} value={soundness}
              onChange={(e) => setSoundness(Number(e.target.value))}
              className="w-full accent-[#5A3CB8]" />
          </div>
          <div>
            <label htmlFor="refl-hand" className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] flex items-center justify-between mb-2">
              <span>✍️ Handwriting · neatness</span>
              <span className="text-[12px] font-extrabold text-[#8A6800] bg-[#FFF1C9] rounded-full px-2.5 py-0.5">{handwriting}%</span>
            </label>
            <input id="refl-hand" type="range" min={0} max={100} value={handwriting}
              onChange={(e) => setHandwriting(Number(e.target.value))}
              className="w-full accent-[#5A3CB8]" />
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-2">
              Stars · overall (optional)
            </label>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => {
                const active = stars !== null && n <= stars;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setStars(n === stars ? null : n)}
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    className="text-3xl leading-none transition-transform hover:scale-110 active:scale-95"
                    style={{ filter: active ? 'none' : 'grayscale(1) opacity(0.3)' }}
                  >
                    ⭐
                  </button>
                );
              })}
              {stars !== null && (
                <span className="text-[12px] font-extrabold text-[#8A6800] bg-[#FFF1C9] rounded-full px-2.5 py-1 ml-2">
                  {stars}.0
                </span>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="refl-notes" className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
              Notes · what {kidName.split(' ')[0]} sees
            </label>
            <textarea
              id="refl-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Write something specific you noticed in their reflection…"
              rows={4}
              maxLength={800}
              className="w-full bg-white border border-[#ECE4D3] rounded-xl px-3.5 py-2.5 text-[14px] text-[#0F1F44] focus:outline-none focus:border-[#D4A847] resize-none"
            />
            <div className="text-[10.5px] text-[#5A6488] mt-1">From: {authorName}</div>
          </div>

          {error && (
            <div className="bg-[#FFE7E0] border border-[#E85C5C]/40 text-[#A33A2A] rounded-xl px-3.5 py-2.5 text-[12.5px]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-[13px] font-bold text-[#5A6488] hover:bg-[#FBF7EE]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSave}
              className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold disabled:opacity-40"
              style={{ background: '#D4A847', color: '#0F1F44' }}
            >
              {saving ? 'Saving…' : 'Save rating'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
