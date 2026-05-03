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
