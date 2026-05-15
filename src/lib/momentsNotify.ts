// Notification fan-out for Moments events.
//
// Each helper here does the same two things:
//   1. Fire-and-forget email via `/api/notify` (Resend).
//   2. Write a Firestore `notifications` doc per recipient so the
//      in-app bell badge updates.
//
// All helpers swallow errors — a notification glitch must NEVER stop a
// user from reacting / commenting / posting. The data write already
// committed by the time we get called.

import {
  notifyMomentReaction, notifyMomentComment, notifyMomentMention, notifyMomentNewPost,
} from './notify';
import { createNotification, getUserProfile, getFamilyMembers, UserProfile } from './firestore';
import { Post, Reaction } from './moments';

function buildPostUrl(postId: string): string {
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
  return `${origin}/moments/${postId}`;
}

function snippet(text: string | undefined, n = 80): string {
  if (!text) return '';
  const trimmed = text.trim();
  return trimmed.length > n ? `${trimmed.slice(0, n - 1)}…` : trimmed;
}

// ── Reactions ───────────────────────────────────────────────────

/** Notify the post author when someone reacts. No-op if the reactor
 *  is the author (no self-notifications) or if the author has no
 *  email on file. */
export async function notifyOnReaction(
  familyId: string,
  post: Pick<Post, 'id' | 'authorUid' | 'caption'>,
  reactor: { uid: string; name: string },
  emoji: Reaction,
): Promise<void> {
  if (reactor.uid === post.authorUid) return;
  try {
    const author = await getUserProfile(post.authorUid);
    if (!author) return;
    const link = `/moments/${post.id}`;
    const captionSnippet = snippet(post.caption, 80);
    // Email
    if (author.email) {
      void notifyMomentReaction({
        to: [author.email],
        authorName: author.displayName,
        reactorName: reactor.name,
        emoji,
        captionSnippet,
        postUrl: buildPostUrl(post.id),
      });
    }
    // In-app
    void createNotification(familyId, {
      type: 'moment-reaction',
      title: `${reactor.name} reacted ${emoji}`,
      message: captionSnippet ? `On "${captionSnippet}"` : 'On your moment',
      read: false,
      forUserId: author.uid,
      link,
    } as any);
  } catch {
    // Silent — notifications are non-critical.
  }
}

// ── Comments ────────────────────────────────────────────────────

/** Notify the post author when someone comments (excluding self). */
export async function notifyOnComment(
  familyId: string,
  post: Pick<Post, 'id' | 'authorUid' | 'caption'>,
  commenter: { uid: string; name: string },
  commentText: string,
  mentionedUids?: string[],
): Promise<void> {
  const commentSnippet = snippet(commentText, 140);
  const link = `/moments/${post.id}`;
  try {
    // Notify the author (skip if they commented on their own post)
    if (commenter.uid !== post.authorUid) {
      const author = await getUserProfile(post.authorUid);
      if (author) {
        if (author.email) {
          void notifyMomentComment({
            to: [author.email],
            authorName: author.displayName,
            commenterName: commenter.name,
            commentSnippet,
            postUrl: buildPostUrl(post.id),
          });
        }
        void createNotification(familyId, {
          type: 'moment-comment',
          title: `${commenter.name} commented`,
          message: commentSnippet,
          read: false,
          forUserId: author.uid,
          link,
        } as any);
      }
    }
    // Notify each mentioned user (skip the commenter + post author who already got an email)
    const seen = new Set<string>([commenter.uid, post.authorUid]);
    for (const uid of mentionedUids || []) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      const target = await getUserProfile(uid);
      if (!target) continue;
      if (target.email) {
        void notifyMomentMention({
          to: [target.email],
          mentionedName: target.displayName,
          fromName: commenter.name,
          context: 'comment',
          snippet: commentSnippet,
          postUrl: buildPostUrl(post.id),
        });
      }
      void createNotification(familyId, {
        type: 'moment-mention',
        title: `${commenter.name} mentioned you`,
        message: commentSnippet,
        read: false,
        forUserId: target.uid,
        link,
      } as any);
    }
  } catch {
    // Silent.
  }
}

// ── New post ────────────────────────────────────────────────────

/** Notify everyone in the family (excluding the author) + each user
 *  whose uid appears in `mentionedUids`. Mentioned users get a more
 *  specific "mentioned you" notification instead of the generic
 *  "new post" one. */
export async function notifyOnNewPost(
  familyId: string,
  post: Pick<Post, 'id' | 'authorUid' | 'authorName' | 'caption' | 'photos'>,
  mentionedUids: string[],
): Promise<void> {
  const link = `/moments/${post.id}`;
  const captionSnippet = snippet(post.caption, 120);
  const postUrl = buildPostUrl(post.id);
  try {
    const members = await getFamilyMembers(familyId);
    const mentionedSet = new Set(mentionedUids);
    const others: UserProfile[] = [];
    const mentionedTargets: UserProfile[] = [];
    for (const m of members) {
      if (m.uid === post.authorUid) continue;
      if (mentionedSet.has(m.uid)) mentionedTargets.push(m);
      else others.push(m);
    }
    // 1. Mention notifications (more specific — higher signal)
    for (const t of mentionedTargets) {
      if (t.email) {
        void notifyMomentMention({
          to: [t.email],
          mentionedName: t.displayName,
          fromName: post.authorName,
          context: 'caption',
          snippet: captionSnippet,
          postUrl,
        });
      }
      void createNotification(familyId, {
        type: 'moment-mention',
        title: `${post.authorName} mentioned you`,
        message: captionSnippet || 'In a moment',
        read: false,
        forUserId: t.uid,
        link,
      } as any);
    }
    // 2. New-post notifications to everyone else (bulk email; per-user
    // in-app docs so each member's bell badge updates independently).
    const otherEmails = others.map((o) => o.email).filter(Boolean) as string[];
    if (otherEmails.length) {
      void notifyMomentNewPost({
        to: otherEmails,
        authorName: post.authorName,
        captionSnippet,
        photoCount: post.photos.length,
        postUrl,
      });
    }
    for (const o of others) {
      void createNotification(familyId, {
        type: 'moment-new',
        title: `${post.authorName} shared a moment`,
        message: captionSnippet || `${post.photos.length} photo${post.photos.length === 1 ? '' : 's'}`,
        read: false,
        forUserId: o.uid,
        link,
      } as any);
    }
  } catch {
    // Silent.
  }
}
