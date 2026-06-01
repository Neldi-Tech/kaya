// POST /api/wealth/vault/unlock — verify a TOTP (or one-time recovery code)
// to unlock the vault. Body: { code }. Also the step-up primitive future
// sensitive actions (bank-account reveal) reuse.

import { NextRequest, NextResponse } from 'next/server';
import { verifyBearer, verifyUnlock } from '@/lib/wealthVaultServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const who = await verifyBearer(req);
  if (!who) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let code = '';
  try { code = String(((await req.json()) as { code?: string }).code || ''); } catch { /* empty */ }
  if (!code) return NextResponse.json({ ok: false, error: 'missing-code' }, { status: 400 });
  try {
    const ok = await verifyUnlock(who.uid, code);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: 'unlock-failed' }, { status: 500 });
  }
}
