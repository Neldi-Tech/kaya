// 📬 KID PR2 — 🏅 reward email ping (fire-and-forget from giveAward).
//
// POST { childId, awardId } + Firebase ID token.
//
// The payload carries only IDs — the email's words derive from the award
// DOC server-side, so no family member can put arbitrary text in a kid's
// inbox through this route. Caller must belong to the kid's family (any
// role: parents give awards, kids send kudos). Sends only when the parent
// armed the 🏅 stream in Household Setup; always best-effort (the award
// already exists — this route can only add delight, never break it).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { sendKidRewardEmail } from '@/lib/kidEmails.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: { childId?: string; awardId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const { childId, awardId } = body;
  if (!childId || !awardId) return NextResponse.json({ error: 'missing-fields' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as { familyId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  const award = (await db.collection('families').doc(familyId)
    .collection('awards').doc(awardId).get()).data() as
    { childId?: string; kind?: string; points?: number; reason?: string; awardedByName?: string } | undefined;
  if (!award || award.childId !== childId) {
    return NextResponse.json({ error: 'award-not-found' }, { status: 404 });
  }

  // Only celebrate actual rewards: point-bearing positives + kudos.
  // Reducing / improvement notes are parenting tools, not celebrations.
  const points = Number(award.points ?? 0);
  const kind = award.kind ?? 'regular';
  let emoji: string; let headline: string;
  if (kind === 'kudos') { emoji = '👏'; headline = 'Kudos!'; }
  else if (points > 0 && kind === 'diamond') { emoji = '💎'; headline = `+${points} House Points!`; }
  else if (points > 0) { emoji = '🏅'; headline = `+${points} House Points!`; }
  else return NextResponse.json({ ok: true, skipped: 'not-a-celebration' });

  const from = award.awardedByName ? ` — from ${award.awardedByName}` : '';
  await sendKidRewardEmail(db, familyId, childId, {
    emoji, headline,
    detail: `${award.reason || 'Great work'}${from}`,
  });

  return NextResponse.json({ ok: true });
}
