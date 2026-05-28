// POST /api/tier-codes/check-expiry — any signed-in family member.
//
// Lazy expiry sweep — called by useTierAccess() when it detects
// `family.subscription.expiresAt < now` for the caller's own family.
// Server re-checks (so the client can't fake it) and, if truly past
// expiry, reverts the family to Nest and clears the expiry seam.
//
// No-op if the family isn't expired. Safe to call repeatedly.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveAuth } from '@/lib/buzzServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx } = r;
  if (!ctx.familyId) return NextResponse.json({ error: 'no-family' }, { status: 400 });

  const famRef = db.collection('families').doc(ctx.familyId);
  const famSnap = await famRef.get();
  if (!famSnap.exists) return NextResponse.json({ error: 'family-not-found' }, { status: 404 });

  const fam = famSnap.data() as {
    isFoundingFamily?: boolean;
    subscription?: { expiresAt?: { toMillis?: () => number }; redeemedCodeId?: string };
  };
  // Founding families never expire.
  if (fam.isFoundingFamily) return NextResponse.json({ ok: true, expired: false, reason: 'founding' });
  const expiresAt = fam.subscription?.expiresAt;
  if (!expiresAt || typeof expiresAt.toMillis !== 'function') {
    return NextResponse.json({ ok: true, expired: false });
  }
  const expiresAtMs = expiresAt.toMillis();
  if (expiresAtMs >= Date.now()) {
    return NextResponse.json({ ok: true, expired: false });
  }

  // Revert: tierId → nest, addons cleared, expiry seam cleared. Also
  // mark the originating code (if any) as 'expired' so the admin
  // history reflects the real state.
  const codeId = fam.subscription?.redeemedCodeId;
  const batch = db.batch();
  batch.update(famRef, {
    tierId: 'nest',
    'subscription.addons': [],
    'subscription.expiresAt': FieldValue.delete(),
    'subscription.redeemedCodeId': FieldValue.delete(),
    'subscription.revertedAt': FieldValue.serverTimestamp(),
  });
  if (codeId) {
    batch.update(db.collection('tierCodes').doc(codeId), { status: 'expired', expiredAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();

  return NextResponse.json({ ok: true, expired: true });
}
