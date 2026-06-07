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
import {
  captureDraftKey, clearCaptureDraft, loadCaptureDraft, saveCaptureDraft,
} from '@/lib/sparks/captureDraftStore';
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
  const [mode, setMode] = useState<'answers' | 'questions'>('answers');
  const [photos, setPhotos] = useState<File[]>([]);
  const [score, setScore] = useState<RevisionScore | null>(null);
  const [nextQuestions, setNextQuestions] = useState<string[] | null>(null);
  const [aiSkipped, setAiSkipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [pointsAwarded, setPointsAwarded] = useState<{ points: number; bonus: boolean } | null>(null);
  /** Slice 7c · subject confirmation. After the AI returns, the kid
   *  must accept (✓) the proposed subject or correct it. Until they
   *  do, submission is gated. */
  const [confirmedSubject, setConfirmedSubject] = useState<string | null>(null);
  const [editingSubject, setEditingSubject] = useState(false);
  const [draftSubject, setDraftSubject] = useState('');
  // In-app camera mode for the capture phase — Scan (multi-page +
  // auto-clean for text) or Photo (single-shot auto-enhance). Null = closed.
  const [cameraMode, setCameraMode] = useState<'scan' | 'photo' | null>(null);
  // Slice 7j · capture-draft persistence. A pending draft (IDB) shows
  // a Resume / Start fresh banner above the capture tiles. Resolved on
  // open. `null` = no draft to resume. `saving` is debounced.
  const [pendingDraft, setPendingDraft] = useState<{ photoCount: number; savedAt: number; mode: 'answers' | 'questions' } | null>(null);
  const dKey = useMemo(
    () => captureDraftKey({ familyId, kidId, surface: 'revision' }),
    [familyId, kidId],
  );

  // Reset on open/close so a previous run doesn't leak in.
  useEffect(() => {
    if (!open) return;
    setPhase('capture');
    setMode('answers');
    setPhotos([]);
    setScore(null);
    setNextQuestions(null);
    setAiSkipped(false);
    setError(null);
    setCelebrate(false);
    setPointsAwarded(null);
    setConfirmedSubject(null);
    setEditingSubject(false);
    setDraftSubject('');
    setCameraMode(null);
    setPendingDraft(null);
    setReplaceIndex(null);
  }, [open]);

  // Slice 7j · check IDB for an unsent draft when the sheet opens. If
  // one exists we surface the Resume / Start fresh banner; the kid
  // decides before we load any photos into state. Failures fall back
  // to today's blank flow — never blocks.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadCaptureDraft(dKey).then((draft) => {
      if (cancelled || !draft || draft.photos.length === 0) return;
      setPendingDraft({
        photoCount: draft.photos.length,
        savedAt: draft.savedAt,
        mode: (draft.meta.mode === 'questions' ? 'questions' : 'answers'),
      });
    });
    return () => { cancelled = true; };
  }, [open, dKey]);

  // Slice 7j · persist the in-progress batch to IDB on every photo
  // change. Cheap (no network); resilient to back-nav / refresh.
  // Skipped in scoring/review/submitting phases — by then the draft
  // is locked-in input, not editable.
  useEffect(() => {
    if (!open || phase !== 'capture' || pendingDraft) return;
    if (photos.length === 0) return;
    void saveCaptureDraft(dKey, photos, { mode });
  }, [open, phase, pendingDraft, photos, mode, dKey]);

  /** Hydrate the draft into local state. Called from the Resume button. */
  const resumeDraft = async () => {
    const draft = await loadCaptureDraft(dKey);
    if (!draft) { setPendingDraft(null); return; }
    setPhotos(draft.photos);
    setMode(draft.meta.mode === 'questions' ? 'questions' : 'answers');
    setPendingDraft(null);
  };

  /** Drop the draft + reset; equivalent to "Start fresh". */
  const startFresh = async () => {
    await clearCaptureDraft(dKey);
    setPhotos([]);
    setPendingDraft(null);
  };

  /** Camera confirm handler. Slice 7k · if replaceIndex is set we
   *  splice the FIRST captured file into that slot (replace flow) and
   *  ignore any extras — single-page replace. Otherwise the legacy
   *  append flow runs (multi-page scan / single-shot photo). */
  const onCameraConfirm = (files: File[]) => {
    if (files.length === 0) {
      setCameraMode(null);
      setReplaceIndex(null);
      return;
    }
    if (replaceIndex !== null) {
      setPhotos((prev) => {
        if (replaceIndex < 0 || replaceIndex >= prev.length) return prev;
        const copy = prev.slice();
        copy[replaceIndex] = files[0];
        return copy;
      });
      setReplaceIndex(null);
    } else {
      setPhotos((prev) => [...prev, ...files]);
    }
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
  // Slice 7k · move ONE page up or down in the batch (used by the
  // arrow controls on each tile). Clamped to array bounds.
  const movePhoto = (idx: number, direction: -1 | 1) => {
    setPhotos((prev) => {
      const next = idx + direction;
      if (next < 0 || next >= prev.length) return prev;
      const copy = prev.slice();
      const [moved] = copy.splice(idx, 1);
      copy.splice(next, 0, moved);
      return copy;
    });
  };
  // Slice 7k · in-flight slot for the "Replace this page" flow. When
  // set, the next CameraCaptureSheet confirm splices into THIS index
  // instead of appending. Null = camera will append (default flow).
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);

  const runScore = async () => {
    if (photos.length === 0) return;
    setPhase('scoring');
    setError(null);
    const out = await scoreRevision({
      files: photos,
      kidName,
      mode,
      focusSubjects: settings.focus_subjects,
    });
    if ('skipped' in out && out.skipped) {
      setAiSkipped(true);
      setScore({
        mode, subject: 'Other', gradeLevel: '',
        score: 0,
        breakdown: { correct: 0, partial: 0, wrong: 0 },
        notes: 'AI is off on this preview — submit goes through; rating happens with parent review.',
        parsedQuestions: [],
      });
      setConfirmedSubject(null);
      setPhase('review');
      return;
    }
    if (!out.ok) {
      setError(out.error || 'Could not check this page. Try a clearer photo?');
      setPhase('capture');
      return;
    }
    setScore(out.data);
    // Reset subject confirmation — the kid hasn't seen this proposal yet.
    setConfirmedSubject(null);
    setDraftSubject(out.data.subject);

    // Answers mode generates "next 3 practice" follow-ups.
    // Questions mode skips this call — the parsed questions ARE the kid's
    // practice for now.
    if (mode === 'answers') {
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
    } else {
      setNextQuestions(null);
    }
    setPhase('review');
  };

  const submit = async () => {
    if (!score) return;
    // Gate submission on subject confirmation (Slice 7c). The kid must
    // ✓ accept or ✏️ correct the proposed subject first.
    const finalSubject = confirmedSubject ?? null;
    if (!finalSubject) {
      setError("Confirm the subject above — tap ✓ Yes if it's right, or ✏️ to correct it.");
      return;
    }
    setPhase('submitting');
    setError(null);
    try {
      // Reserve item id so storage path matches.
      const reservedRef = doc(collection(db, 'families', familyId, 'sparks_items'));
      const itemId = reservedRef.id;
      const urls = photos.length > 0
        ? await uploadSparksPhotos(familyId, itemId, photos)
        : [];

      // Score-based award path only applies in 'answers' mode.
      const qualifying = mode === 'answers' && score.score >= settings.qualifying_score;
      const bonus = mode === 'answers' && score.score >= settings.bonus_threshold;
      const willAwardNow = qualifying && !settings.parent_approval_required;
      const points = willAwardNow ? (bonus ? settings.bonus_points : settings.base_points) : 0;

      const titlePrefix = mode === 'questions' ? `${finalSubject} · Questions` : `${finalSubject} · Round`;

      await setDoc(reservedRef, {
        kid_id: kidId,
        area: 'revision',
        title: titlePrefix,
        description: score.notes || undefined,
        photo_urls: urls.map((u) => u.feedUrl),
        date: todayYmd(),
        subject: finalSubject,
        revision_data: {
          upload_mode: mode,
          ai_subject: score.subject || undefined,
          subject: finalSubject,
          subject_confirmed: true,
          grade_level: score.gradeLevel || undefined,
          // Score fields only meaningful in answers mode
          ...(mode === 'answers' ? {
            ai_score: score.score,
            ai_breakdown: score.breakdown,
            // Slice 7i · persist structured breakdown so the revisions
            // list can render Strengths / Areas / Q-by-Q without
            // re-calling the AI on every page open.
            ...(score.structured ? { ai_breakdown_structured: score.structured } : {}),
          } : {}),
          ai_notes: score.notes || undefined,
          parsed_questions: mode === 'questions' && score.parsedQuestions.length > 0
            ? score.parsedQuestions
            : undefined,
          next_questions: mode === 'answers' && nextQuestions && nextQuestions.length > 0
            ? nextQuestions
            : undefined,
          points_awarded: willAwardNow,
        },
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        created_by: uid,
      });

      // Auto-award when permitted by settings (qualifying answers + no approval required)
      if (willAwardNow) {
        const reason = bonus
          ? `Bonus revision — ${finalSubject} · ${score.score}%`
          : `Revision — ${finalSubject} · ${score.score}%`;
        const kind: AwardKind = 'regular';
        await giveAward(familyId, {
          childId: kidId,
          kind,
          points,
          reason,
          category: 'sparks-revision',
          awardedBy: uid,
          awardedByName: kidName,
          senderRole: 'parent',
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

      // Slice 7j · revision shipped — drop the IDB draft.
      void clearCaptureDraft(dKey);

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
              : phase === 'scoring'   ? (mode === 'questions' ? '📚 Reading the worksheet…' : '🧠 Reading your work…')
              : phase === 'review'    ? (
                  mode === 'questions'
                    ? `📚 ${score?.subject ?? 'Subject'}`
                    : `${score?.subject ?? 'Subject'} · ${score?.score ?? 0}%`
                )
              : phase === 'submitting'? 'Saving…'
              : '🎉 Submitted'}
            </h2>
          </div>

          <div className="p-5 space-y-4">

            {/* Phase: CAPTURE — mode toggle + multi-photo picker */}
            {phase === 'capture' && (
              <>
                {/* Slice 7j · Resume / Start fresh banner when an unsent
                    capture draft is found in IDB. Shows above all
                    capture controls so the kid sees it first; gates
                    the rest of the flow until they choose. */}
                {pendingDraft && (
                  <div className="rounded-2xl bg-[#FFF1C9] border-2 border-[#D4A847] px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl" aria-hidden>📂</span>
                      <div className="font-display font-extrabold text-[14px] text-[#5A4500]">
                        Welcome back, {kidName.split(' ')[0]}.
                      </div>
                    </div>
                    <div className="text-[12.5px] text-[#5A4500] leading-snug">
                      You have a draft from {new Date(pendingDraft.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} with{' '}
                      <strong>{pendingDraft.photoCount} page{pendingDraft.photoCount === 1 ? '' : 's'}</strong>{' '}
                      ({pendingDraft.mode === 'questions' ? 'questions' : 'answers'}). Pick up where you left off?
                    </div>
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => void resumeDraft()}
                        className="px-3.5 py-1.5 rounded-xl text-[12.5px] font-extrabold text-white"
                        style={{ background: '#5A3CB8' }}
                      >
                        ▶ Resume draft
                      </button>
                      <button
                        type="button"
                        onClick={() => void startFresh()}
                        className="px-3.5 py-1.5 rounded-xl text-[12.5px] font-extrabold bg-white border-2 border-[#D4A847] text-[#5A4500]"
                      >
                        🗑 Start fresh
                      </button>
                    </div>
                  </div>
                )}

                {/* Mode toggle — what are you uploading? */}
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
                    What are you uploading?
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMode('answers')}
                      className={`text-left rounded-xl border-2 p-3 transition-colors ${
                        mode === 'answers'
                          ? 'bg-[#E5D6FF] border-[#5A3CB8]'
                          : 'bg-[#FBF7EE] border-[#ECE4D3] hover:border-[#5A3CB8]/40'
                      }`}
                    >
                      <div className="text-xl" aria-hidden>📝</div>
                      <div className="font-display font-extrabold text-[13px] text-[#0F1F44] mt-0.5">My answers</div>
                      <div className="text-[10.5px] text-[#5A6488] mt-0.5 leading-snug">Completed work · AI scores it.</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('questions')}
                      className={`text-left rounded-xl border-2 p-3 transition-colors ${
                        mode === 'questions'
                          ? 'bg-[#E5D6FF] border-[#5A3CB8]'
                          : 'bg-[#FBF7EE] border-[#ECE4D3] hover:border-[#5A3CB8]/40'
                      }`}
                    >
                      <div className="text-xl" aria-hidden>📚</div>
                      <div className="font-display font-extrabold text-[13px] text-[#0F1F44] mt-0.5">The questions</div>
                      <div className="text-[10.5px] text-[#5A6488] mt-0.5 leading-snug">Worksheet · AI reads + helps you practice.</div>
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488]">
                      {mode === 'answers' ? 'Photos of your work' : 'Photos of the worksheet'}
                      {photos.length > 0 && <span className="text-[#0F1F44]"> · {photos.length}</span>}
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

                  {/* Slice 7k · per-page edit. Each tile carries a page
                      number badge, remove (×), replace (🔄), and arrow
                      controls (↑↓) so the kid can fix or reorder one
                      page without wiping the rest of the batch. */}
                  {photos.length > 0 && (
                    <div className="mt-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {previewUrls.map((url, idx) => {
                        const isFirst = idx === 0;
                        const isLast  = idx === photos.length - 1;
                        return (
                          <div key={url} className="relative aspect-square rounded-xl overflow-hidden bg-[#FBF7EE] border border-[#ECE4D3] group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={`Page ${idx + 1}`} className="w-full h-full object-cover" />

                            {/* Page-number badge — top-left */}
                            <span className="absolute top-1 left-1 bg-[#5A3CB8] text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">
                              {idx + 1}
                            </span>

                            {/* Remove — top-right */}
                            <button
                              type="button"
                              onClick={() => removePhoto(idx)}
                              aria-label={`Remove page ${idx + 1}`}
                              title={`Remove page ${idx + 1}`}
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/95 text-[#E85C5C] font-bold text-[12px] grid place-items-center shadow"
                            >
                              ×
                            </button>

                            {/* Reorder arrows — bottom-left vertical stack */}
                            <div className="absolute left-1 bottom-1 flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={() => movePhoto(idx, -1)}
                                disabled={isFirst}
                                aria-label={`Move page ${idx + 1} up`}
                                title="Move up"
                                className="w-5 h-5 rounded bg-white/95 text-[#5A3CB8] font-extrabold text-[10px] grid place-items-center shadow disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => movePhoto(idx, 1)}
                                disabled={isLast}
                                aria-label={`Move page ${idx + 1} down`}
                                title="Move down"
                                className="w-5 h-5 rounded bg-white/95 text-[#5A3CB8] font-extrabold text-[10px] grid place-items-center shadow disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                ↓
                              </button>
                            </div>

                            {/* Replace — full-width strip on the bottom */}
                            <button
                              type="button"
                              onClick={() => { setReplaceIndex(idx); setCameraMode('scan'); }}
                              aria-label={`Replace page ${idx + 1}`}
                              title="Replace this page — keeps the others"
                              className="absolute left-7 right-1 bottom-1 h-5 rounded bg-[#0F1F44]/85 hover:bg-[#0F1F44] text-white text-[10px] font-extrabold grid place-items-center"
                            >
                              🔄 Replace
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Replace-in-flight banner — visible while the camera
                      is open for a specific slot. Tells the kid pages 1
                      + 3 stay safe. */}
                  {replaceIndex !== null && (
                    <div className="mt-2 rounded-xl bg-[#FFF1C9] border border-[#D4A847] px-3 py-2 text-[11.5px] font-bold text-[#5A4500]">
                      ✏️ Replacing page {replaceIndex + 1} · other pages stay safe.
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

                  {/* Slice 7j · live draft indicator. Renders once the
                      first page lands, so the kid knows leaving won't
                      wipe the batch. Hidden while the Resume banner is
                      showing (different state). */}
                  {photos.length > 0 && !pendingDraft && (
                    <div className="mt-2 inline-flex items-center gap-1.5 text-[10.5px] font-bold text-[#2E7D34] bg-[#DDF5DF] border border-[#2E7D34]/15 rounded-full px-2.5 py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#2E7D34]" aria-hidden></span>
                      💾 Draft auto-saved · {photos.length} page{photos.length === 1 ? '' : 's'} kept if you leave
                    </div>
                  )}
                </div>

                <div className="bg-[#E5D6FF] border-l-2 border-[#5A3CB8] rounded-[10px] px-3 py-2 text-[11.5px] text-[#1B1547]">
                  {mode === 'answers' ? (
                    <>
                      <strong>How this works:</strong> Scan the page (auto-cleaned for sharp text) → Claude reads + scores it + suggests 3 next questions → confirm subject → submit to parent for feedback. Earn Kaya Points when you qualify ({settings.qualifying_score}%).
                    </>
                  ) : (
                    <>
                      <strong>How this works:</strong> Scan the worksheet (auto-cleaned for sharp text) → Claude reads the subject + the questions → confirm subject → submit to parent. Parents see what you&apos;re working on and can help.
                    </>
                  )}
                </div>
              </>
            )}

            {/* Phase: SCORING — spinner */}
            {phase === 'scoring' && (
              <div className="py-12 text-center">
                <div className="text-5xl mb-2 animate-pulse" aria-hidden>
                  {mode === 'questions' ? '📚' : '🧠'}
                </div>
                <div className="font-display font-extrabold text-[15px] text-[#0F1F44]">
                  {mode === 'questions' ? 'Reading the worksheet…' : 'Reading your work…'}
                </div>
                <div className="text-[12px] text-[#5A6488] mt-1">
                  Claude is {mode === 'questions' ? 'listing the questions on the page' : 'checking each question'}. ~3 seconds.
                </div>
              </div>
            )}

            {/* Phase: REVIEW — subject confirm + (score OR parsed questions) + next */}
            {phase === 'review' && score && (
              <>
                {/* Subject confirmation — AI proposes; kid accepts or corrects. */}
                <div className="bg-white border-2 border-[#5A3CB8]/30 rounded-2xl p-3.5">
                  <div className="text-[10px] font-extrabold tracking-[0.8px] text-[#5A3CB8] uppercase mb-1">
                    ✨ Claude thinks this is
                  </div>
                  {editingSubject ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={draftSubject}
                        onChange={(e) => setDraftSubject(e.target.value)}
                        placeholder="Subject"
                        autoFocus
                        maxLength={40}
                        className="flex-1 bg-[#FBF7EE] border border-[#ECE4D3] rounded-lg px-3 py-2 text-[14px] font-bold text-[#0F1F44]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const v = draftSubject.trim();
                          if (!v) return;
                          setConfirmedSubject(v);
                          setEditingSubject(false);
                        }}
                        disabled={!draftSubject.trim()}
                        className="px-3 py-2 rounded-lg text-[12px] font-extrabold disabled:opacity-40 text-white"
                        style={{ background: '#5A3CB8' }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditingSubject(false); setDraftSubject(score.subject); }}
                        className="px-2.5 py-2 text-[12px] font-bold text-[#5A6488]"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-2xl shrink-0" aria-hidden>📚</span>
                        <div className="min-w-0">
                          <div className="font-display font-extrabold text-[17px] text-[#0F1F44] truncate">
                            {confirmedSubject ?? score.subject ?? 'Subject'}
                          </div>
                          {score.gradeLevel && (
                            <div className="text-[11px] text-[#5A6488]">{score.gradeLevel}</div>
                          )}
                        </div>
                      </div>
                      {confirmedSubject ? (
                        <button
                          type="button"
                          onClick={() => { setEditingSubject(true); setDraftSubject(confirmedSubject); }}
                          className="text-[11px] font-bold text-[#5A3CB8] hover:bg-[#FBF7EE] rounded px-2 py-1 whitespace-nowrap"
                        >
                          ✏️ Change
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setConfirmedSubject(score.subject)}
                            className="px-3 py-1.5 rounded-full text-[12px] font-extrabold text-white whitespace-nowrap"
                            style={{ background: '#2E7D34' }}
                          >
                            ✓ Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingSubject(true); setDraftSubject(score.subject); }}
                            className="px-3 py-1.5 rounded-full text-[12px] font-extrabold whitespace-nowrap"
                            style={{ background: '#E5D6FF', color: '#5A3CB8' }}
                          >
                            ✏️ Correct it
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {!confirmedSubject && !editingSubject && (
                    <div className="text-[11px] text-[#5A6488] mt-2 italic">
                      Confirm or correct the subject before submitting.
                    </div>
                  )}
                </div>

                {/* Big score — answers mode only */}
                {mode === 'answers' && (
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
                )}

                {/* Questions mode header — replaces the score card */}
                {mode === 'questions' && (
                  <div className="bg-gradient-to-br from-[#E5D6FF] to-[#C9F0EC] rounded-2xl p-4">
                    <div className="text-[10px] font-extrabold tracking-[1px] text-[#1B1547] uppercase opacity-75">📚 Worksheet · questions mode</div>
                    <div className="font-display font-extrabold text-[16px] text-[#1B1547] mt-1">
                      {score.parsedQuestions.length} questions Claude could read
                    </div>
                    <div className="text-[11.5px] text-[#1B1547]/75 mt-1 leading-snug">
                      Submit so your parent sees what you&apos;re practicing. Go answer them, then come back with &quot;My answers&quot; mode for scoring + Kaya Points.
                    </div>
                  </div>
                )}

                {/* Scan quality badge (Slice 7d). When Claude couldn't
                    parse the page — subject="Other" with no countable
                    work and no parsed questions — surface a clear "try
                    again" affordance instead of silently scoring zero.
                    For clear scans, show a quiet confidence chip. */}
                {(() => {
                  const looksUnreadable =
                    score.subject === 'Other'
                    && (mode === 'answers'
                          ? (score.breakdown.correct + score.breakdown.partial + score.breakdown.wrong === 0)
                          : score.parsedQuestions.length === 0);
                  if (looksUnreadable) {
                    return (
                      <div className="bg-[#FFE7E0] border border-[#E85C5C]/40 rounded-xl px-3.5 py-3 text-[12.5px] text-[#A33A2A] flex items-center gap-3">
                        <span className="text-2xl shrink-0" aria-hidden>🔍</span>
                        <div className="flex-1">
                          <div className="font-bold mb-0.5">Couldn&apos;t read this page clearly</div>
                          <div className="text-[11.5px] opacity-90">Try a brighter spot, hold the camera steady + flat above the page. The Scan tile auto-cleans the image for AI.</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPhase('capture')}
                          className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold bg-white text-[#A33A2A] border border-[#E85C5C]/40 whitespace-nowrap"
                        >
                          Re-scan
                        </button>
                      </div>
                    );
                  }
                  if (!aiSkipped) {
                    return (
                      <div className="inline-flex items-center gap-1.5 bg-[#DDF5DF] text-[#2E7D34] rounded-full px-2.5 py-1 text-[10.5px] font-extrabold">
                        ✓ Clear scan · Claude could read it
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* AI notes */}
                {score.notes && (
                  <div className="bg-white border border-[#ECE4D3] rounded-xl p-3.5">
                    <div className="text-[10px] font-extrabold tracking-[0.8px] text-[#5A3CB8] uppercase mb-1">✨ Claude says</div>
                    <div className="text-[13px] text-[#0F1F44] leading-snug">{score.notes}</div>
                  </div>
                )}

                {/* Parsed questions (questions mode) */}
                {mode === 'questions' && score.parsedQuestions.length > 0 && (
                  <div className="bg-[#FBF7EE] rounded-xl p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] font-extrabold tracking-[0.8px] text-[#5A3CB8] uppercase">📚 Questions on this page</div>
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="text-[10.5px] font-bold text-[#5A3CB8] hover:bg-white rounded px-2 py-0.5"
                      >
                        🖨 Print
                      </button>
                    </div>
                    <ol className="m-0 pl-5 text-[12.5px] text-[#0F1F44] leading-relaxed">
                      {score.parsedQuestions.map((q, idx) => (
                        <li key={idx} className="py-1">{q}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Next 3 questions (answers mode only) */}
                {mode === 'answers' && nextQuestions && nextQuestions.length > 0 && (
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
                    {mode === 'questions' ? '✨ Read the questions' : '✨ Score my revision'}
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
                    disabled={!confirmedSubject}
                    className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: '#5A3CB8' }}
                    title={!confirmedSubject ? 'Confirm the subject first' : ''}
                  >
                    Submit to parent
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
