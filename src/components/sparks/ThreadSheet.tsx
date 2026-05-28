'use client';

// Kaya Sparks · revision thread sheet (Slice 7e + 7f).
//
// Bottom-sheet conversation on a sparks_item. Kid + parent (+ helper
// with sparks-act grant) can post text + photos back and forth. Used
// primarily on revisions so a kid can respond to a parent's feedback
// — "I redid #4, here it is" — without creating a new revision row.
//
// Slice 7f (2026-05-28):
//   · 3-tile composer (Scan + Picture + Gallery) mirroring the main
//     revision capture, so a kid can re-snap properly in the thread.
//   · 🔁 Re-do button — AI rescans the new photos, posts a redo-kind
//     message with the new score + breakdown + delta vs prior. Runs
//     under the existing /api/sparks/ai/revision-score endpoint.
//
// Photos reuse the existing sparks Storage path
// (`families/{f}/sparks/{itemId}/{photoId}/{size}.jpg`) so no
// storage.rules change is needed.

import { collection, doc } from 'firebase/firestore';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { db } from '@/lib/firebase';
import {
  postThreadMessage, subscribeToThread,
} from '@/lib/sparks/firestore';
import { uploadSparksPhotos } from '@/lib/sparks/uploadPhoto';
import { scoreRevision } from '@/lib/sparks/ai';
import { clearDraft, draftKey, loadDraft, saveDraft } from '@/lib/sparks/draftStore';
import { type SparksItem, type SparksThreadMessage } from '@/lib/sparks/schema';
import PhotoLightbox from './PhotoLightbox';
import CameraCaptureSheet from '@/components/messaging/CameraCaptureSheet';

interface Props {
  open: boolean;
  onClose: () => void;
  familyId: string;
  item: SparksItem;
  /** Authoring user — who's posting. */
  authorUid: string;
  authorName: string;
  authorRole: 'parent' | 'helper' | 'kid';
  /** Optional kid name for AI rescoring prompts. Falls back to the
   *  author's name when missing (good enough for the AI's grading
   *  voice). */
  kidName?: string;
}

