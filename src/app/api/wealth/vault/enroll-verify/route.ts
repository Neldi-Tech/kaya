// POST /api/wealth/vault/enroll-verify — confirm enrollment with a live code.
// Body: { code }. On success the pending secret becomes the active vault key.

import { NextRequest, NextResponse } from 'next/server';
import { verifyBearer, confirmEnrollment } from '@/lib/wealthVaultServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const who = await verifyBearer(req);
  if (!who) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let code = '';
  try { code = String(((await req.json()) as { code?: string }).code || ''); } catch { /* empty */ }
  if (!code) return NextResponse.json({ ok: false, error: 'missing-code' }, { status: 400 });
  try {
    const ok = await confirmEnrollment(who.uid, code);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: 'verify-failed' }, { status: 500 });
  }
}
