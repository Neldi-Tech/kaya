// Client-side fetch wrappers for /api/buzz/*. Lives in its own file
// (separate from lib/buzz.ts) so server routes never accidentally pull
// in the firebase web SDK at build time. If you're in a server route,
// import from `lib/buzzServer` instead.

import { auth } from './firebase';
import type {
  Buzz, BuzzCategory, BuzzComment, BuzzListOptions, BuzzStatus,
  BuzzTargetWindow, BuzzSettings,
} from './buzz';

async function authHeader(): Promise<HeadersInit> {
  const u = auth.currentUser;
  if (!u) throw new Error('not-signed-in');
  const token = await u.getIdToken();
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

export async function listBuzz(opts: BuzzListOptions = {}): Promise<Buzz[]> {
  const params = new URLSearchParams();
  if (opts.category && opts.category !== 'all') params.set('category', opts.category);
  if (opts.status && opts.status !== 'all') params.set('status', opts.status);
  if (opts.sort) params.set('sort', opts.sort);
  const res = await fetch(`/api/buzz?${params.toString()}`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`list-buzz-failed-${res.status}`);
  const { buzz } = (await res.json()) as { buzz: Buzz[] };
  return buzz;
}

export interface CreateBuzzInput {
  title: string;
  body: string;
  category: BuzzCategory;
  postedAnonymously: boolean;
}

export async function createBuzz(input: CreateBuzzInput): Promise<{ id: string }> {
  const res = await fetch('/api/buzz', {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`create-buzz-failed-${res.status}`);
  return res.json();
}

export async function listBuzzComments(buzzId: string): Promise<BuzzComment[]> {
  const res = await fetch(`/api/buzz/${buzzId}/comments`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`list-comments-failed-${res.status}`);
  const { comments } = (await res.json()) as { comments: BuzzComment[] };
  return comments;
}

export async function addBuzzComment(buzzId: string, body: string, postedAnonymously: boolean): Promise<{ id: string }> {
  const res = await fetch(`/api/buzz/${buzzId}/comments`, {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({ body, postedAnonymously }),
  });
  if (!res.ok) throw new Error(`add-comment-failed-${res.status}`);
  return res.json();
}

export async function toggleUpvote(buzzId: string): Promise<{ voted: boolean; upvoteCount: number }> {
  const res = await fetch(`/api/buzz/${buzzId}/upvote`, {
    method: 'POST',
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`upvote-failed-${res.status}`);
  return res.json();
}

export interface TransitionInput {
  status: BuzzStatus;
  comingSoonTargetWindow?: BuzzTargetWindow;
  /** When transitioning to 'live': set true after the confirm dialog. */
  confirmReward?: boolean;
}

export async function transitionBuzz(buzzId: string, input: TransitionInput): Promise<{ ok: true; rewardCredited?: number }> {
  const res = await fetch(`/api/buzz/${buzzId}/transition`, {
    method: 'PATCH',
    headers: await authHeader(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`transition-failed-${res.status}`);
  return res.json();
}

export async function getBuzzSettings(): Promise<BuzzSettings> {
  const res = await fetch('/api/buzz/settings', { headers: await authHeader() });
  if (!res.ok) throw new Error(`settings-failed-${res.status}`);
  const { settings } = (await res.json()) as { settings: BuzzSettings };
  return settings;
}

export async function saveBuzzSettings(patch: Partial<BuzzSettings>): Promise<BuzzSettings> {
  const res = await fetch('/api/buzz/settings', {
    method: 'PATCH',
    headers: await authHeader(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`save-settings-failed-${res.status}`);
  const { settings } = (await res.json()) as { settings: BuzzSettings };
  return settings;
}
