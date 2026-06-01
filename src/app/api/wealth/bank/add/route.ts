// POST /api/wealth/bank/add — add a bank account (encrypted) after a fresh
// 2FA step-up. Body: { code, bankName, type, currency, balanceCents?, fullNumber }.

import { NextRequest, NextResponse } from 'next/server';
import { verifyBearer } from '@/lib/wealthVaultServer';
import { addBankAccount, type BankAccountType } from '@/lib/bankVaultServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const who = await verifyBearer(req);
  if (!who) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let b: { code?: string; bankName?: string; type?: BankAccountType; currency?: string; balanceCents?: number; fullNumber?: string };
  try { b = (await req.json()) as typeof b; } catch { b = {}; }
  if (!b.code || !b.bankName || !b.fullNumber || !b.type || !b.currency) {
    return NextResponse.json({ ok: false, error: 'missing-fields' }, { status: 400 });
  }
  try {
    const r = await addBankAccount(
      who.uid,
      { bankName: b.bankName, type: b.type, currency: b.currency, balanceCents: b.balanceCents ?? null, fullNumber: b.fullNumber },
      b.code,
    );
    return NextResponse.json(r);
  } catch {
    return NextResponse.json({ ok: false, error: 'add-failed' }, { status: 500 });
  }
}
