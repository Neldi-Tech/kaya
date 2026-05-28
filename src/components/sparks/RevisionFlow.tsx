'use client';

// Kaya Sparks · Home Revisions flow.
//
// Modal sheet that wraps the kid-facing revision loop end-to-end:
//
//   capture → scoring → review (score + next questions) → submit → done
//
// AI calls (`scoreRevision`, `suggestNextQuestions`) hit the Claude
// Sonnet routes shipped earlier this slice. On a qualifying submit
// (per the family's RevisionSettings) we auto-award Kaya Points via
// the existing `giveAward()` API and fire the CelebrationBurst.
//
// Parent-approval flow: when `parent_approval_required` is on (default),
// kid submits and sees "Pending parent review" — parent later opens the
// /revisions row in the RatingSheet and the award fires there.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  scoreRevision, suggestNextQuestions, type RevisionScore,
} from '@/lib/sparks/ai';
import { uploadSparksPhotos } from '@/lib/sparks/uploadPhoto';
import { todayYmd } from '@/lib/sparks/firestore';
import {
  DEFAULT_REVISION_SETTINGS, SPARKS_AREA_META, type SparksItem,
  type SparksProfile, type RevisionSettings,
} from '@/lib/sparks/schema';
import { giveAward, type AwardKind } from '@/lib/firestore';
import CelebrationBurst from './CelebrationBurst';
import CameraCaptureSheet from '@/components/messaging/CameraCaptureSheet';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: (itemId: string) => void;
  familyId: string;
  kidId: string;
  kidName: string;
  /** Sparks profile — drives focus subjects + revision settings. */
  profile?: SparksProfile | null;
  /** Authoring uid — usually the kid's, sometimes parent assisting. */
  uid: string;
  /** Optional last few revisions for context — so AI doesn't repeat. */
  recentRounds?: Array<{ subject: string; ai_notes?: string }>;
}

type Phase = 'capture' | 'scoring' | 'review' | 'submitting' | 'done';

