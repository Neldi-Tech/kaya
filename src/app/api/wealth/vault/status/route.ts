// GET /api/wealth/vault/status — is the caller's vault 2FA configured + enrolled?
// Drives the lock UI: enroll flow vs unlock flow vs legacy session gate.

import { NextRequest, NextResponse } from 'next/server';
import { verifyBearer, getVaultStatus } from '@/lib/wealthVaultServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await verifyBearer(req);
  if (!who) return NextResponse.json({ cryptoConfigured: false, enrolled: false }, { status: 200 });
  try {
    return NextResponse.json(await getVaultStatus(who.uid));
  } catch {
    return NextResponse.json({ cryptoConfigured: false, enrolled: false }, { status: 200 });
  }
}
