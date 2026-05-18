'use client';

// /moments/[postId]/edit — author edits caption / kid tags / event chip.
//
// Photos are read-only here — adding or removing photos after publish
// has to push and reclaim Storage paths, which V1 leaves alone.
// Visibility is similarly fixed since the UI only writes 'family'.
// On save we patch the post doc with `updatedAt` so the detail page
// can render a small "edited" hint.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  getPost, updatePost,
  EVENT_TAGS, EventTag, Post,
  CUSTOM_TAG_EMOJI, CUSTOM_TAG_MAX_LEN,
} from '@/lib/moments';
import { getFamilyMembers, UserProfile } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

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

export default function EditMomentPage() {
  const { postId } = useParams<{ postId: string }>();
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const [caption, setCaption] = useState('');
  const [kidTags, setKidTags] = useState<string[]>([]);
  const [eventTag, setEventTag] = useState<EventTag | undefined>(undefined);
  const [mentionedUids, setMentionedUids] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [showEmojis, setShowEmojis] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [customEditing, setCustomEditing] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [members, setMembers] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!profile?.familyId || !postId) return;
    (async () => {
      const p = await getPost(profile.familyId, postId);
      if (!p) { setLoading(false); return; }
      if (p.authorUid !== profile.uid) {
        setDenied(true);
        setLoading(false);
        return;
      }
      setPost(p);
      setCaption(p.caption || '');
      setKidTags(p.kidTags || []);
      setEventTag(p.eventTag);
      setMentionedUids(p.mentionedUids || []);
      setLoading(false);
    })();
  }, [profile?.familyId, profile?.uid, postId]);

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
        <p className="text-kaya-sand text-sm">Only the original poster can edit this moment.</p>
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

  const commitCustomChip = () => {
    const label = customDraft.trim().replace(/\s+/g, ' ').slice(0, CUSTOM_TAG_MAX_LEN);
    if (!label) { setCustomEditing(false); return; }
    setEventTag({ id: 'custom', emoji: CUSTOM_TAG_EMOJI, label });
    setCustomDraft('');
    setCustomEditing(false);
  };

  const onSave = async () => {
    if (!profile?.familyId || !post) return;
    setError('');
    setSaving(true);
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
      });
      router.replace(`/moments/${post.id}`);
    } catch (e: any) {
      setError(e?.message || 'Could not save the changes.');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Moments</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black tracking-tight">Edit moment</h1>
        <p className="text-sm text-kaya-sand mt-1">
          Update the caption, who&apos;s tagged, or the event chip. Photos can&apos;t be changed once posted.
        </p>
      </div>

      {/* ── Photos (read-only preview) ──────────────────────── */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-3 mb-4">
        <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-2">Photos</p>
        <div className="grid grid-cols-3 gap-2">
          {post.photos.map((p, i) => (
            <div key={p.id} className="relative aspect-square rounded-kaya-sm overflow-hidden bg-kaya-warm">
              <img src={p.feedUrl} alt="" className="w-full h-full object-cover" />
              <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold rounded px-1.5 py-0.5">
                {i + 1}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-kaya-sand-light mt-2">
          To change photos, delete this moment and share a new one.
        </p>
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
        <div className="flex flex-wrap gap-2 items-center">
          {EVENT_TAGS.map((t) => {
            const sel = eventTag?.id === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setEventTag(sel ? undefined : t)}
                disabled={saving}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                  sel ? 'bg-kaya-chocolate text-white border-transparent' : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-chocolate'
                }`}
              >
                {t.emoji} {t.label}
              </button>
            );
          })}
          {eventTag && eventTag.id === 'custom' && (
            <button
              type="button"
              onClick={() => setEventTag(undefined)}
              disabled={saving}
              className="px-3 py-1.5 rounded-full text-xs font-bold border bg-kaya-chocolate text-white border-transparent"
            >
              {eventTag.emoji} {eventTag.label}
            </button>
          )}
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
                disabled={saving}
              />
              <button
                type="button"
                onClick={commitCustomChip}
                disabled={saving || !customDraft.trim()}
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
              disabled={saving}
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

      <div className="sticky bottom-24 lg:bottom-4 flex items-center gap-2 bg-kaya-cream/95 backdrop-blur-sm py-2 -mx-4 px-4 lg:mx-0 lg:px-0">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 h-12 bg-kaya-gold text-white rounded-kaya font-bold text-sm disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={() => router.back()}
          disabled={saving}
          className="h-12 px-4 bg-white border border-kaya-warm-dark rounded-kaya font-bold text-sm text-kaya-chocolate"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
