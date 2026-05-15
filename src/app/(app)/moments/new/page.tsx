'use client';

// /moments/new — composer for a new family Moment.
//
// Flow:
//   1. Parent picks 1–10 photos from the device camera roll.
//   2. We resize each in-browser to three variants (thumb / feed / full)
//      and show a preview grid so they can reorder or remove.
//   3. They write a caption, tag kids, optionally pick an event chip.
//   4. Submit reserves a post id, uploads photos in parallel under that
//      id's Storage path, finalises the post doc, and routes to the
//      detail page.
//
// We upload only after Submit (no auto-upload on pick) so a parent who
// changes their mind can back out without paying Storage. Progress is
// surfaced as "Uploading 3 of 5…" so big posts don't feel frozen.

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  reservePost, finalizePost, uploadProcessedPhoto, deletePost,
  EVENT_TAGS, EventTag, PhotoRef, Post,
} from '@/lib/moments';
import {
  processPhotoForUpload, ProcessedPhoto, MAX_PHOTO_BYTES,
} from '@/lib/photoUpload';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const MAX_PHOTOS = 10;

// In-memory state per picked file: blobs ready to upload plus a local
// preview URL the composer renders before the Storage URLs exist.
interface DraftPhoto {
  id: string;             // local-only id for keying + reorder
  fileName: string;
  processed: ProcessedPhoto;
  previewUrl: string;     // object URL for the feed-size preview
}

