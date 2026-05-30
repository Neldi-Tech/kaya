// GET   /api/admin/settings — operator-only. Returns the admin settings
//                             (defaults merged over the /config/admin doc).
// PATCH /api/admin/settings — operator-only. Body: Partial<AdminSettings>.
//
// Mirrors /api/admin/branding. Admin SDK access bypasses Firestore rules,
// so /config/admin needs no rules entry.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { DEFAULT_ADMIN_SETTINGS, type AdminSettings } from '@/lib/adminSettings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PATH = ['config', 'admin'] as const;

async function readSettings(db: FirebaseFirestore.Firestore): Promise<AdminSettings> {
  const snap = await db.collection(ADMIN_PATH[0]).doc(ADMIN_PATH[1]).get();
  return {
    ...DEFAULT_ADMIN_SETTINGS,
    ...((snap.exists ? snap.data() : {}) as Partial<AdminSettings>),
  };
}

export async function GET(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });
  return NextResponse.json({ settings: await readSettings(r.db) });
}

export async function PATCH(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });

  let body: Partial<AdminSettings>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const patch: Partial<AdminSettings> = {};
  if (Number.isFinite(body.activeWindowDays)) {
    // Clamp to a sane 1–365 window so a typo can't break the filter.
    patch.activeWindowDays = Math.min(365, Math.max(1, Math.round(body.activeWindowDays as number)));
  }
  if (body.addonBillingMode === 'request' || body.addonBillingMode === 'stripe' || body.addonBillingMode === 'auto') {
    patch.addonBillingMode = body.addonBillingMode;
  }
  if (Number.isFinite(body.addonAutoSwitchMonths)) {
    patch.addonAutoSwitchMonths = Math.min(24, Math.max(1, Math.round(body.addonAutoSwitchMonths as number)));
  }

  await r.db.collection(ADMIN_PATH[0]).doc(ADMIN_PATH[1]).set(patch, { merge: true });
  return NextResponse.json({ settings: await readSettings(r.db) });
}
