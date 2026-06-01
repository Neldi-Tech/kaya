// Kaya Games — a guest who's ALREADY on Kaya taps "Yes, connect us" at the end
// of a game. We save a PENDING family connection (guest @handle ⇄ host family),
// dormant until Kaya ships family-to-family connections — then both sides get a
// mutual "Connect?" nudge (never automatic). Admin-written; clients can't read
// or write the collection directly.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  hostFamilyId?: string; hostHandle?: string | null;
  guestName?: string; guestHandle?: string; guestUid?: string;
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-sdk-not-configured' }, { status: 500 });

  // Verify the guest's anonymous token when present (forge-proof guestUid).
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  let guestUid = '';
  if (token) { try { guestUid = (await auth.verifyIdToken(token)).uid; } catch { /* ignore */ } }

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const hostFamilyId = (body.hostFamilyId || '').trim();
  const guestHandle = (body.guestHandle || '').trim().replace(/^@/, '').slice(0, 40);
  if (!hostFamilyId || !guestHandle) return NextResponse.json({ error: 'missing-params' }, { status: 400 });

  await db.collection('guestConnections').add({
    hostFamilyId,
    hostHandle: body.hostHandle || null,
    guestUid: guestUid || body.guestUid || null,
    guestName: (body.guestName || '').slice(0, 40),
    guestHandle,
    status: 'pending',
    createdAt: Date.now(),
  });

  return NextResponse.json({ ok: true });
}
