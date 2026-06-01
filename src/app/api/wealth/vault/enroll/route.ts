// POST /api/wealth/vault/enroll — begin TOTP enrollment for the caller.
// Returns the QR (data URL), the manual base32 secret, and one-time recovery
// codes (shown exactly once). The pending secret is stored encrypted until
// the user confirms with a live code (enroll-verify).

import { NextRequest, NextResponse } from 'next/server';
import { verifyBearer, startEnrollment } from '@/lib/wealthVaultServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const who = await verifyBearer(req);
  if (!who) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  try {
    const result = await startEnrollment(who.uid, who.email);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'enroll-failed';
    const status = msg === 'vault-crypto-not-configured' || msg === 'admin-not-configured' ? 503 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
