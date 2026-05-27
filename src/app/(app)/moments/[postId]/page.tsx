'use client';

// /moments/[postId] — single-post view with full comments thread.
//
// Same card as the feed but always shows ALL photos as a vertical
// stack (no carousel — the detail page is for reading, not scrubbing)
// and exposes the threaded comments list + a quick-add input. The
// author and any parent can delete the post or any comment.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  getPost, toggleReaction, subscribeToMyReactions, subscribeToComments,
  addComment, deleteComment,
  Post, Comment, Reaction, REACTION_EMOJIS,
} from '@/lib/moments';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';
import { downloadImage, suggestedPhotoFilename } from '@/lib/downloadImage';

export default function PostDetailPage() {
  const { postId } = useParams<{ postId: string }>();
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  const confirmAction = useConfirm();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [myReactions, setMyReactions] = useState<Set<Reaction>>(new Set());
  const [commentDraft, setCommentDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const downloadPhoto = async (photoId: string, fullUrl: string) => {
    if (downloadingId) return;
    setDownloadingId(photoId);
    try {
      await downloadImage(fullUrl, suggestedPhotoFilename(post?.createdAt));
    } catch (err) {
      console.error('Photo download failed', err);
    } finally {
      setDownloadingId(null);
    }
  };

  // Initial post fetch. We could also subscribe but the post fields
  // only change on rare edits — a one-shot fetch + counter increments
  // via the cached doc is enough for V1.
  useEffect(() => {
    if (!profile?.familyId || !postId) return;
    (async () => {
      const p = await getPost(profile.familyId, postId);
      setPost(p);
      setLoading(false);
    })();
  }, [profile?.familyId, postId]);

  // Live counters via re-fetch on reaction/comment changes — kept
  // simple by re-pulling the doc when sub-collection counts shift.
  // The reactions/comments listeners themselves are the source of
  // truth for the lists; the counters on the post doc just keep the
  // top-card aggregates fresh.
  useEffect(() => {
    if (!profile?.familyId || !postId) return;
    return subscribeToComments(profile.familyId, postId, (c) => {
      setComments(c);
      // Refresh post counters opportunistically. Cheap one-doc read.
      getPost(profile.familyId, postId).then((p) => p && setPost(p));
    });
  }, [profile?.familyId, postId]);

  useEffect(() => {
    if (!profile?.familyId || !postId || !profile.uid) return;
    return subscribeToMyReactions(profile.familyId, postId, profile.uid, setMyReactions);
  }, [profile?.familyId, postId, profile?.uid]);

  if (loading) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <p className="text-3xl mb-2">⏳</p>
        <p className="text-kaya-sand text-sm">Loading…</p>
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

  const isAuthor = post.authorUid === profile?.uid;
  const isParent = profile?.role === 'parent';
  // Edit page hosts both edit + delete now — anyone who could
  // previously delete (author or parent) can reach the edit page so
  // they keep that moderation path.
  const canEditPost = isAuthor || isParent;
  const event = post.eventTag;
  const date = post.createdAt?.toDate?.() || new Date();
  const dateLabel = date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const wasEdited = !!post.updatedAt && post.updatedAt.toMillis() > post.createdAt.toMillis() + 1000;
  const taggedKids = post.kidTags.map((id) => children.find((c) => c.id === id)).filter(Boolean) as typeof children;

  const onReact = async (emoji: Reaction) => {
    if (!profile?.familyId || !profile.uid || isGuest) return;
    await toggleReaction(
      profile.familyId, post.id, emoji,
      { uid: profile.uid, name: profile.displayName },
      { authorUid: post.authorUid, caption: post.caption },
    );
    // Refresh counters.
    const p = await getPost(profile.familyId, post.id);
    if (p) setPost(p);
  };

  const onAddComment = async () => {
    if (!profile?.familyId || !profile.uid || isGuest) return;
    const text = commentDraft.trim();
    if (!text) return;
    setError('');
    setPosting(true);
    try {
      await addComment(
        profile.familyId, post.id,
        {
          byUid: profile.uid,
          byName: profile.displayName,
          byAvatar: profile.avatarPhoto,
          text,
        } as any,
        { authorUid: post.authorUid, caption: post.caption },
      );
      setCommentDraft('');
    } catch (e: any) {
      setError(e?.message || 'Could not post comment.');
    }
    setPosting(false);
  };

  const onDeleteComment = async (id: string) => {
    if (!profile?.familyId) return;
    const ok = await confirmAction({
      title: 'Delete this comment?',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    await deleteComment(profile.familyId, post.id, id);
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>

      {/* Author bar */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-3 flex items-center gap-3 mb-3">
        {post.authorAvatar ? (
          <img src={post.authorAvatar} alt={post.authorName} className="w-11 h-11 rounded-full object-cover bg-kaya-warm" />
        ) : (
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-white font-black">
            {post.authorName?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">{post.authorName}</p>
          <p className="text-[11px] text-kaya-sand">
            {dateLabel}{event && <> · {event.emoji} {event.label}</>}
            {wasEdited && <span className="ml-1 italic text-kaya-sand-light">· edited</span>}
          </p>
        </div>
        {canEditPost && (
          <Link
            href={`/moments/${post.id}/edit`}
            className="h-8 px-3 inline-flex items-center bg-kaya-gold/15 text-kaya-chocolate rounded-kaya-sm text-[11px] font-bold hover:bg-kaya-gold/25 transition-colors"
          >
            Edit
          </Link>
        )}
      </div>

      {/* Photo stack */}
      <div className="space-y-2 mb-3">
        {post.photos.map((p) => (
          <div
            key={p.id}
            className="relative overflow-hidden rounded-kaya bg-kaya-warm-dark/20"
            style={{ aspectRatio: `${p.width} / ${p.height}` }}
          >
            {p.kind === 'video' && p.videoUrl ? (
              <video
                src={p.videoUrl}
                poster={p.feedUrl}
                controls
                playsInline
                preload="metadata"
                className="absolute inset-0 w-full h-full object-contain bg-black"
              />
            ) : (
              <button
                type="button"
                onClick={() => downloadPhoto(p.id, p.fullUrl)}
                disabled={downloadingId === p.id}
                aria-label="Download photo"
                className="absolute inset-0 w-full h-full p-0 border-0 bg-transparent cursor-pointer"
              >
                <img
                  src={p.feedUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                />
                {downloadingId === p.id && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-xs font-display font-bold">
                    Saving…
                  </span>
                )}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Caption + kid tags */}
      {(post.caption || taggedKids.length > 0) && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-3 mb-3 space-y-2">
          {post.caption && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.caption}</p>
          )}
          {taggedKids.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {taggedKids.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: c.houseColor }}
                >
                  <KidAvatar child={c} size="xs" />
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reaction bar */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-3 mb-3">
        <p className="text-[10px] text-kaya-sand-light font-bold uppercase tracking-wider mb-2">
          Reactions ({post.reactionCount || 0})
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {REACTION_EMOJIS.map((emoji) => {
            const count = post.reactionsByType?.[emoji] || 0;
            const mine = myReactions.has(emoji);
            return (
              <button
                key={emoji}
                onClick={() => onReact(emoji)}
                disabled={isGuest}
                className={`flex items-center gap-1.5 h-10 px-3 rounded-kaya-sm text-sm font-bold border transition-colors disabled:opacity-50 ${
                  mine
                    ? 'bg-kaya-gold/15 border-kaya-gold text-kaya-chocolate'
                    : 'bg-white border-kaya-warm-dark text-kaya-sand hover:border-kaya-chocolate'
                }`}
              >
                <span className="text-base">{emoji}</span>
                {count > 0 && <span>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Comments thread */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-3 mb-3">
        <p className="text-[10px] text-kaya-sand-light font-bold uppercase tracking-wider mb-3">
          Comments ({comments.length})
          {comments.length === 0 && (
            <span className="ml-1.5 normal-case font-normal tracking-normal">· be the first to comment</span>
          )}
        </p>

        {comments.length === 0 ? null : (
          <div className="space-y-3">
            {comments.map((c) => {
              const canDelete = c.byUid === profile?.uid || isParent;
              const when = c.createdAt?.toDate?.();
              return (
                <div key={c.id} className="flex items-start gap-2.5">
                  {c.byAvatar ? (
                    <img src={c.byAvatar} alt="" className="w-8 h-8 rounded-full object-cover bg-kaya-warm shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-kaya-warm-dark text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {c.byName?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[12px] font-bold">{c.byName}</p>
                      <p className="text-[10px] text-kaya-sand-light">
                        {when ? when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                      </p>
                    </div>
                    <p className="text-[13px] leading-snug whitespace-pre-wrap">{c.text}</p>
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => onDeleteComment(c.id)}
                      className="text-[10px] text-red-600 font-bold hover:underline shrink-0"
                      aria-label="Delete comment"
                    >✕</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isGuest && (
          <div className={comments.length > 0 ? 'mt-3 pt-3 border-t border-kaya-warm-dark/60' : 'mt-2'}>
            <div className="flex items-end gap-2">
              <textarea
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Add a comment…"
                disabled={posting}
                className="flex-1 p-2 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 resize-none"
              />
              <button
                onClick={onAddComment}
                disabled={posting || !commentDraft.trim()}
                className="h-10 px-3 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
              >
                {posting ? '…' : 'Post'}
              </button>
            </div>
            {error && <p className="text-red-500 text-[11px] mt-1">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
