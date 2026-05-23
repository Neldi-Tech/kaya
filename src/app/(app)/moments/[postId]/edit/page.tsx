'use client';

// /moments/[postId]/edit — author edits caption / photos / tags / event chip.
//
// Photo edits: remove, reorder, or add new photos. New photos run
// through the same processing pipeline as the composer and land in
// Storage under the EXISTING postId path so we don't have to re-link
// anything on the doc. Removed photos are cleaned out of Storage
// fire-and-forget so the doc save isn't blocked on Storage round-trips.
// Visibility stays fixed since the UI only writes 'family'.
// On save we patch the post doc with `updatedAt` so the detail page
// can render a small "edited" hint.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  getPost, updatePost, uploadProcessedPhoto, deleteRemovedPhotos, deletePost,
  recordEventTagUse, EventTag, Post, PhotoRef,
} from '@/lib/moments';
import {
  processPhotoForUpload, ProcessedPhoto, MAX_PHOTO_BYTES,
} from '@/lib/photoUpload';
import EventTagPicker from '@/components/moments/EventTagPicker';
import { getFamilyMembers, UserProfile } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const MAX_PHOTOS = 10;

const EMOJI_PALETTE = [
  '😀','😂','😍','🥰','😎','😊','🙏','👏',
  '💪','✨','🎉','🎊','🌟','❤️','💖','🔥',
  '🏆','🎂','🎈','🌈','☀️','🌸','🍀','✈️',
  '🎒','⚽','🏖️','🥳','😴','🤗','🙌','💯',
];

interface MentionTarget {
  name: string;
  emoji?: string;
  avatarUrl?: string;
  kind: 'kid' | 'adult';
  uid?: string;
}

// One ordered slot in the editor's photo strip. Either an already-
// published PhotoRef (kind: 'existing') or a freshly-picked file
// awaiting upload on Save (kind: 'draft'). Reorder + remove operate
// on this unified list so the UI doesn't care about the difference.
type PhotoSlot =
  | { kind: 'existing'; slotId: string; photo: PhotoRef }
  | { kind: 'draft'; slotId: string; fileName: string; processed: ProcessedPhoto; previewUrl: string };

