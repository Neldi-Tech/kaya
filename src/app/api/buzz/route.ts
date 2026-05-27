// GET /api/buzz?status=&category=&sort= — list public buzz (sanitised).
// POST /api/buzz                          — create a new buzz.
//
// All client interaction with /buzz/** flows through this server. The
// Firestore rules deny direct client reads/writes, so the API is the
// only path. This is what enforces anonymity: real family names live in
// the doc but are stripped here for non-operators.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveAuth, sanitizeBuzz, trimToLen, VALID_CATEGORIES, loadBuzzSettings, type RawBuzz } from '@/lib/buzzServer';
import type { BuzzCategory, BuzzStatus } from '@/lib/buzz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── GET — list buzz ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const resolved = await resolveAuth(req);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { ctx, db } = resolved;

  const url = new URL(req.url);
  const category = url.searchParams.get('category');
  const status = url.searchParams.get('status');
  const sort = url.searchParams.get('sort') ?? 'hot';

  let q: FirebaseFirestore.Query = db.collection('buzz');
  if (category && VALID_CATEGORIES.has(category as BuzzCategory)) {
    q = q.where('category', '==', category);
  }
  if (status && status !== 'all') {
    q = q.where('status', '==', status as BuzzStatus);
  }

  // 'hot' sorts by upvotes + recency hybrid (just upvotes server-side; tie
  // broken by createdAt). 'new' = most recent first. 'top' = most upvotes.
  // For non-operators we hide buzz that are in 'review' awaiting
  // moderation (auto-publish setting toggles this filter on insert,
  // but reads always strip).
  if (sort === 'new') q = q.orderBy('createdAt', 'desc');
  else if (sort === 'top') q = q.orderBy('upvoteCount', 'desc').orderBy('createdAt', 'desc');
  else q = q.orderBy('upvoteCount', 'desc').orderBy('createdAt', 'desc');

  q = q.limit(60);

  const snap = await q.get();
  const buzz: ReturnType<typeof sanitizeBuzz>[] = [];

  // Pre-fetch the caller's upvotes for this page in parallel.
  const ids = snap.docs.map((d) => d.id);
  const voteSnaps = await Promise.all(ids.map((sid) => db.collection('buzz').doc(sid).collection('upvotes').doc(ctx.uid).get()));
  const myVotes = new Set(ids.filter((_, i) => voteSnaps[i].exists));

  for (const doc of snap.docs) {
    const raw = doc.data() as RawBuzz;
    // Hide 'review' status from non-operators (review queue is admin-only).
    if (raw.status === 'review' && !ctx.isOperator) continue;
    buzz.push(sanitizeBuzz(doc.id, raw, ctx, myVotes.has(doc.id)));
  }

  return NextResponse.json({ buzz });
}

// ── POST — create a buzz ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const resolved = await resolveAuth(req);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { ctx, db } = resolved;

  if (!ctx.familyId || !ctx.familyDisplayName) {
    return NextResponse.json({ error: 'no-family' }, { status: 400 });
  }

  let body: { title?: string; body?: string; category?: string; postedAnonymously?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const title = trimToLen(String(body.title ?? ''), 120);
  const text = trimToLen(String(body.body ?? ''), 2000);
  const category = String(body.category ?? '') as BuzzCategory;
  let postedAnonymously = body.postedAnonymously === true;

  if (!title) return NextResponse.json({ error: 'title-required' }, { status: 400 });
  if (!text)  return NextResponse.json({ error: 'body-required' }, { status: 400 });
  if (!VALID_CATEGORIES.has(category)) return NextResponse.json({ error: 'bad-category' }, { status: 400 });

  // Settings gate: if anonymous posts are disabled globally, force the
  // flag off. Kids default to anonymous when 'kidsDefaultAnonymous' is on
  // even if the client sent false — parent override has to be explicit.
  const settings = await loadBuzzSettings(db);
  if (!settings.allowAnonymous) postedAnonymously = false;
  if (ctx.role === 'kid' && settings.kidsDefaultAnonymous && body.postedAnonymously !== false) {
    postedAnonymously = true;
  }

  // Stories category gate.
  if (category === 'story' && !settings.showStoriesCategory) {
    return NextResponse.json({ error: 'stories-disabled' }, { status: 400 });
  }

  const initialStatus: BuzzStatus = settings.autoPublish ? 'new' : 'review';
  const now = FieldValue.serverTimestamp();
  const docRef = db.collection('buzz').doc();
  await docRef.set({
    title,
    body: text,
    category,
    status: initialStatus,
    comingSoonTargetWindow: null,
    upvoteCount: 0,
    commentCount: 0,
    authorUid: ctx.uid,
    authorFamilyId: ctx.familyId,
    authorRealName: ctx.familyDisplayName,
    postedAnonymously,
    createdAt: now,
    updatedAt: now,
    shippedAt: null,
    rewardedHoneyCoins: null,
  });

  return NextResponse.json({ id: docRef.id });
}
