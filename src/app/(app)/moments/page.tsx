'use client';

// /moments — the family photo feed.
//
// One scrollable column of post cards, newest first. Each card shows
// the photo carousel, caption, kid tag chips, the reaction bar, and a
// "View comments (n)" footer that deep-links to the post detail page.
// "+ New" button up top is the only entry point to the composer.
//
// Subscribes to the latest N posts via `subscribeToFeed`. "Load more"
// is intentional rather than infinite scroll for now — a parent
// scrubbing through old posts shouldn't see the snapshot listener
// chase ever-growing limits unbounded.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  subscribeToFeed, toggleReaction, subscribeToMyReactions,
  Post, REACTION_EMOJIS, Reaction, EVENT_TAGS,
} from '@/lib/moments';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const PAGE_SIZE_STEP = 20;

export default function MomentsFeedPage() {
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  const [posts, setPosts] = useState<Post[]>([]);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_STEP);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!profile?.familyId) return;
    const unsub = subscribeToFeed(profile.familyId, pageSize, (p) => {
      setPosts(p);
      setLoaded(true);
    });
    return () => unsub();
  }, [profile?.familyId, pageSize]);

  const hasMore = posts.length >= pageSize;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Family · feed</p>
          <h1 className="font-display text-2xl lg:text-[34px] font-black tracking-tight">Moments 📸</h1>
          <p className="text-sm text-kaya-sand mt-1">Photos, comments, reactions — for the family.</p>
        </div>
        {!isGuest && (
          <Link
            href="/moments/new"
            className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm font-bold text-xs flex items-center hover:bg-kaya-gold-dark transition-colors"
          >
            + New
          </Link>
        )}
      </div>

      {!loaded && (
        <div className="text-center py-12">
          <p className="text-3xl mb-2">⏳</p>
          <p className="text-kaya-sand text-sm">Loading feed…</p>
        </div>
      )}

      {loaded && posts.length === 0 && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-10 text-center">
          <p className="text-5xl mb-3">📸</p>
          <p className="font-display font-black text-lg mb-1">No moments yet</p>
          <p className="text-kaya-sand text-sm mb-4">
            Be the first to share a photo. Snapshots of school, weekends, going out — anything worth keeping.
          </p>
          {!isGuest && (
            <Link
              href="/moments/new"
              className="inline-flex items-center gap-1.5 h-11 px-5 bg-kaya-gold text-white rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors"
            >
              📷 Share a moment
            </Link>
          )}
        </div>
      )}

      <div className="space-y-4">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} children={children} myUid={profile?.uid || ''} familyId={profile?.familyId || ''} />
        ))}
      </div>

      {hasMore && loaded && posts.length > 0 && (
        <div className="text-center mt-6">
          <button
            onClick={() => setPageSize((n) => n + PAGE_SIZE_STEP)}
            className="h-10 px-5 bg-white border border-kaya-warm-dark rounded-kaya-sm font-bold text-xs text-kaya-chocolate hover:bg-kaya-warm transition-colors"
          >
            Load older →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Post card ────────────────────────────────────────────────────

function PostCard({
  post, children, myUid, familyId,
}: {
  post: Post;
  children: ReturnType<typeof useFamily>['children'];
  myUid: string;
  familyId: string;
}) {
  const [photoIdx, setPhotoIdx] = useState(0);
  const [myReactions, setMyReactions] = useState<Set<Reaction>>(new Set());

  useEffect(() => {
    if (!familyId || !myUid) return;
    return subscribeToMyReactions(familyId, post.id, myUid, setMyReactions);
  }, [familyId, post.id, myUid]);

  const photo = post.photos[photoIdx];
  const event = EVENT_TAGS.find((t) => t.id === post.eventTag);
  const date = post.createdAt?.toDate?.() || new Date();
  const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const taggedKids = post.kidTags.map((id) => children.find((c) => c.id === id)).filter(Boolean) as typeof children;

  const onReact = async (emoji: Reaction) => {
    if (!familyId || !myUid) return;
    await toggleReaction(familyId, post.id, emoji, { uid: myUid, name: '' });
  };

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden">
      {/* Author bar */}
      <div className="flex items-center gap-2.5 p-3">
        {post.authorAvatar ? (
          <img src={post.authorAvatar} alt={post.authorName} className="w-9 h-9 rounded-full object-cover bg-kaya-warm" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-white text-sm font-black">
            {post.authorName?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{post.authorName}</p>
          <p className="text-[11px] text-kaya-sand">
            {dateLabel}{event && <> · {event.emoji} {event.label}</>}
          </p>
        </div>
        <Link
          href={`/moments/${post.id}`}
          className="text-[11px] text-kaya-chocolate font-bold hover:underline"
          aria-label="Open post"
        >
          Open →
        </Link>
      </div>

      {/* Photo carousel */}
      {photo && (
        <div className="relative bg-kaya-warm">
          <div
            className="relative w-full overflow-hidden bg-kaya-warm-dark/20"
            style={{
              aspectRatio: `${photo.width} / ${photo.height}`,
              maxHeight: '70vh',
            }}
          >
            <img
              src={photo.feedUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-contain"
              loading="lazy"
            />
          </div>
          {post.photos.length > 1 && (
            <>
              <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] font-bold rounded-full px-2 py-0.5">
                {photoIdx + 1} / {post.photos.length}
              </div>
              <button
                onClick={() => setPhotoIdx((i) => Math.max(0, i - 1))}
                disabled={photoIdx === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white text-base disabled:opacity-20"
                aria-label="Previous photo"
              >←</button>
              <button
                onClick={() => setPhotoIdx((i) => Math.min(post.photos.length - 1, i + 1))}
                disabled={photoIdx === post.photos.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white text-base disabled:opacity-20"
                aria-label="Next photo"
              >→</button>
            </>
          )}
        </div>
      )}

      {/* Caption + tags */}
      <div className="p-3 space-y-2">
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

        {/* Reaction bar */}
        <div className="flex items-center gap-1.5 pt-1">
          {REACTION_EMOJIS.map((emoji) => {
            const count = post.reactionsByType?.[emoji] || 0;
            const mine = myReactions.has(emoji);
            return (
              <button
                key={emoji}
                onClick={() => onReact(emoji)}
                className={`flex items-center gap-1 h-8 px-2.5 rounded-full text-xs font-bold border transition-colors ${
                  mine
                    ? 'bg-kaya-gold/15 border-kaya-gold text-kaya-chocolate'
                    : 'bg-white border-kaya-warm-dark text-kaya-sand hover:border-kaya-chocolate'
                }`}
              >
                <span className="text-sm">{emoji}</span>
                {count > 0 && <span>{count}</span>}
              </button>
            );
          })}
          <div className="flex-1" />
          <Link
            href={`/moments/${post.id}`}
            className="text-[11px] text-kaya-sand font-bold hover:text-kaya-chocolate"
          >
            💬 {post.commentCount || 0} comment{post.commentCount === 1 ? '' : 's'}
          </Link>
        </div>
      </div>
    </div>
  );
}
