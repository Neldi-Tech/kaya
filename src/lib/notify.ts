// Client-side helpers for the /api/notify endpoint. All calls are
// fire-and-forget — they never throw, so a notification failure can never
// block the user's actual write (rating, award, etc.).

interface RatingNotify {
  to: string[];
  childName: string;
  actorName: string;
  points: number;
  period: 'morning' | 'evening';
}

interface AwardNotify {
  to: string[];
  childName: string;
  actorName: string;
  points: number;
  reason: string;
  isDiamond?: boolean;
}

interface InviteNotify {
  to: string[];
  kidName: string;
  familyName: string;
  inviterName: string;
}

async function post(payload: unknown): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Swallow — notifications are non-critical.
  }
}

export function notifyRating(args: RatingNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({
    type: 'rating',
    to: args.to,
    data: {
      childName: args.childName,
      actorName: args.actorName,
      points: args.points,
      period: args.period,
    },
  });
}

export function notifyAward(args: AwardNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({
    type: 'award',
    to: args.to,
    data: {
      childName: args.childName,
      actorName: args.actorName,
      points: args.points,
      reason: args.reason,
      isDiamond: !!args.isDiamond,
    },
  });
}

export function notifyInvite(args: InviteNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({
    type: 'invite',
    to: args.to,
    data: {
      childName: args.kidName,
      actorName: args.inviterName,
      points: 0,
      familyName: args.familyName,
    },
  });
}

// ── Moments notifications ────────────────────────────────────────

interface MomentReactionNotify {
  to: string[];
  authorName: string;
  reactorName: string;
  emoji: string;
  captionSnippet: string;
  postUrl: string;
}

interface MomentCommentNotify {
  to: string[];
  authorName: string;
  commenterName: string;
  commentSnippet: string;
  postUrl: string;
}

interface MomentMentionNotify {
  to: string[];
  mentionedName: string;
  fromName: string;
  context: 'caption' | 'comment';
  snippet: string;
  postUrl: string;
}

interface MomentNewPostNotify {
  to: string[];
  authorName: string;
  captionSnippet: string;
  photoCount: number;
  postUrl: string;
}

export function notifyMomentReaction(args: MomentReactionNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({ type: 'moment-reaction', to: args.to, data: args });
}

export function notifyMomentComment(args: MomentCommentNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({ type: 'moment-comment', to: args.to, data: args });
}

export function notifyMomentMention(args: MomentMentionNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({ type: 'moment-mention', to: args.to, data: args });
}

export function notifyMomentNewPost(args: MomentNewPostNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({ type: 'moment-new', to: args.to, data: args });
}
