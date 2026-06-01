// Kaya Games — a guest joins a family's game room (Admin SDK).
//
// A visitor (anonymous Firebase user, NOT in the family) POSTs the host's
// familyId + room code. The route verifies the code maps to a LIVE session,
// adds the guest to that session's players + playerUids (so the security rule
// lets them read/write only that one room), and returns the host family's
// referral details for the end-of-game "bring Kaya home" card.
//
// Guests never touch family data — only the one game session.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { generateReferralCode } from '@/lib/referral';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { familyId?: string; code?: string; name?: string; isKid?: boolean }

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-sdk-not-configured' }, { status: 500 });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const familyId = (body.familyId || '').trim();
  const code = (body.code || '').trim().toUpperCase();
  const name = (body.name || 'Guest').trim().slice(0, 24) || 'Guest';
  if (!familyId || !code) return NextResponse.json({ error: 'missing-params' }, { status: 400 });

  // Find a live session for this code in the host family.
  const snap = await db.collection('families').doc(familyId).collection('gameSessions')
    .where('code', '==', code).get();
  const now = Date.now();
  const doc = snap.docs.find((d) => {
    const s = d.data() as { status?: string; expiresAt?: number };
    return s.status !== 'done' && (!s.expiresAt || s.expiresAt > now);
  });
  if (!doc) return NextResponse.json({ error: 'no-live-session' }, { status: 404 });

  const sData = doc.data() as { gameId?: string; players?: { uid: string }[]; playerUids?: string[] };
  const already = (sData.playerUids || []).includes(uid);
  if (!already) {
    await doc.ref.update({
      players: [...(sData.players || []), { uid, name, guest: true }],
      playerUids: [...(sData.playerUids || []), uid],
    });
  }

  // Host family's referral details for the end-card. Ensure a referral code
  // exists so the "bring it home" link always works.
  const famSnap = await db.collection('families').doc(familyId).get();
  const fam = (famSnap.data() || {}) as { name?: string; referralCode?: string; handle?: string };
  let referralCode = fam.referralCode;
  if (!referralCode) {
    referralCode = generateReferralCode(fam.name || 'Kaya');
    try { await famSnap.ref.update({ referralCode }); } catch { /* best-effort */ }
  }

  return NextResponse.json({
    ok: true,
    sessionId: doc.id,
    gameId: sData.gameId || '',
    familyId,
    hostFamilyName: fam.name || 'a Kaya family',
    hostHandle: fam.handle || null,
    referralCode,
  });
}