export default function EditMomentPage() {
  const { postId } = useParams<{ postId: string }>();
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  const confirmAction = useConfirm();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const [caption, setCaption] = useState('');
  const [kidTags, setKidTags] = useState<string[]>([]);
  const [eventTag, setEventTag] = useState<EventTag | undefined>(undefined);
  const [mentionedUids, setMentionedUids] = useState<string[]>([]);
  const [slots, setSlots] = useState<PhotoSlot[]>([]);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [showEmojis, setShowEmojis] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!profile?.familyId || !postId) return;
    (async () => {
      const p = await getPost(profile.familyId, postId);
      if (!p) { setLoading(false); return; }
      // Author edits their own; parents can also open the page so
      // they keep their moderation Delete (which now lives here).
      const isAuthor = p.authorUid === profile.uid;
      const isParent = profile.role === 'parent';
      if (!isAuthor && !isParent) {
        setDenied(true);
        setLoading(false);
        return;
      }
      setPost(p);
      setCaption(p.caption || '');
      setKidTags(p.kidTags || []);
      setEventTag(p.eventTag);
      setMentionedUids(p.mentionedUids || []);
      setSlots((p.photos || []).map((ph) => ({
        kind: 'existing' as const,
        slotId: `existing-${ph.id}`,
        photo: ph,
      })));
      setLoading(false);
    })();
  }, [profile?.familyId, profile?.uid, postId]);

  // Revoke the object URLs we created for draft previews when the
  // component unmounts — drafts that survive to Save are revoked by
  // the save flow before navigating away.
  useEffect(() => () => {
    setSlots((prev) => {
      prev.forEach((s) => { if (s.kind === 'draft') URL.revokeObjectURL(s.previewUrl); });
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!profile?.familyId) return;
    let cancelled = false;
    getFamilyMembers(profile.familyId)
      .then((list) => { if (!cancelled) setMembers(list.filter((m) => m.uid !== profile.uid)); })
      .catch(() => { /* silent — mentions just won't autocomplete */ });
    return () => { cancelled = true; };
  }, [profile?.familyId, profile?.uid]);

  const mentionMatches = useMemo<MentionTarget[]>(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const kidTargets: MentionTarget[] = children.map((c) => ({
      name: c.name, emoji: c.avatarEmoji, avatarUrl: c.avatarPhoto, kind: 'kid' as const,
    }));
    const adultTargets: MentionTarget[] = members.map((m) => ({
      name: m.displayName, avatarUrl: m.avatarPhoto, kind: 'adult' as const, uid: m.uid,
    }));
    const all = [...kidTargets, ...adultTargets];
    if (!q) return all.slice(0, 6);
    return all.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, children, members]);

  if (isGuest) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-12 lg:pt-16 text-center">
        <p className="text-5xl mb-3">📸</p>
        <p className="text-kaya-sand text-sm">Editing Moments is disabled in the demo.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <p className="text-3xl mb-2">⏳</p>
        <p className="text-kaya-sand text-sm">Loading…</p>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <p className="text-5xl mb-3">🔒</p>
        <p className="text-kaya-sand text-sm">Only the original poster or a parent can edit this moment.</p>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <p className="text-5xl mb-3">🌬️</p>
        <p className="text-kaya-sand text-sm">This moment isn&apos;t available.</p>
      </div>
    );
  }

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (slots.length + files.length > MAX_PHOTOS) {
      setError(`Maximum ${MAX_PHOTOS} photos per post.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setError('');
    setProcessing(true);
    const next: PhotoSlot[] = [];
    for (const file of files) {
      try {
        if (file.size > MAX_PHOTO_BYTES) {
          throw new Error(`${file.name} is too large (>${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB).`);
        }
        const processed = await processPhotoForUpload(file);
        next.push({
          kind: 'draft',
          slotId: `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          fileName: file.name,
          processed,
          previewUrl: URL.createObjectURL(processed.feedBlob),
        });
      } catch (err: any) {
        setError(err?.message || `Couldn't process ${file.name}.`);
      }
    }
    setSlots((prev) => [...prev, ...next]);
    setProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeSlot = (slotId: string) => {
    setSlots((prev) => {
      const target = prev.find((s) => s.slotId === slotId);
      if (target && target.kind === 'draft') URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.slotId !== slotId);
    });
  };

  const moveSlot = (slotId: string, dir: -1 | 1) => {
    setSlots((prev) => {
      const i = prev.findIndex((s) => s.slotId === slotId);
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

  const insertAtCursor = (text: string) => {
    const el = captionRef.current;
    if (!el) {
      setCaption((prev) => prev + text);
      return;
    }
    const start = el.selectionStart ?? caption.length;
    const end = el.selectionEnd ?? caption.length;
    const next = caption.slice(0, start) + text + caption.slice(end);
    setCaption(next);
    queueMicrotask(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const onCaptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setCaption(value);
    const pos = e.target.selectionStart ?? value.length;
    let start = -1;
    for (let i = pos - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === '@') { start = i; break; }
      if (/\s/.test(ch)) break;
    }
    if (start === -1) { setMention(null); return; }
    setMention({ start, query: value.slice(start + 1, pos) });
  };

  const applyMention = (target: MentionTarget) => {
    if (!mention) return;
    const el = captionRef.current;
    const cursor = el?.selectionStart ?? caption.length;
    const before = caption.slice(0, mention.start);
    const after = caption.slice(cursor);
    const insert = `@${target.name} `;
    const next = before + insert + after;
    setCaption(next);
    setMention(null);
    if (target.uid) {
      setMentionedUids((prev) => (prev.includes(target.uid!) ? prev : [...prev, target.uid!]));
    }
    queueMicrotask(() => {
      el?.focus();
      const pos = (before + insert).length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const onSave = async () => {
    if (!profile?.familyId || !post) return;
    if (slots.length === 0) {
      setError('A moment needs at least one photo.');
      return;
    }
    setError('');
    setSaving(true);

    // Upload any new drafts sequentially so the progress counter stays
    // monotonic and a flaky mobile connection isn't asked to push 10
    // photos in parallel. Existing PhotoRefs pass through untouched.
    const drafts = slots.filter((s): s is Extract<PhotoSlot, { kind: 'draft' }> => s.kind === 'draft');
    setProgress({ done: 0, total: drafts.length });
    const uploadedByDraftId = new Map<string, PhotoRef>();
    try {
      for (const d of drafts) {
        const ref = await uploadProcessedPhoto(profile.familyId, post.id, d.processed);
        uploadedByDraftId.set(d.slotId, ref);
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    } catch (e: any) {
      setError(e?.message || 'Upload failed. Tap Save to retry.');
      setSaving(false);
      return;
    }

    // Build the final ordered photo list + figure out which originals
    // the author dropped (for Storage cleanup).
    const finalPhotos: PhotoRef[] = slots.map((s) =>
      s.kind === 'existing' ? s.photo : uploadedByDraftId.get(s.slotId)!,
    );
    const keptIds = new Set(
      slots.filter((s) => s.kind === 'existing').map((s) => (s as Extract<PhotoSlot, { kind: 'existing' }>).photo.id),
    );
    const removed = (post.photos || []).filter((p) => !keptIds.has(p.id));

    try {
      const finalCaption = caption.trim();
      const finalMentionedUids = mentionedUids.filter((uid) => {
        const m = members.find((x) => x.uid === uid);
        return !!m && finalCaption.includes(`@${m.displayName}`);
      });
      await updatePost(profile.familyId, post.id, {
        caption: finalCaption,
        kidTags,
        eventTag,
        mentionedUids: finalMentionedUids,
        photos: finalPhotos,
      });
      if (eventTag) void recordEventTagUse(profile.familyId, eventTag).catch(() => {});
      // Reclaim Storage for dropped photos — best-effort, doesn't
      // block navigation.
      if (removed.length > 0) deleteRemovedPhotos(profile.familyId, post.id, removed);
      // Revoke local previews before navigating.
      drafts.forEach((d) => URL.revokeObjectURL(d.previewUrl));
      router.replace(`/moments/${post.id}`);
    } catch (e: any) {
      setError(e?.message || 'Could not save the changes.');
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!profile?.familyId || !post) return;
    const ok = await confirmAction({
      title: 'Delete this moment?',
      message: 'Photos and comments will be removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setError('');
    setDeleting(true);
    try {
      await deletePost(profile.familyId, post);
      router.replace('/moments');
    } catch (e: any) {
      setError(e?.message || 'Could not delete this moment.');
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Moments</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black tracking-tight">Edit moment</h1>
        <p className="text-sm text-kaya-sand mt-1">
          Update photos, the caption, who&apos;s tagged, or the event chip.
        </p>
      </div>

      {/* ── Photos (add / remove / reorder) ─────────────────── */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
        <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-2">Photos</p>
        <div className="grid grid-cols-3 gap-2 mb-2">
          {slots.map((s, i) => {
            const src = s.kind === 'existing' ? s.photo.feedUrl : s.previewUrl;
            return (
              <div key={s.slotId} className="relative aspect-square rounded-kaya-sm overflow-hidden bg-kaya-warm">
                <img src={src} alt="" className="w-full h-full object-cover" />
                <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold rounded px-1.5 py-0.5">
                  {i + 1}
                </div>
                {s.kind === 'draft' && (
                  <div className="absolute top-1 right-8 bg-kaya-gold text-white text-[9px] font-bold rounded px-1.5 py-0.5 uppercase tracking-wider">
                    New
                  </div>
                )}
                <button
                  onClick={() => removeSlot(s.slotId)}
                  disabled={saving}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs disabled:opacity-30"
                  aria-label="Remove photo"
                >✕</button>
                <div className="absolute bottom-1 left-1 right-1 flex justify-between">
                  <button
                    onClick={() => moveSlot(s.slotId, -1)}
                    disabled={saving || i === 0}
                    className="w-6 h-6 rounded-full bg-black/60 text-white text-xs disabled:opacity-20"
                    aria-label="Move left"
                  >←</button>
                  <button
                    onClick={() => moveSlot(s.slotId, 1)}
                    disabled={saving || i === slots.length - 1}
                    className="w-6 h-6 rounded-full bg-black/60 text-white text-xs disabled:opacity-20"
                    aria-label="Move right"
                  >→</button>
                </div>
              </div>
            );
          })}
          {slots.length < MAX_PHOTOS && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={processing || saving}
              className="aspect-square rounded-kaya-sm border-2 border-dashed border-kaya-warm-dark text-kaya-sand text-xs font-bold flex flex-col items-center justify-center gap-1 hover:border-kaya-chocolate hover:text-kaya-chocolate transition-colors disabled:opacity-40"
            >
              <span className="text-2xl">📷</span>
              <span>{slots.length === 0 ? 'Add photos' : `${MAX_PHOTOS - slots.length} more`}</span>
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
        {slots.length === 0 && !processing && (
          <p className="text-[11px] text-kaya-sand text-center">A moment needs at least one photo.</p>
        )}
      </div>

      {/* ── Caption ─────────────────────────────────────────── */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">Caption</p>
          <button
            type="button"
            onClick={() => setShowEmojis((v) => !v)}
            disabled={saving}
            className={`w-7 h-7 rounded-full text-base flex items-center justify-center transition-colors ${
              showEmojis ? 'bg-kaya-gold/20 text-kaya-chocolate' : 'text-kaya-sand hover:bg-kaya-cream'
            }`}
            aria-label="Insert emoji"
          >
            😀
          </button>
        </div>
        <div className="relative">
          <textarea
            ref={captionRef}
            value={caption}
            onChange={onCaptionChange}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (mention) { setMention(null); e.preventDefault(); }
                else if (showEmojis) { setShowEmojis(false); e.preventDefault(); }
              }
            }}
            rows={3}
            maxLength={500}
            placeholder="What's the story? Type @ to tag a family member."
            className="w-full p-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
            disabled={saving}
          />
          {mention && mentionMatches.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-kaya-warm-dark rounded-kaya-sm shadow-lg overflow-hidden">
              {mentionMatches.map((t) => (
                <button
                  key={`${t.kind}-${t.name}`}
                  type="button"
                  onClick={() => applyMention(t)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-kaya-cream"
                >
                  <span className="w-6 h-6 rounded-full bg-kaya-warm flex items-center justify-center text-sm overflow-hidden flex-shrink-0">
                    {t.avatarUrl ? (
                      <img src={t.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span>{t.emoji || (t.kind === 'kid' ? '🧒' : '👤')}</span>
                    )}
                  </span>
                  <span className="font-medium">{t.name}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-kaya-sand-light">
                    {t.kind === 'kid' ? 'Kid' : 'Family'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {showEmojis && (
          <div className="mt-2 p-2 bg-kaya-cream rounded-kaya-sm grid grid-cols-8 gap-1">
            {EMOJI_PALETTE.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => insertAtCursor(emoji)}
                disabled={saving}
                className="text-lg w-8 h-8 rounded hover:bg-white transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
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
                  disabled={saving}
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
        <EventTagPicker
          familyId={profile?.familyId || ''}
          value={eventTag}
          onChange={setEventTag}
          disabled={saving}
          caption={caption}
        />
      </div>

      {error && (
        <p className="text-red-500 text-xs bg-red-50 border border-red-200 rounded-kaya-sm px-2 py-1.5 mb-3">{error}</p>
      )}

      {saving && progress.total > 0 && progress.done < progress.total && (
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
          onClick={onSave}
          disabled={saving || deleting || processing || slots.length === 0}
          className="flex-1 h-12 bg-kaya-gold text-white rounded-kaya font-bold text-sm disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={() => router.back()}
          disabled={saving || deleting}
          className="h-12 px-4 bg-white border border-kaya-warm-dark rounded-kaya font-bold text-sm text-kaya-chocolate"
        >
          Cancel
        </button>
      </div>

      {/* ── Danger zone ─────────────────────────────────────── */}
      <div className="mt-6 pt-4 border-t border-kaya-warm-dark/60">
        <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand-light mb-2">Danger zone</p>
        <button
          onClick={onDelete}
          disabled={saving || deleting}
          className="w-full h-11 bg-white border border-red-200 text-red-600 rounded-kaya-sm font-bold text-sm hover:bg-red-50 transition-colors disabled:opacity-40"
        >
          {deleting ? 'Deleting…' : 'Delete this moment'}
        </button>
        <p className="text-[10px] text-kaya-sand-light mt-1.5 text-center">
          Photos, comments, and reactions will be removed.
        </p>
      </div>
    </div>
  );
}