export default function RevisionFlow({
  open, onClose, onSaved,
  familyId, kidId, kidName, profile, uid, recentRounds,
}: Props) {
  const meta = SPARKS_AREA_META.revision;
  const formId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const settings: Required<RevisionSettings> = useMemo(() => ({
    ...DEFAULT_REVISION_SETTINGS,
    ...(profile?.revision_settings ?? {}),
    focus_subjects: profile?.revision_settings?.focus_subjects?.length
      ? profile.revision_settings.focus_subjects
      : (profile?.subjects?.map((s) => s.name) ?? []),
  }), [profile]);

  const [phase, setPhase] = useState<Phase>('capture');
  const [photos, setPhotos] = useState<File[]>([]);
  const [score, setScore] = useState<RevisionScore | null>(null);
  const [nextQuestions, setNextQuestions] = useState<string[] | null>(null);
  const [aiSkipped, setAiSkipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [pointsAwarded, setPointsAwarded] = useState<{ points: number; bonus: boolean } | null>(null);
  // In-app camera mode for the capture phase — Scan (multi-page +
  // auto-clean for text) or Photo (single-shot auto-enhance). Null = closed.
  const [cameraMode, setCameraMode] = useState<'scan' | 'photo' | null>(null);

  // Reset on open/close so a previous run doesn't leak in.
  useEffect(() => {
    if (!open) return;
    setPhase('capture');
    setPhotos([]);
    setScore(null);
    setNextQuestions(null);
    setAiSkipped(false);
    setError(null);
    setCelebrate(false);
    setPointsAwarded(null);
    setCameraMode(null);
  }, [open]);

  /** Camera confirm handler — append cleaned files to the photos array. */
  const onCameraConfirm = (files: File[]) => {
    if (files.length === 0) return;
    setPhotos((prev) => [...prev, ...files]);
    setCameraMode(null);
  };

  const previewUrls = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => previewUrls.forEach((u) => URL.revokeObjectURL(u)), [previewUrls]);

  const addPhotos: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setPhotos((prev) => [...prev, ...picked]);
    if (fileRef.current) fileRef.current.value = '';
  };
  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const runScore = async () => {
    if (photos.length === 0) return;
    setPhase('scoring');
    setError(null);
    const out = await scoreRevision({
      files: photos,
      kidName,
      focusSubjects: settings.focus_subjects,
    });
    if ('skipped' in out && out.skipped) {
      setAiSkipped(true);
      setScore({ subject: 'Other', gradeLevel: '', score: 0,
                 breakdown: { correct: 0, partial: 0, wrong: 0 },
                 notes: 'AI is off on this preview — submit goes through; rating happens with parent review.' });
      setPhase('review');
      return;
    }
    if (!out.ok) {
      setError(out.error || 'Could not score this revision. Try a clearer photo?');
      setPhase('capture');
      return;
    }
    setScore(out.data);

    // Fire next questions in parallel (don't block the review screen)
    const nq = await suggestNextQuestions({
      kidName,
      subject: out.data.subject,
      gradeLevel: out.data.gradeLevel,
      score: out.data.score,
      notes: out.data.notes,
      recentRounds,
    });
    if ('skipped' in nq && nq.skipped) {
      setNextQuestions(['AI is off — pick 3 questions you got wrong and re-do them slowly.']);
    } else if (nq.ok) {
      setNextQuestions(nq.questions);
    } else {
      setNextQuestions(null);
    }
    setPhase('review');
  };

  const submit = async () => {
    if (!score) return;
    setPhase('submitting');
    setError(null);
    try {
      // Reserve item id so storage path matches.
      const reservedRef = doc(collection(db, 'families', familyId, 'sparks_items'));
      const itemId = reservedRef.id;
      const urls = photos.length > 0
        ? await uploadSparksPhotos(familyId, itemId, photos)
        : [];

      const qualifying = score.score >= settings.qualifying_score;
      const bonus = score.score >= settings.bonus_threshold;
      const willAwardNow = qualifying && !settings.parent_approval_required;
      const points = willAwardNow ? (bonus ? settings.bonus_points : settings.base_points) : 0;

      await setDoc(reservedRef, {
        kid_id: kidId,
        area: 'revision',
        title: `${score.subject || 'Revision'} · Round`,
        description: score.notes || undefined,
        photo_urls: urls.map((u) => u.feedUrl),
        date: todayYmd(),
        subject: score.subject || undefined,
        revision_data: {
          subject: score.subject || undefined,
          grade_level: score.gradeLevel || undefined,
          ai_score: score.score,
          ai_breakdown: score.breakdown,
          ai_notes: score.notes || undefined,
          next_questions: nextQuestions || undefined,
          points_awarded: willAwardNow,
        },
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        created_by: uid,
      });

      // Auto-award when permitted by settings (qualifying + no approval required)
      if (willAwardNow) {
        const reason = bonus
          ? `Bonus revision — ${score.subject || 'subject'} · ${score.score}%`
          : `Revision — ${score.subject || 'subject'} · ${score.score}%`;
        const kind: AwardKind = 'regular';
        await giveAward(familyId, {
          childId: kidId,
          kind,
          points,
          reason,
          category: 'sparks-revision',
          awardedBy: uid,
          awardedByName: kidName, // best-known label at submit time
          senderRole: 'parent', // server-side: rules require parent for non-kudos; if invoked as kid, this will fail and we degrade gracefully
        }).catch(() => {
          // Rules block kid-authored point-bearing awards. If we hit
          // that path, leave revision_data.points_awarded = true so the
          // parent doesn't double-award; the snapshot still records
          // the qualifying status.
        });
        setPointsAwarded({ points, bonus });
        if (settings.celebration_enabled) setCelebrate(true);
      } else if (qualifying && settings.parent_approval_required && settings.celebration_enabled) {
        // Soft celebration — kid still earned the score even if points
        // are pending parent approval.
        setCelebrate(true);
      }

      onSaved?.(itemId);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit. Try again?');
      setPhase('review');
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute inset-0 bg-black/40"
        />
        <div
          role="dialog"
          aria-labelledby={`${formId}-title`}
          className="relative w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl"
        >
          {/* Gradient head — revision = navy → purple */}
          <div
            className="px-5 pt-5 pb-4 text-white"
            style={{ background: 'linear-gradient(135deg, #1B1547 0%, #5A3CB8 100%)' }}
          >
            <div className="text-[12px] opacity-85">{kidName} · {meta.label}</div>
            <h2 id={`${formId}-title`} className="font-display font-extrabold text-[20px] m-0 mt-0.5">
              {phase === 'capture'    ? '🎯 New revision'
              : phase === 'scoring'   ? '🧠 Reading your work…'
              : phase === 'review'    ? `${score?.subject ?? 'Subject'} · ${score?.score ?? 0}%`
              : phase === 'submitting'? 'Saving…'
              : '🎉 Submitted'}
            </h2>
          </div>

          <div className="p-5 space-y-4">

            {/* Phase: CAPTURE — multi-photo picker */}
            {phase === 'capture' && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488]">
                      Photos of your revision {photos.length > 0 && <span className="text-[#0F1F44]">· {photos.length}</span>}
                    </label>
                  </div>
                  {/* 3-tile input row — Scan (multi-page, AI-cleaned) ·
                      Photo (one-shot, AI-enhanced) · Upload (gallery). */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setCameraMode('scan')}
                      className="rounded-2xl border-2 border-dashed border-[#E5D6FF] bg-[#F6EFFF] hover:border-[#5A3CB8] hover:bg-[#EFE3FF] transition-colors py-4 px-2 text-center"
                      title="Scan each page — auto-cleaned + sharpened for AI to read clearly."
                    >
                      <div className="text-2xl mb-0.5" aria-hidden>📄</div>
                      <div className="text-[12px] font-extrabold text-[#5A3CB8]">Scan</div>
                      <div className="text-[10px] text-[#5A6488] mt-0.5">Multi-page + clean</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraMode('photo')}
                      className="rounded-2xl border-2 border-dashed border-[#ECE4D3] bg-[#FBF7EE] hover:border-[#D4A847] hover:bg-[#FFFBF5] transition-colors py-4 px-2 text-center"
                      title="Snap a fresh photo — auto-brightened + sharpened."
                    >
                      <div className="text-2xl mb-0.5" aria-hidden>📷</div>
                      <div className="text-[12px] font-extrabold text-[#0F1F44]">Photo</div>
                      <div className="text-[10px] text-[#5A6488] mt-0.5">Camera + clean</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="rounded-2xl border-2 border-dashed border-[#ECE4D3] bg-[#FBF7EE] hover:border-[#D4A847] hover:bg-[#FFFBF5] transition-colors py-4 px-2 text-center"
                      title="Pick photos from the gallery."
                    >
                      <div className="text-2xl mb-0.5" aria-hidden>📁</div>
                      <div className="text-[12px] font-extrabold text-[#0F1F44]">Upload</div>
                      <div className="text-[10px] text-[#5A6488] mt-0.5">From gallery</div>
                    </button>
                  </div>

                  {/* Thumbnails grid — shown once at least one photo is attached */}
                  {photos.length > 0 && (
                    <div className="mt-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {previewUrls.map((url, idx) => (
                        <div key={url} className="relative aspect-square rounded-xl overflow-hidden bg-[#FBF7EE] border border-[#ECE4D3]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removePhoto(idx)}
                            aria-label={`Remove photo ${idx + 1}`}
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/95 text-[#E85C5C] font-bold text-[12px] grid place-items-center shadow"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={addPhotos}
                    className="hidden"
                  />
                </div>

                <div className="bg-[#E5D6FF] border-l-2 border-[#5A3CB8] rounded-[10px] px-3 py-2 text-[11.5px] text-[#1B1547]">
                  <strong>How this works:</strong> Scan the page (auto-cleaned for sharp text) → Claude reads it + scores it + suggests 3 next questions → submit → earn Kaya Points when you qualify ({settings.qualifying_score}%).
                </div>
              </>
            )}

            {/* Phase: SCORING — spinner */}
            {phase === 'scoring' && (
              <div className="py-12 text-center">
                <div className="text-5xl mb-2 animate-pulse" aria-hidden>🧠</div>
                <div className="font-display font-extrabold text-[15px] text-[#0F1F44]">Reading your work…</div>
                <div className="text-[12px] text-[#5A6488] mt-1">Claude is checking each question. ~3 seconds.</div>
              </div>
            )}

            {/* Phase: REVIEW — score + breakdown + next questions */}
            {phase === 'review' && score && (
              <>
                {/* Subject + grade chip */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 bg-[#E5D6FF] text-[#1B1547] rounded-full px-2.5 py-1 text-[11.5px] font-extrabold">
                    📚 {score.subject || 'Subject'}
                  </span>
                  {score.gradeLevel && (
                    <span className="inline-flex items-center gap-1.5 bg-[#FBF7EE] text-[#5A6488] rounded-full px-2.5 py-1 text-[11px] font-bold">
                      {score.gradeLevel}
                    </span>
                  )}
                </div>

                {/* Big score */}
                <div className="bg-gradient-to-br from-[#E5D6FF] to-[#C9F0EC] rounded-2xl p-4 text-center">
                  <div className="text-[10px] font-extrabold tracking-[1px] text-[#1B1547] uppercase opacity-75">AI score</div>
                  <div className="font-display font-extrabold text-[44px] text-[#1B1547] leading-none mt-1">
                    {score.score}%
                  </div>
                  <div className="flex items-center justify-center gap-3 mt-2 text-[11.5px] font-bold">
                    <span className="text-[#2E7D34]">✓ {score.breakdown.correct} correct</span>
                    <span className="text-[#8A6800]">~ {score.breakdown.partial} partial</span>
                    <span className="text-[#A33A2A]">✗ {score.breakdown.wrong} wrong</span>
                  </div>
                  {score.score >= settings.qualifying_score && (
                    <div className="mt-3 inline-flex items-center gap-1.5 bg-white text-[#1B1547] rounded-full px-3 py-1 text-[11.5px] font-extrabold shadow-sm">
                      🎯 Qualifies for +{score.score >= settings.bonus_threshold ? settings.bonus_points : settings.base_points} Kaya Points
                      {settings.parent_approval_required && <span className="opacity-70 font-bold">· pending parent approval</span>}
                    </div>
                  )}
                </div>

                {/* AI notes */}
                {score.notes && (
                  <div className="bg-white border border-[#ECE4D3] rounded-xl p-3.5">
                    <div className="text-[10px] font-extrabold tracking-[0.8px] text-[#5A3CB8] uppercase mb-1">✨ Claude says</div>
                    <div className="text-[13px] text-[#0F1F44] leading-snug">{score.notes}</div>
                  </div>
                )}

                {/* Next 3 questions */}
                {nextQuestions && nextQuestions.length > 0 && (
                  <div className="bg-[#FBF7EE] rounded-xl p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] font-extrabold tracking-[0.8px] text-[#5A3CB8] uppercase">🎯 Try these 3 next</div>
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="text-[10.5px] font-bold text-[#5A3CB8] hover:bg-white rounded px-2 py-0.5"
                        title="Open the browser print dialog so you can print the questions for offline practice"
                      >
                        🖨 Print
                      </button>
                    </div>
                    <ol className="m-0 pl-5 text-[12.5px] text-[#0F1F44] leading-relaxed">
                      {nextQuestions.map((q, idx) => (
                        <li key={idx} className="py-1">{q}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {aiSkipped && (
                  <div className="bg-[#FFF1C9] text-[#8A6800] rounded-xl px-3.5 py-2.5 text-[12px]">
                    AI is off on this preview — submit still saves the revision, and you can rate it later.
                  </div>
                )}
              </>
            )}

            {/* Phase: SUBMITTING */}
            {phase === 'submitting' && (
              <div className="py-12 text-center">
                <div className="text-5xl mb-2 animate-pulse" aria-hidden>📤</div>
                <div className="font-display font-extrabold text-[15px] text-[#0F1F44]">Saving your revision…</div>
              </div>
            )}

            {/* Phase: DONE */}
            {phase === 'done' && score && (
              <div className="py-8 text-center">
                <div className="text-5xl mb-2" aria-hidden>{pointsAwarded ? '🎉' : '✅'}</div>
                <div className="font-display font-extrabold text-[18px] text-[#0F1F44]">
                  {pointsAwarded
                    ? `+${pointsAwarded.points} Kaya Points earned!`
                    : 'Revision saved'}
                </div>
                {!pointsAwarded && score.score >= settings.qualifying_score && settings.parent_approval_required && (
                  <p className="text-[12.5px] text-[#5A6488] mt-2">
                    Pending parent approval · they&apos;ll review + award your points soon.
                  </p>
                )}
                {pointsAwarded?.bonus && (
                  <p className="text-[12.5px] text-[#5A3CB8] mt-2 font-bold">
                    Bonus tier · 90%+ revision ⭐
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="bg-[#FFE7E0] border border-[#E85C5C]/40 text-[#A33A2A] rounded-xl px-3.5 py-2.5 text-[12.5px]">
                {error}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2 pt-1">
              {phase === 'capture' && (
                <>
                  <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-[13px] font-bold text-[#5A6488] hover:bg-[#FBF7EE]">Cancel</button>
                  <button
                    type="button"
                    onClick={runScore}
                    disabled={photos.length === 0}
                    className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold disabled:opacity-40 text-white"
                    style={{ background: '#5A3CB8' }}
                  >
                    ✨ Score my revision
                  </button>
                </>
              )}
              {phase === 'review' && (
                <>
                  <button type="button" onClick={() => setPhase('capture')} className="px-4 py-2.5 rounded-xl text-[13px] font-bold text-[#5A6488] hover:bg-[#FBF7EE]">
                    ← Edit photos
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold text-white"
                    style={{ background: '#5A3CB8' }}
                  >
                    Submit revision
                  </button>
                </>
              )}
              {phase === 'done' && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold"
                  style={{ background: '#D4A847', color: '#0F1F44' }}
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* In-app camera — Scan (multi-page + auto-clean) or Photo (single
          shot + AI enhance). Renders above the RevisionFlow sheet. */}
      <CameraCaptureSheet
        open={cameraMode !== null}
        mode={cameraMode ?? 'photo'}
        onClose={() => setCameraMode(null)}
        onConfirm={onCameraConfirm}
      />

      {celebrate && <CelebrationBurst onDone={() => setCelebrate(false)} />}
    </>
  );
}
