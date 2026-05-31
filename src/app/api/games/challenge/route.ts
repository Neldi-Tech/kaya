// Kaya Games — Real-World challenge completion (Admin SDK).
//
// A kid does a challenge IRL, uploads a photo, and POSTs the proof URL here.
// We record a PENDING gamePlay carrying the proof — it credits NOTHING until a
// parent approves it in the existing /games/approvals queue (same money path
// as every other valued game; the approve route applies the caps + mints HP).
//
// Real-World games are worth their parent-set value, falling back to the
// catalog's suggested value (75/60/50/40) so the "do it → prove it → approve"
// loop works out of the box. One pending entry per (kid, game): re-submitting
// a still-pending challenge just refreshes its photo.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { getGame } from '@/lib/gamesCatalog';
import {
  resolveGamesConfig, ageFromBirthday, pointsMultiplier,
  gamePointsValue, localDateKey, localWeekStartKey,
} from '@/lib/games';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { gameId?: string; proofUrl?: string; tzOffsetMinutes?: number }

const PROOF_URL_RE = /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//;

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const game = getGame((body.gameId || '').trim());
  if (!game || game.world !== 'realworld') return NextResponse.json({ error: 'bad-game' }, { status: 400 });
  const proofUrl = (body.proofUrl || '').trim();
  if (!proofUrl || !PROOF_URL_RE.test(proofUrl)) return NextResponse.json({ error: 'bad-proof-url' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; childId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  if (user?.role !== 'kid' || !user.childId) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not-a-kid' });
  }
  const kidId = user.childId;

  const famSnap = await db.collection('families').doc(familyId).get();
  if (!famSnap.exists) return NextResponse.json({ error: 'no-family-doc' }, { status: 404 });
  const cfg = resolveGamesConfig(famSnap.data()?.gamesConfig);

  const childRef = db.collection('families').doc(familyId).collection('children').doc(kidId);
  const childSnap = await childRef.get();
  if (!childSnap.exists) return NextResponse.json({ error: 'no-child' }, { status: 404 });
  const child = childSnap.data() as { name?: string; displayName?: string; birthday?: string };
  const kidName = child.displayName || child.name || 'Your child';

  // Parent value if set, else the catalog's suggested value (Real-World is
  // worth its brief value by default — it always needs a parent's eyes anyway).
  const age = ageFromBirthday(child.birthday);
  const mult = pointsMultiplier(cfg, game.world, age); // realworld → 1
  const parentVal = gamePointsValue(cfg, game.id);
  const basePoints = parentVal > 0 ? parentVal : game.points;
  const proposed = Math.max(0, Math.round(basePoints * mult));
  if (proposed <= 0) return NextResponse.json({ ok: true, status: 'logged', pointsPending: 0 });

  const tz = Number(body.tzOffsetMinutes) || 0;
  const dateKey = localDateKey(Date.now(), tz);
  const weekKey = localWeekStartKey(Date.now(), tz);
  const playsCol = db.collection('families').doc(familyId).collection('gamePlays');

  // Collapse repeats: refresh an existing pending challenge instead of stacking.
  const pendingSnap = await playsCol.where('kidId', '==', kidId).where('status', '==', 'pending').get();
  const existing = pendingSnap.docs.find((d) => (d.data() as { gameId?: string }).gameId === game.id);

  const payload = {
    kidId, kidName, gameId: game.id, gameName: game.name, world: game.world,
    score: null, durationSec: 0, status: 'pending',
    pointsAwarded: 0, pointsPending: proposed, basePoints, multiplier: mult,
    dateKey, weekKey, capped: false, proofUrl, createdAt: Date.now(),
  };

  if (existing) {
    await existing.ref.update({ proofUrl, pointsPending: proposed, basePoints, dateKey, weekKey, createdAt: Date.now() });
  } else {
    await playsCol.add(payload);
  }
  return NextResponse.json({ ok: true, status: 'pending', pointsPending: proposed });
}
