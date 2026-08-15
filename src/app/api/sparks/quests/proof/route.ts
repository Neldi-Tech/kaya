// Kaya Sparks · Quests — proof media upload (2026-08-15).
//
// Audio and video proof is uploaded THROUGH the server with the Admin
// SDK rather than straight from the browser. Two reasons, both real:
//
//   1. ZERO storage.rules deploys (D18). The Admin SDK bypasses Storage
//      rules entirely, so a new media path needs no rules change and no
//      deploy on Elia's side.
//   2. The size ceiling becomes a friendly, catchable error instead of a
//      silent browser failure — a kid on a Dar es Salaam data bundle
//      gets "try audio instead", not a spinner that never stops.
//
// Photos and scans keep using the existing client photo pipeline
// (`uploadSparksPhoto`), which already compresses to three sizes under a
// path storage.rules has allowed since Slice 2.
//
// Request: POST /api/sparks/quests/proof?questId=…&kind=audio|video&seconds=42
//   Authorization: Bearer <id token>
//   Content-Type:  audio/webm | video/mp4 | …
//   Body:          the raw bytes
// Response: { url, kind, seconds }

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth, getAdminStorage } from '@/lib/firebaseAdmin';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Vercel caps a serverless request body at ~4.5 MB. We refuse a shade
 *  under that so the failure is ours (readable) not the platform's. */
const MAX_BYTES = 4 * 1024 * 1024;

const ALLOWED: Record<string, RegExp> = {
  audio: /^audio\/(webm|mp4|mpeg|ogg|wav|aac|x-m4a)/,
  video: /^video\/(webm|mp4|quicktime)/,
};

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  const storage = getAdminStorage();
  if (!db || !adminAuth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });
  if (!storage) return NextResponse.json({ error: 'storage-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await adminAuth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  const url = new URL(req.url);
  const questId = (url.searchParams.get('questId') || '').slice(0, 80);
  const kind = (url.searchParams.get('kind') || '').slice(0, 10);
  const seconds = Number(url.searchParams.get('seconds') || '0');
  if (!questId) return NextResponse.json({ error: 'bad-quest' }, { status: 400 });
  if (kind !== 'audio' && kind !== 'video') {
    return NextResponse.json({ error: 'bad-kind' }, { status: 400 });
  }

  // The quest must exist in THIS family — a stray questId can't be used
  // to write bytes into someone else's bucket prefix.
  const questSnap = await db.collection('families').doc(familyId)
    .collection('sparks_quests').doc(questId).get();
  if (!questSnap.exists) return NextResponse.json({ error: 'no-such-quest' }, { status: 404 });

  const contentType = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (!ALLOWED[kind].test(contentType)) {
    return NextResponse.json({ error: 'bad-content-type', got: contentType }, { status: 415 });
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return NextResponse.json({ error: 'empty-body' }, { status: 400 });
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({
      error: 'too-large',
      hint: kind === 'video'
        ? 'That clip is too big. Keep videos under 45 seconds — or record audio instead, which is lighter and usually the better proof anyway.'
        : 'That recording is too long. Keep it under 60 seconds.',
    }, { status: 413 });
  }

  const ext = contentType.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin';
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `families/${familyId}/sparks_quests/${questId}/${id}.${ext}`;

  // A Firebase download token turns the object into a normal, long-lived
  // https URL — no signed-URL expiry to babysit, same shape as every
  // other media URL the app already stores.
  const downloadToken = randomUUID();
  const bucket = storage.bucket();
  await bucket.file(path).save(buf, {
    contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: downloadToken } },
  });

  const publicUrl =
    `https://firebasestorage.googleapis.com/v0/b/${bucket.name}`
    + `/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`;

  return NextResponse.json({
    url: publicUrl,
    kind,
    seconds: Number.isFinite(seconds) ? Math.round(seconds) : 0,
  });
}
