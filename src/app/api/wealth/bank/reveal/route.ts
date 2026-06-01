// POST /api/wealth/bank/reveal — reveal a full account number after a fresh
// 2FA step-up. Body: { code, acctId }. The number is returned once, never
// stored client-side.

import { NextRequest, NextResponse } from 'next/server';
import { verifyBearer } from '@/lib/wealthVaultServer';
import { revealBankAccount } from '@/lib/bankVaultServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const who = await verifyBearer(req);
  if (!who) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let b: { code?: string; acctId?: string };
  try { b = (await req.json()) as typeof b; } catch { b = {}; }
  if (!b.code || !b.acctId) return NextResponse.json({ ok: false, error: 'missing-fields' }, { status: 400 });
  try {
    return NextResponse.json(await revealBankAccount(who.uid, b.acctId, b.code));
  } catch {
    return NextResponse.json({ ok: false, error: 'reveal-failed' }, { status: 500 });
  }
}