export default function ComposeMomentPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [drafts, setDrafts] = useState<DraftPhoto[]>([]);
  const [caption, setCaption] = useState('');
  const [kidTags, setKidTags] = useState<string[]>([]);
  const [eventTag, setEventTag] = useState<EventTag | undefined>(undefined);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');

  if (isGuest) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-12 lg:pt-16 text-center">
        <p className="text-5xl mb-3">📸</p>
        <p className="text-kaya-sand text-sm">Posting Moments is disabled in the demo. Sign up to start your family feed.</p>
      </div>
    );
  }

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (drafts.length + files.length > MAX_PHOTOS) {
      setError(`Maximum ${MAX_PHOTOS} photos per post.`);
      return;
    }
    setError('');
    setProcessing(true);
    const next: DraftPhoto[] = [];
    for (const file of files) {
      try {
        if (file.size > MAX_PHOTO_BYTES) {
          throw new Error(`${file.name} is too large (>${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB).`);
        }
        const processed = await processPhotoForUpload(file);
        next.push({
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          fileName: file.name,
          processed,
          previewUrl: URL.createObjectURL(processed.feedBlob),
        });
      } catch (err: any) {
        setError(err?.message || `Couldn't process ${file.name}.`);
      }
    }
    setDrafts((prev) => [...prev, ...next]);
    setProcessing(false);
    // Reset the input so the user can re-pick the same file later
    // (browsers don't fire 'change' for the same selection twice).
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeDraft = (id: string) => {
    setDrafts((prev) => {
      const target = prev.find((d) => d.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((d) => d.id !== id);
    });
  };

  const moveDraft = (id: string, dir: -1 | 1) => {
    setDrafts((prev) => {
      const i = prev.findIndex((d) => d.id === id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const toggleKidTag = (childId: string) => {
    setKidTags((prev) =>
      prev.includes(childId) ? prev.filter((id) => id !== childId) : [...prev, childId],
    );
  };

  const canSubmit = drafts.length > 0 && !processing && !uploading;

  const submit = async () => {
    if (!profile?.familyId || !canSubmit) return;
    setError('');
    setUploading(true);
    setProgress({ done: 0, total: drafts.length });

    // Reserve the post id first so all uploaded blobs nest under the
    // eventual doc. If anything fails mid-upload we delete the
    // reservation to keep the feed clean.
    let postId: string;
    try {
      postId = await reservePost(profile.familyId, profile.uid);
    } catch (e: any) {
      setError(e?.message || 'Could not start the post.');
      setUploading(false);
      return;
    }

    const uploaded: PhotoRef[] = [];
    try {
      // Sequential uploads — friendlier on slow mobile connections than
      // a 10-way fan-out, and keeps the progress counter monotonic.
      for (const d of drafts) {
        const ref = await uploadProcessedPhoto(profile.familyId, postId, d.processed);
        uploaded.push(ref);
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
      const postData: Omit<Post, 'id' | 'reactionCount' | 'reactionsByType' | 'commentCount' | 'createdAt' | 'updatedAt'> = {
        authorUid: profile.uid,
        authorName: profile.displayName,
        authorAvatar: profile.avatarPhoto,
        caption: caption.trim(),
        photos: uploaded,
        kidTags,
        eventTag,
        visibility: 'family',
      };
      await finalizePost(profile.familyId, postId, postData);
      // Revoke local previews before navigating.
      drafts.forEach((d) => URL.revokeObjectURL(d.previewUrl));
      router.replace(`/moments/${postId}`);
    } catch (e: any) {
      setError(e?.message || 'Upload failed. Tap Submit to retry.');
      // Best-effort cleanup of any photos that did make it up.
      try {
        await deletePost(profile.familyId, {
          id: postId,
          authorUid: profile.uid,
          authorName: profile.displayName,
          caption: '',
          photos: uploaded,
          kidTags: [],
          visibility: 'family',
          reactionCount: 0,
          reactionsByType: { '❤️': 0, '👏': 0, '😂': 0, '🎉': 0 },
          commentCount: 0,
        } as any);
      } catch { /* swallow — orphan blobs cost cents */ }
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Moments</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black tracking-tight">Share a moment</h1>
        <p className="text-sm text-kaya-sand mt-1">
          Up to {MAX_PHOTOS} photos. The whole family sees it on the feed.
        </p>
      </div>

      {/* ── Picker / preview grid ────────────────────────────── */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
        <div className="grid grid-cols-3 gap-2 mb-3">
          {drafts.map((d, i) => (
            <div key={d.id} className="relative aspect-square rounded-kaya-sm overflow-hidden bg-kaya-warm">
              <img src={d.previewUrl} alt={d.fileName} className="w-full h-full object-cover" />
              <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold rounded px-1.5 py-0.5">
                {i + 1}
              </div>
              <button
                onClick={() => removeDraft(d.id)}
                disabled={uploading}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs disabled:opacity-30"
                aria-label="Remove photo"
              >✕</button>
              <div className="absolute bottom-1 left-1 right-1 flex justify-between">
                <button
                  onClick={() => moveDraft(d.id, -1)}
                  disabled={uploading || i === 0}
                  className="w-6 h-6 rounded-full bg-black/60 text-white text-xs disabled:opacity-20"
                  aria-label="Move left"
                >←</button>
                <button
                  onClick={() => moveDraft(d.id, 1)}
                  disabled={uploading || i === drafts.length - 1}
                  className="w-6 h-6 rounded-full bg-black/60 text-white text-xs disabled:opacity-20"
                  aria-label="Move right"
                >→</button>
              </div>
            </div>
          ))}
          {drafts.length < MAX_PHOTOS && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={processing || uploading}
              className="aspect-square rounded-kaya-sm border-2 border-dashed border-kaya-warm-dark text-kaya-sand text-xs font-bold flex flex-col items-center justify-center gap-1 hover:border-kaya-chocolate hover:text-kaya-chocolate transition-colors disabled:opacity-40"
            >
              <span className="text-2xl">📷</span>
              <span>{drafts.length === 0 ? 'Add photos' : `${MAX_PHOTOS - drafts.length} more`}</span>
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onPickFiles}
        />

        {processing && (
          <p className="text-[11px] text-kaya-sand text-center">Processing photos…</p>
        )}
        {!processing && drafts.length === 0 && (
          <p className="text-[11px] text-kaya-sand text-center">Pick photos from your camera roll. We&apos;ll resize them on the way up so the upload is light.</p>
        )}
      </div>

      {/* ── Caption ─────────────────────────────────────────── */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
        <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-2">Caption</p>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="What's the story? (optional)"
          className="w-full p-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          disabled={uploading}
        />
        <p className="text-[10px] text-kaya-sand-light mt-1 text-right">{caption.length}/500</p>
      </div>

      {/* ── Kid tags ─────────────────────────────────────────── */}
      {children.length > 0 && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-2">Who&apos;s in it?</p>
          <div className="flex flex-wrap gap-2">
            {children.map((c) => {
              const sel = kidTags.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleKidTag(c.id)}
                  disabled={uploading}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                    sel ? 'text-white border-transparent shadow-sm' : 'border-kaya-warm-dark bg-white text-kaya-sand'
                  }`}
                  style={sel ? { backgroundColor: c.houseColor } : {}}
                >
                  <KidAvatar child={c} size="xs" />
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Event tag ────────────────────────────────────────── */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
        <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-2">When / what (optional)</p>
        <div className="flex flex-wrap gap-2">
          {EVENT_TAGS.map((t) => {
            const sel = eventTag === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setEventTag(sel ? undefined : t.id)}
                disabled={uploading}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                  sel ? 'bg-kaya-chocolate text-white border-transparent' : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-chocolate'
                }`}
              >
                {t.emoji} {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="text-red-500 text-xs bg-red-50 border border-red-200 rounded-kaya-sm px-2 py-1.5 mb-3">{error}</p>
      )}

      {uploading && progress.total > 0 && (
        <div className="bg-kaya-gold/10 border border-kaya-gold/40 rounded-kaya-sm px-3 py-2 mb-3">
          <p className="text-xs font-bold text-kaya-chocolate">
            Uploading {progress.done} of {progress.total}…
          </p>
          <div className="h-1.5 bg-white rounded-full mt-1.5 overflow-hidden">
            <div
              className="h-full bg-kaya-gold transition-all"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="sticky bottom-24 lg:bottom-4 flex items-center gap-2 bg-kaya-cream/95 backdrop-blur-sm py-2 -mx-4 px-4 lg:mx-0 lg:px-0">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="flex-1 h-12 bg-kaya-gold text-white rounded-kaya font-bold text-sm disabled:opacity-40"
        >
          {uploading ? 'Uploading…' : 'Share to family'}
        </button>
        <button
          onClick={() => router.back()}
          disabled={uploading}
          className="h-12 px-4 bg-white border border-kaya-warm-dark rounded-kaya font-bold text-sm text-kaya-chocolate"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
