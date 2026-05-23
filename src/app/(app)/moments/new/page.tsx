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

import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  reservePost, finalizePost, uploadProcessedPhoto, uploadProcessedVideo, deletePost,
  EVENT_TAGS, EventTag, PhotoRef, Post,
  CUSTOM_TAG_EMOJI, CUSTOM_TAG_MAX_LEN,
} from '@/lib/moments';
import {
  processPhotoForUpload, processVideoForUpload, ProcessedPhoto, MAX_PHOTO_BYTES,
} from '@/lib/photoUpload';
import { getFamilyMembers, UserProfile } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const MAX_PHOTOS = 10;

// Curated palette for the caption emoji button. Tuned for family/parenting
// vibes — celebration, affection, weather, achievements. Deliberately short
// so the popover stays one tap away on mobile.
const EMOJI_PALETTE = [
  '😀','😂','😍','🥰','😎','😊','🙏','👏',
  '💪','✨','🎉','🎊','🌟','❤️','💖','🔥',
  '🏆','🎂','🎈','🌈','☀️','🌸','🍀','✈️',
  '🎒','⚽','🏖️','🥳','😴','🤗','🙌','💯',
];

// One entry in the @mention picker — either a parent/helper (UserProfile)
// or a kid (Child). Normalised so the picker renders both uniformly.
interface MentionTarget {
  name: string;
  emoji?: string;     // for kids — their avatar emoji
  avatarUrl?: string; // for users — uploaded photo
  kind: 'kid' | 'adult';
  /** Only set for adults (kids may not have their own user account
   *  yet). When present, drives notification routing. */
  uid?: string;
}

// In-memory state per picked file: blobs ready to upload plus a local
// preview URL the composer renders before the Storage URLs exist.
interface DraftPhoto {
  id: string;             // local-only id for keying + reorder
  fileName: string;
  kind: 'photo' | 'video';
  processed: ProcessedPhoto;   // for video: the poster's 3 variants
  previewUrl: string;     // object URL for the feed-size preview (poster for video)
  videoBlob?: Blob;       // present when kind === 'video'
  videoType?: string;
  durationSec?: number;
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

  // ── Composer extras ────────────────────────────────────────────
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [showEmojis, setShowEmojis] = useState(false);
  // Active @mention state — `start` is the index of '@' in the caption.
  // null means no mention is being typed.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  // Custom event chip — either editing (input visible) or showing the
  // currently picked custom label as a normal chip.
  const [customEditing, setCustomEditing] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [members, setMembers] = useState<UserProfile[]>([]);

  // Load parents/helpers once so @mentions have a name list. Kids come
  // from FamilyContext (already live). We deliberately ignore the current
  // user — no point @mentioning yourself.
  useEffect(() => {
    if (!profile?.familyId) return;
    let cancelled = false;
    getFamilyMembers(profile.familyId)
      .then((list) => { if (!cancelled) setMembers(list.filter((m) => m.uid !== profile.uid)); })
      .catch(() => { /* silent — mentions just won't autocomplete */ });
    return () => { cancelled = true; };
  }, [profile?.familyId, profile?.uid]);

  // UIDs the parent has @mentioned in the caption so far. Persisted on
  // the post for downstream notifications (and future "tap a mention
  // to jump to the profile" UX).
  const [mentionedUids, setMentionedUids] = useState<string[]>([]);

