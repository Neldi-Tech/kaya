// GET /api/sparks?status=&category=&sort= — list public sparks (sanitised).
// POST /api/sparks                          — create a new spark.
//
// All client interaction with /sparks/** flows through this server. The
// Firestore rules deny direct client reads/writes, so the API is the
// only path. This is what enforces anonymity: real family names live in
// the doc but are stripped here for non-operators.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveAuth, sanitizeSpark, trimToLen, VALID_CATEGORIES, loadSparksSettings, type RawSpark } from '@/lib/sparksServer';
import type { SparkCategory, SparkStatus } from '@/lib/sparks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── GET — list sparks ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const resolved = await resolveAuth(req);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { ctx, db } = resolved;

  const url = new URL(req.url);
  const category = url.searchParams.get('category');
  const status = url.searchParams.get('status');
  const sort = url.searchParams.get('sort') ?? 'hot';

  let q: FirebaseFirestore.Query = db.collection('sparks');
  if (category && VALID_CATEGORIES.has(category as SparkCategory)) {
    q = q.where('category', '==', category);
  }
  if (status && status !== 'all') {
    q = q.where('status', '==', status as SparkStatus);
  }

  // 'hot' sorts by upvotes + recency hybrid (just upvotes server-side; tie
  // broken by createdAt). 'new' = most recent first. 'top' = most upvotes.
  // For non-operators we hide sparks that are in 'review' awaiting
  // moderation (auto-publish setting toggles this filter on insert,
  // but reads always strip).
  if (sort === 'new') q = q.orderBy('createdAt', 'desc');
  else if (sort === 'top') q = q.orderBy('upvoteCount', 'desc').orderBy('createdAt', 'desc');
  else q = q.orderBy('upvoteCount', 'desc').orderBy('createdAt', 'desc');

  q = q.limit(60);

  const snap = await q.get();
  const sparks: ReturnType<typeof sanitizeSpark>[] = [];

  // Pre-fetch the caller's upvotes for this page in parallel.
  const ids = snap.docs.map((d) => d.id);
  const voteSnaps = await Promise.all(ids.map((sid) => db.collection('sparks').doc(sid).collection('upvotes').doc(ctx.uid).get()));
  const myVotes = new Set(ids.filter((_, i) => voteSnaps[i].exists));

  for (const doc of snap.docs) {
    const raw = doc.data() as RawSpark;
    // Hide 'review' status from non-operators (review queue is admin-only).
    if (raw.status === 'review' && !ctx.isOperator) continue;
    sparks.push(sanitizeSpark(doc.id, raw, ctx, myVotes.has(doc.id)));
  }

  return NextResponse.json({ sparks });
}

// ── POST — create a spark ─────────────────────────────────────────────

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
  const category = String(body.category ?? '') as SparkCategory;
  let postedAnonymously = body.postedAnonymously === true;

  if (!title) return NextResponse.json({ error: 'title-required' }, { status: 400 });
  if (!text)  return NextResponse.json({ error: 'body-required' }, { status: 400 });
  if (!VALID_CATEGORIES.has(category)) return NextResponse.json({ error: 'bad-category' }, { status: 400 });

  // Settings gate: if anonymous posts are disabled globally, force the
  // flag off. Kids default to anonymous when 'kidsDefaultAnonymous' is on
  // even if the client sent false — parent override has to be explicit.
  const settings = await loadSparksSettings(db);
  if (!settings.allowAnonymous) postedAnonymously = false;
  if (ctx.role === 'kid' && settings.kidsDefaultAnonymous && body.postedAnonymously !== false) {
    postedAnonymously = true;
  }

  // Stories category gate.
  if (category === 'story' && !settings.showStoriesCategory) {
    return NextResponse.json({ error: 'stories-disabled' }, { status: 400 });
  }

  const initialStatus: SparkStatus = settings.autoPublish ? 'new' : 'review';
  const now = FieldValue.serverTimestamp();
  const docRef = db.collection('sparks').doc();
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