export default function ThreadSheet({
  open, onClose, familyId, item, authorUid, authorName, authorRole, kidName,
}: Props) {
  const formId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<SparksThreadMessage[]>([]);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  const [redoing, setRedoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<{ photos: string[]; index: number } | null>(null);
  const [cameraMode, setCameraMode] = useState<'scan' | 'photo' | null>(null);

  // Re-do is only meaningful on revision items the AI scored (answers
  // mode). Question-mode uploads + non-revision items skip the button.
  const isRevision = item.area === 'revision';
  const canRedo = isRevision && (item.revision_data?.upload_mode ?? 'answers') === 'answers';
  // The prior score we're comparing against — the latest redo's score
  // if any, otherwise the item's original ai_score. Used by the redo
  // bubbles + the redo-button label.
  const priorScore = useMemo(() => {
    const lastRedo = [...messages].reverse().find((m) => m.kind === 'redo' && typeof m.redo_score === 'number');
    if (lastRedo && typeof lastRedo.redo_score === 'number') return lastRedo.redo_score;
    return item.revision_data?.ai_score ?? null;
  }, [messages, item.revision_data?.ai_score]);
  // 1-indexed redo round for the next attempt.
  const nextRedoRound = useMemo(
    () => messages.filter((m) => m.kind === 'redo').length + 1,
    [messages],
  );

  useEffect(() => {
    if (!open) return;
    return subscribeToThread(familyId, item.id, setMessages);
  }, [open, familyId, item.id]);

  // Auto-scroll to the bottom on new message arrivals + initial mount.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages.length]);

  // Persisted-draft key for this kid's thread, scoped to the author.
  // Drafts survive accidental closes; cleared only after a successful
  // post / redo.
  const dKey = useMemo(
    () => draftKey('thread', { familyId, itemId: item.id, userId: authorUid }),
    [familyId, item.id, authorUid],
  );

  // On open: reset transient state, restore any unsent draft text from
  // localStorage. Photos can't be persisted (File objects aren't
  // serialisable), so the staged-photos pane starts empty each open.
  useEffect(() => {
    if (!open) return;
    setPhotos([]);
    setError(null);
    setPosting(false);
    setRedoing(false);
    setCameraMode(null);
    setText(loadDraft(dKey) ?? '');
  }, [open, dKey]);

  // Persist every keystroke to localStorage. saveDraft removes the
  // entry when text is empty, so a successful send (which calls
  // setText('')) drops the draft automatically.
  useEffect(() => {
    if (!open) return;
    saveDraft(dKey, text);
  }, [open, dKey, text]);

  const previewUrls = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => previewUrls.forEach((u) => URL.revokeObjectURL(u)), [previewUrls]);

  const addPhotos: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length > 0) setPhotos((prev) => [...prev, ...picked]);
    if (fileRef.current) fileRef.current.value = '';
  };
  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const onCameraConfirm = (files: File[]) => {
    if (files.length === 0) return;
    setPhotos((prev) => [...prev, ...files]);
    setCameraMode(null);
  };

  const busy = posting || redoing;
  const canPost = !busy && (text.trim().length > 0 || photos.length > 0);
  const canSendRedo = !busy && canRedo && photos.length > 0;

  const onPost = async () => {
    if (!canPost) return;
    setPosting(true);
    setError(null);
    try {
      const reservedRef = doc(collection(db, 'families', familyId, 'sparks_items', item.id, 'thread'));
      const photoUrls: string[] = [];
      if (photos.length > 0) {
        const uploaded = await uploadSparksPhotos(familyId, item.id, photos);
        photoUrls.push(...uploaded.map((u) => u.feedUrl));
      }
      await postThreadMessage(familyId, item.id, {
        authorUid,
        authorName,
        authorRole,
        text: text.trim() || undefined,
        photo_urls: photoUrls.length > 0 ? photoUrls : undefined,
      });
      setText('');
      setPhotos([]);
      clearDraft(dKey);
      void reservedRef;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post. Try again?');
    } finally {
      setPosting(false);
    }
  };

  const onRedo = async () => {
    if (!canSendRedo) return;
    setRedoing(true);
    setError(null);
    try {
      // 1. AI rescore the new photos under the same answers-mode prompt.
      const score = await scoreRevision({
        files: photos,
        kidName: kidName ?? authorName,
        mode: 'answers',
      });

      let redoScore: number | undefined;
      let redoBreakdown: { correct: number; partial: number; wrong: number } | undefined;
      let redoNotes: string | undefined;
      if (score.ok) {
        redoScore = score.data.score;
        redoBreakdown = score.data.breakdown;
        redoNotes = score.data.notes;
      } else if (score.skipped) {
        redoNotes = 'AI is off on this environment — re-do posted without a score.';
      } else if (score.error) {
        // Don't block posting if scoring fails — the kid still wants to
        // share the retry; the bubble shows "no score" with a hint.
        redoNotes = `Couldn't rescore: ${score.error}`;
      }

      // 2. Upload the photos.
      const uploaded = await uploadSparksPhotos(familyId, item.id, photos);
      const photoUrls = uploaded.map((u) => u.feedUrl);

      // 3. Post the redo message.
      await postThreadMessage(familyId, item.id, {
        authorUid,
        authorName,
        authorRole,
        text: text.trim() || undefined,
        photo_urls: photoUrls,
        kind: 'redo',
        redo_score: redoScore,
        redo_breakdown: redoBreakdown,
        redo_notes: redoNotes,
        redo_round: nextRedoRound,
      });

      setText('');
      setPhotos([]);
      clearDraft(dKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-do failed. Try again?');
    } finally {
      setRedoing(false);
    }
  };

  if (!open) return null;

  const itemSubject = item.revision_data?.subject || item.subject || item.title || 'Revision';

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
          className="relative w-full sm:max-w-xl max-h-[92vh] sm:max-h-[88vh] flex flex-col bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
        >
          {/* Coloured head — revision gradient */}
          <div
            className="px-5 pt-5 pb-4 text-white"
            style={{ background: 'linear-gradient(135deg, #1B1547 0%, #5A3CB8 100%)' }}
          >
            <div className="text-[12px] opacity-85">💬 Thread · {itemSubject}</div>
            <h2 id={`${formId}-title`} className="font-display font-extrabold text-[18px] m-0 mt-0.5">
              {messages.length === 0 ? 'Start the conversation' : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
            </h2>
          </div>

          {/* Message list */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#FBF7EE]">
            {messages.length === 0 ? (
              <div className="text-center text-[12.5px] text-[#5A6488] py-12">
                <div className="text-3xl mb-2" aria-hidden>💬</div>
                <div>No messages yet — say something below.</div>
              </div>
            ) : (
              messages.map((m, idx) => {
                // For redo bubbles, look back to find the prior score the
                // bubble should compare against (older redo or original
                // ai_score).
                let comparedAgainst: number | null = null;
                if (m.kind === 'redo' && typeof m.redo_score === 'number') {
                  for (let i = idx - 1; i >= 0; i--) {
                    const prev = messages[i];
                    if (prev.kind === 'redo' && typeof prev.redo_score === 'number') {
                      comparedAgainst = prev.redo_score;
                      break;
                    }
                  }
                  if (comparedAgainst === null) {
                    comparedAgainst = item.revision_data?.ai_score ?? null;
                  }
                }
                return (
                  <ThreadBubble
                    key={m.id}
                    msg={m}
                    viewerUid={authorUid}
                    onOpenPhoto={(urls, i) => setLightboxIndex({ photos: urls, index: i })}
                    comparedAgainst={comparedAgainst}
                  />
                );
              })
            )}
          </div>

          {/* 3-tile attach row + photo previews (Slice 7f). Same shape
              as the main revision capture so a kid can re-snap properly
              from inside the thread. */}
          <div className="px-4 pt-3 pb-2 bg-white border-t border-[#ECE4D3]">
            <div className={`grid ${canRedo ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
              {canRedo && (
                <button
                  type="button"
                  onClick={() => setCameraMode('scan')}
                  disabled={busy}
                  className="rounded-xl border-2 border-dashed border-[#E5D6FF] bg-[#F6EFFF] hover:border-[#5A3CB8] hover:bg-[#EFE3FF] transition-colors py-2.5 px-2 text-center disabled:opacity-50"
                  title="Scan each page — auto-cleaned for AI."
                >
                  <div className="text-xl leading-none" aria-hidden>📄</div>
                  <div className="text-[11px] font-extrabold text-[#5A3CB8] mt-0.5">Scan</div>
                </button>
              )}
              <button
                type="button"
                onClick={() => setCameraMode('photo')}
                disabled={busy}
                className="rounded-xl border-2 border-dashed border-[#ECE4D3] bg-[#FBF7EE] hover:border-[#D4A847] hover:bg-[#FFFBF5] transition-colors py-2.5 px-2 text-center disabled:opacity-50"
                title="Snap a fresh photo."
              >
                <div className="text-xl leading-none" aria-hidden>📷</div>
                <div className="text-[11px] font-extrabold text-[#0F1F44] mt-0.5">Picture</div>
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="rounded-xl border-2 border-dashed border-[#ECE4D3] bg-[#FBF7EE] hover:border-[#D4A847] hover:bg-[#FFFBF5] transition-colors py-2.5 px-2 text-center disabled:opacity-50"
                title="Pick photos from the gallery."
              >
                <div className="text-xl leading-none" aria-hidden>📁</div>
                <div className="text-[11px] font-extrabold text-[#0F1F44] mt-0.5">Gallery</div>
              </button>
            </div>

            {photos.length > 0 && (
              <div className="mt-2 flex items-center gap-2 overflow-x-auto">
                {previewUrls.map((url, idx) => (
                  <div key={url} className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 border border-[#ECE4D3]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Pending ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(idx)}
                      aria-label={`Remove pending photo ${idx + 1}`}
                      className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-white text-[#E85C5C] font-bold text-[10px] grid place-items-center shadow"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={addPhotos}
            className="hidden"
          />

          {error && (
            <div className="px-4 py-2 bg-[#FFE7E0] text-[#A33A2A] text-[12px] font-bold">{error}</div>
          )}

          {/* Composer */}
          <div className="px-3 py-3 bg-white border-t border-[#ECE4D3] flex items-center gap-1.5">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && canPost) {
                  e.preventDefault();
                  void onPost();
                }
              }}
              placeholder={authorRole === 'kid' ? 'Reply to your parent…' : 'Reply to the kid…'}
              rows={1}
              maxLength={1500}
              className="flex-1 bg-[#FBF7EE] border border-[#ECE4D3] rounded-2xl px-3.5 py-2 text-[14px] text-[#0F1F44] focus:outline-none focus:border-[#5A3CB8] resize-none max-h-32"
            />
            {canRedo && (
              <button
                type="button"
                onClick={onRedo}
                disabled={!canSendRedo}
                title={photos.length === 0 ? 'Attach at least one photo to re-do' : `Rescore as redo #${nextRedoRound}`}
                className="px-3 py-2 rounded-2xl text-[13px] font-extrabold disabled:opacity-40 text-white shrink-0"
                style={{ background: '#5A3CB8' }}
              >
                {redoing ? '🔁…' : `🔁 Re-do${priorScore !== null ? ` · prior ${priorScore}%` : ''}`}
              </button>
            )}
            <button
              type="button"
              onClick={onPost}
              disabled={!canPost}
              className="px-3.5 py-2 rounded-2xl text-[13px] font-extrabold disabled:opacity-40 shrink-0"
              style={{ background: '#D4A847', color: '#0F1F44' }}
            >
              {posting ? '…' : 'Send'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-2 text-[#5A6488] text-[12px] font-bold hover:bg-[#FBF7EE] rounded-lg shrink-0"
              aria-label="Close thread"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* In-app camera — Scan (multi-page + auto-clean) or Photo
          (single shot + AI enhance). Renders above the thread sheet. */}
      <CameraCaptureSheet
        open={cameraMode !== null}
        mode={cameraMode ?? 'photo'}
        onClose={() => setCameraMode(null)}
        onConfirm={onCameraConfirm}
      />

      {lightboxIndex && (
        <PhotoLightbox
          photos={lightboxIndex.photos}
          index={lightboxIndex.index}
          onIndexChange={(i) => setLightboxIndex({ ...lightboxIndex, index: i })}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

// ── Message bubble ──────────────────────────────────────────────────

function ThreadBubble({
  msg, viewerUid, onOpenPhoto, comparedAgainst,
}: {
  msg: SparksThreadMessage;
  viewerUid: string;
  onOpenPhoto: (urls: string[], index: number) => void;
  /** For redo bubbles only — the prior score we're comparing against,
   *  so the bubble can render a Δ chip. null when there's nothing to
   *  compare to (first redo on a no-AI item). */
  comparedAgainst: number | null;
}) {
  const isMine = msg.authorUid === viewerUid;
  const photoUrls = msg.photo_urls ?? [];
  const time = msg.createdAt
    ? msg.createdAt.toDate().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  const roleIcon = msg.authorRole === 'parent' ? '👤' : msg.authorRole === 'helper' ? '🤝' : '🧒';
  const isRedo = msg.kind === 'redo';

  // Redo bubbles always use the violet palette so they pop in the
  // trail. Other bubbles keep the existing role-coloured scheme.
  let bg: string;
  let fg: string;
  if (isRedo) {
    bg = isMine ? '#5A3CB8' : '#E5D6FF';
    fg = isMine ? '#fff' : '#1B1547';
  } else {
    bg = isMine
      ? '#5A3CB8'
      : msg.authorRole === 'parent'
        ? '#FFE7E0'
        : msg.authorRole === 'helper'
          ? '#FFF1C9'
          : '#C9F0EC';
    fg = isMine ? '#fff' : '#0F1F44';
  }

  const hasScore = isRedo && typeof msg.redo_score === 'number';
  const delta = hasScore && comparedAgainst !== null && typeof msg.redo_score === 'number'
    ? msg.redo_score - comparedAgainst
    : null;

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[80%] rounded-2xl px-3 py-2 shadow-sm"
        style={{ background: bg, color: fg }}
      >
        <div className={`text-[10.5px] font-extrabold mb-1 ${isMine ? 'opacity-80' : 'opacity-75'}`}>
          {roleIcon} {msg.authorName}{time ? ` · ${time}` : ''}
          {isRedo && typeof msg.redo_round === 'number' && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#FFF1C9] text-[#8A6800] text-[9.5px]">
              🔁 Re-do #{msg.redo_round}
            </span>
          )}
        </div>

        {/* Score chip + delta — redo bubbles only. */}
        {isRedo && hasScore && (
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[14px] font-extrabold rounded-full px-2.5 py-1"
              style={{ background: isMine ? '#FFF1C9' : '#5A3CB8', color: isMine ? '#8A6800' : '#fff' }}
            >
              🎯 {msg.redo_score}%
            </span>
            {delta !== null && (
              <span
                className="text-[11px] font-extrabold rounded-full px-2 py-0.5"
                style={{
                  background: delta > 0 ? '#DDF5DF' : delta < 0 ? '#FFE7E0' : '#ECE4D3',
                  color:      delta > 0 ? '#2E7D34' : delta < 0 ? '#A33A2A' : '#5A6488',
                }}
              >
                {delta > 0 ? `↑ +${delta}` : delta < 0 ? `↓ ${delta}` : '· no change'}
              </span>
            )}
          </div>
        )}

        {isRedo && msg.redo_notes && (
          <div className="text-[12px] italic mb-1 opacity-90 leading-snug">{msg.redo_notes}</div>
        )}

        {msg.text && (
          <div className="text-[13px] leading-snug whitespace-pre-wrap break-words">{msg.text}</div>
        )}

        {photoUrls.length > 0 && (
          <div className={`grid gap-1 mt-1 ${photoUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {photoUrls.map((url, idx) => (
              <button
                key={url + idx}
                type="button"
                onClick={() => onOpenPhoto(photoUrls, idx)}
                className="p-0 border-0 rounded-lg overflow-hidden cursor-zoom-in"
                aria-label={`Open photo ${idx + 1} full screen`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Photo ${idx + 1}`} className="w-full max-h-48 object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
