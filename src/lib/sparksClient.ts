// Client-side fetch wrappers for /api/sparks/*. Lives in its own file
// (separate from lib/sparks.ts) so server routes never accidentally pull
// in the firebase web SDK at build time. If you're in a server route,
// import from `lib/sparksServer` instead.

import { auth } from './firebase';
import type {
  Spark, SparkCategory, SparkComment, SparkListOptions, SparkStatus,
  SparkTargetWindow, SparksSettings,
} from './sparks';

async function authHeader(): Promise<HeadersInit> {
  const u = auth.currentUser;
  if (!u) throw new Error('not-signed-in');
  const token = await u.getIdToken();
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

export async function listSparks(opts: SparkListOptions = {}): Promise<Spark[]> {
  const params = new URLSearchParams();
  if (opts.category && opts.category !== 'all') params.set('category', opts.category);
  if (opts.status && opts.status !== 'all') params.set('status', opts.status);
  if (opts.sort) params.set('sort', opts.sort);
  const res = await fetch(`/api/sparks?${params.toString()}`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`list-sparks-failed-${res.status}`);
  const { sparks } = (await res.json()) as { sparks: Spark[] };
  return sparks;
}

export interface CreateSparkInput {
  title: string;
  body: string;
  category: SparkCategory;
  postedAnonymously: boolean;
}

export async function createSpark(input: CreateSparkInput): Promise<{ id: string }> {
  const res = await fetch('/api/sparks', {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`create-spark-failed-${res.status}`);
  return res.json();
}

export async function listSparkComments(sparkId: string): Promise<SparkComment[]> {
  const res = await fetch(`/api/sparks/${sparkId}/comments`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`list-comments-failed-${res.status}`);
  const { comments } = (await res.json()) as { comments: SparkComment[] };
  return comments;
}

export async function addSparkComment(sparkId: string, body: string, postedAnonymously: boolean): Promise<{ id: string }> {
  const res = await fetch(`/api/sparks/${sparkId}/comments`, {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({ body, postedAnonymously }),
  });
  if (!res.ok) throw new Error(`add-comment-failed-${res.status}`);
  return res.json();
}

export async function toggleUpvote(sparkId: string): Promise<{ voted: boolean; upvoteCount: number }> {
  const res = await fetch(`/api/sparks/${sparkId}/upvote`, {
    method: 'POST',
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`upvote-failed-${res.status}`);
  return res.json();
}

export interface TransitionInput {
  status: SparkStatus;
  comingSoonTargetWindow?: SparkTargetWindow;
  /** When transitioning to 'live': set true after the confirm dialog. */
  confirmReward?: boolean;
}

export async function transitionSpark(sparkId: string, input: TransitionInput): Promise<{ ok: true; rewardCredited?: number }> {
  const res = await fetch(`/api/sparks/${sparkId}/transition`, {
    method: 'PATCH',
    headers: await authHeader(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`transition-failed-${res.status}`);
  return res.json();
}

export async function getSparksSettings(): Promise<SparksSettings> {
  const res = await fetch('/api/sparks/settings', { headers: await authHeader() });
  if (!res.ok) throw new Error(`settings-failed-${res.status}`);
  const { settings } = (await res.json()) as { settings: SparksSettings };
  return settings;
}

export async function saveSparksSettings(patch: Partial<SparksSettings>): Promise<SparksSettings> {
  const res = await fetch('/api/sparks/settings', {
    method: 'PATCH',
    headers: await authHeader(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`save-settings-failed-${res.status}`);
  const { settings } = (await res.json()) as { settings: SparksSettings };
  return settings;
}