  // Flatten kids + adults into one mention list, filtered by query.
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
    return all
      .filter((t) => t.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, children, members]);

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
      setError(`Maximum ${MAX_PHOTOS} photos or videos per post.`);
      return;
    }
    setError('');
    setProcessing(true);
    const next: DraftPhoto[] = [];
    for (const file of files) {
      try {
        const draftId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        if (file.type.startsWith('video/')) {
          const v = await processVideoForUpload(file);
          next.push({
            id: draftId,
            fileName: file.name,
            kind: 'video',
            processed: v.poster,
            previewUrl: URL.createObjectURL(v.poster.feedBlob),
            videoBlob: v.videoBlob,
            videoType: v.contentType,
            durationSec: v.durationSec,
          });
        } else {
          if (file.size > MAX_PHOTO_BYTES) {
            throw new Error(`${file.name} is too large (>${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB).`);
          }
          const processed = await processPhotoForUpload(file);
          next.push({
            id: draftId,
            fileName: file.name,
            kind: 'photo',
            processed,
            previewUrl: URL.createObjectURL(processed.feedBlob),
          });
        }
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

  // ── Caption helpers (emoji + mentions) ─────────────────────────
  // Insert `text` at the current cursor position in the caption
  // textarea. Returns focus + places the cursor after the insertion
  // so the parent can keep typing.
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
    // setSelectionRange runs against the *next* DOM state, so defer
    // a tick so React commits the new value first.
    queueMicrotask(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Watch the caption for active `@mentions`. We scan backwards from
  // the cursor: if we hit whitespace first → no mention; if we hit
  // `@` first → mention active, query is everything between.
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

  // Replace the active `@partial` with `@FullName ` and close picker.
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
    // Track the mentioned uid for notification fan-out. Only adults
    // have uids; kids without an account can be tagged via kidTags.
    if (target.uid) {
      setMentionedUids((prev) => (prev.includes(target.uid!) ? prev : [...prev, target.uid!]));
    }
    queueMicrotask(() => {
      el?.focus();
      const pos = (before + insert).length;
      el?.setSelectionRange(pos, pos);
    });
  };

  // Commit the custom chip the parent is typing. Trims whitespace and
  // collapses runs of spaces so "  beach  day  " → "Beach Day".
  const commitCustomChip = () => {
    const label = customDraft.trim().replace(/\s+/g, ' ').slice(0, CUSTOM_TAG_MAX_LEN);
    if (!label) { setCustomEditing(false); return; }
    setEventTag({ id: 'custom', emoji: CUSTOM_TAG_EMOJI, label });
    setCustomDraft('');
    setCustomEditing(false);
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
        const ref = d.kind === 'video' && d.videoBlob
          ? await uploadProcessedVideo(profile.familyId, postId, {
              poster: d.processed,
              videoBlob: d.videoBlob,
              contentType: d.videoType || 'video/mp4',
              durationSec: d.durationSec || 0,
            })
          : await uploadProcessedPhoto(profile.familyId, postId, d.processed);
        uploaded.push(ref);
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
      // Filter the tracked mentions against the final caption — drops
      // any uid whose @name was typed then deleted before submit.
      const finalCaption = caption.trim();
      const finalMentionedUids = mentionedUids.filter((uid) => {
        const m = members.find((x) => x.uid === uid);
        return !!m && finalCaption.includes(`@${m.displayName}`);
      });
      const postData: Omit<Post, 'id' | 'reactionCount' | 'reactionsByType' | 'commentCount' | 'createdAt' | 'updatedAt'> = {
        authorUid: profile.uid,
        authorName: profile.displayName,
        authorAvatar: profile.avatarPhoto,
        caption: finalCaption,
        photos: uploaded,
        kidTags,
        mentionedUids: finalMentionedUids,
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
          Up to {MAX_PHOTOS} photos or videos. The whole family sees it on the feed.
        </p>
      </div>

      {/* ── Picker / preview grid ────────────────────────────── */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
        <div className="grid grid-cols-3 gap-2 mb-3">
          {drafts.map((d, i) => (
            <div key={d.id} className="relative aspect-square rounded-kaya-sm overflow-hidden bg-kaya-warm">
              <img src={d.previewUrl} alt={d.fileName} className="w-full h-full object-cover" />
              {d.kind === 'video' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="w-9 h-9 rounded-full bg-black/55 text-white flex items-center justify-center text-sm pl-0.5">▶</span>
                </div>
              )}
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
              <span>{drafts.length === 0 ? 'Add photo or video' : `${MAX_PHOTOS - drafts.length} more`}</span>
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={onPickFiles}
        />

        {processing && (
          <p className="text-[11px] text-kaya-sand text-center">Processing…</p>
        )}
        {!processing && drafts.length === 0 && (
          <p className="text-[11px] text-kaya-sand text-center">Pick photos or a video from your camera roll. Photos resize on the way up; a video uploads as-is (max 60s).</p>
        )}
      </div>

      {/* ── Caption ─────────────────────────────────────────── */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">Caption</p>
          <button
            type="button"
            onClick={() => setShowEmojis((v) => !v)}
            disabled={uploading}
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
              // Esc closes any open caption helper.
              if (e.key === 'Escape') {
                if (mention) { setMention(null); e.preventDefault(); }
                else if (showEmojis) { setShowEmojis(false); e.preventDefault(); }
              }
            }}
            rows={3}
            maxLength={500}
            placeholder="What's the story? Type @ to tag a family member."
            className="w-full p-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
            disabled={uploading}
          />
          {/* Mention picker — anchored under the textarea. */}
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
                disabled={uploading}
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
        <div className="flex flex-wrap gap-2 items-center">
          {EVENT_TAGS.map((t) => {
            const sel = eventTag?.id === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setEventTag(sel ? undefined : t)}
                disabled={uploading}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                  sel ? 'bg-kaya-chocolate text-white border-transparent' : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-chocolate'
                }`}
              >
                {t.emoji} {t.label}
              </button>
            );
          })}
          {/* Currently picked custom chip (if any) — sits inline with
              the builtin chips. Clicking it deselects. */}
          {eventTag && eventTag.id === 'custom' && (
            <button
              type="button"
              onClick={() => setEventTag(undefined)}
              disabled={uploading}
              className="px-3 py-1.5 rounded-full text-xs font-bold border bg-kaya-chocolate text-white border-transparent"
            >
              {eventTag.emoji} {eventTag.label}
            </button>
          )}
          {/* Custom chip editor — '+' button toggles into an inline
              input. Enter / ✓ commits, ✕ cancels. Max 18 chars keeps
              the chip from blowing out the layout on mobile. */}
          {customEditing ? (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full border border-kaya-chocolate bg-white">
              <input
                autoFocus
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitCustomChip(); }
                  if (e.key === 'Escape') { setCustomEditing(false); setCustomDraft(''); }
                }}
                maxLength={CUSTOM_TAG_MAX_LEN}
                placeholder="e.g. Sleepover"
                className="text-xs font-bold bg-transparent focus:outline-none w-28"
                disabled={uploading}
              />
              <button
                type="button"
                onClick={commitCustomChip}
                disabled={uploading || !customDraft.trim()}
                className="text-kaya-chocolate font-bold disabled:opacity-30 px-1"
                aria-label="Add custom tag"
              >✓</button>
              <button
                type="button"
                onClick={() => { setCustomEditing(false); setCustomDraft(''); }}
                className="text-kaya-sand px-1"
                aria-label="Cancel"
              >✕</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCustomEditing(true)}
              disabled={uploading}
              className="px-3 py-1.5 rounded-full text-xs font-bold border border-dashed border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-chocolate hover:text-kaya-chocolate transition-colors"
            >
              + Custom
            </button>
          )}
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
