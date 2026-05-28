'use client';

// Kaya Sparks · revision thread sheet (Slice 7e · 2026-05-28).
//
// Bottom-sheet conversation on a sparks_item. Kid + parent (+ helper
// with sparks-act grant) can post text + photos back and forth. Used
// primarily on revisions so a kid can respond to a parent's feedback
// — "I redid #4, here it is" — without creating a new revision row.
//
// Photos reuse the existing sparks Storage path
// (`families/{f}/sparks/{itemId}/{photoId}/{size}.jpg`) so no
// storage.rules change is needed; we just stash extra photoIds under
// the same item.

import { collection, doc } from 'firebase/firestore';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { db } from '@/lib/firebase';
import {
  postThreadMessage, subscribeToThread,
} from '@/lib/sparks/firestore';
import { uploadSparksPhotos } from '@/lib/sparks/uploadPhoto';
import { type SparksItem, type SparksThreadMessage } from '@/lib/sparks/schema';
import PhotoLightbox from './PhotoLightbox';

interface Props {
  open: boolean;
  onClose: () => void;
  familyId: string;
  item: SparksItem;
  /** Authoring user — who's posting. */
  authorUid: string;
  authorName: string;
  authorRole: 'parent' | 'helper' | 'kid';
}

export default function ThreadSheet({
  open, onClose, familyId, item, authorUid, authorName, authorRole,
}: Props) {
  const formId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<SparksThreadMessage[]>([]);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<{ photos: string[]; index: number } | null>(null);

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

  useEffect(() => {
    if (!open) return;
    setText('');
    setPhotos([]);
    setError(null);
    setPosting(false);
  }, [open]);

  const previewUrls = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => previewUrls.forEach((u) => URL.revokeObjectURL(u)), [previewUrls]);

  const addPhotos: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length > 0) setPhotos((prev) => [...prev, ...picked]);
    if (fileRef.current) fileRef.current.value = '';
  };
  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const canPost = !posting && (text.trim().length > 0 || photos.length > 0);

  const onPost = async () => {
    if (!canPost) return;
    setPosting(true);
    setError(null);
    try {
      // Reserve a message id so any uploaded photos can sit under the
      // item's storage path with the message's authorship implicit.
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
      // discard reservedRef — we used a generated id; the helper created
      // its own document via addDoc. (We kept the ref for a future where
      // we want strict id control; harmless for now.)
      void reservedRef;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post. Try again?');
    } finally {
      setPosting(false);
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
          className="relative w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] flex flex-col bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
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
              messages.map((m) => <ThreadBubble key={m.id} msg={m} viewerUid={authorUid} onOpenPhoto={(urls, i) => setLightboxIndex({ photos: urls, index: i })} />)
            )}
          </div>

          {/* Photo previews */}
          {photos.length > 0 && (
            <div className="px-4 pt-3 pb-1 bg-white border-t border-[#ECE4D3]">
              <div className="flex items-center gap-2 overflow-x-auto">
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
            </div>
          )}

          {error && (
            <div className="px-4 py-2 bg-[#FFE7E0] text-[#A33A2A] text-[12px] font-bold">{error}</div>
          )}

          {/* Composer */}
          <div className="px-3 py-3 bg-white border-t border-[#ECE4D3] flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-10 h-10 shrink-0 grid place-items-center rounded-full text-[#5A3CB8] hover:bg-[#FBF7EE]"
              aria-label="Attach photo"
              title="Attach photo"
              disabled={posting}
            >
              <span className="text-xl" aria-hidden>📷</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              onChange={addPhotos}
              className="hidden"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && canPost) {
                  e.preventDefault();
                  void onPost();
                }
              }}
              placeholder={authorRole === 'kid' ? 'Reply to your parent…' : `Reply to the kid…`}
              rows={1}
              maxLength={1500}
              className="flex-1 bg-[#FBF7EE] border border-[#ECE4D3] rounded-2xl px-3.5 py-2 text-[14px] text-[#0F1F44] focus:outline-none focus:border-[#5A3CB8] resize-none max-h-32"
            />
            <button
              type="button"
              onClick={onPost}
              disabled={!canPost}
              className="px-3.5 py-2 rounded-2xl text-[13px] font-extrabold disabled:opacity-40 text-white shrink-0"
              style={{ background: '#5A3CB8' }}
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
  msg, viewerUid, onOpenPhoto,
}: {
  msg: SparksThreadMessage;
  viewerUid: string;
  onOpenPhoto: (urls: string[], index: number) => void;
}) {
  const isMine = msg.authorUid === viewerUid;
  const photoUrls = msg.photo_urls ?? [];
  const time = msg.createdAt
    ? msg.createdAt.toDate().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  const roleIcon = msg.authorRole === 'parent' ? '👤' : msg.authorRole === 'helper' ? '🤝' : '🧒';
  // Coral for parent · mint for kid · warm yellow for helper.
  const bg = isMine
    ? '#5A3CB8'
    : msg.authorRole === 'parent'
      ? '#FFE7E0'
      : msg.authorRole === 'helper'
        ? '#FFF1C9'
        : '#C9F0EC';
  const fg = isMine ? '#fff' : '#0F1F44';

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[78%] rounded-2xl px-3 py-2 shadow-sm"
        style={{ background: bg, color: fg }}
      >
        <div className={`text-[10.5px] font-extrabold mb-1 ${isMine ? 'opacity-80' : 'opacity-75'}`}>
          {roleIcon} {msg.authorName}{time ? ` · ${time}` : ''}
        </div>
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
