// GET   /api/admin/branding — any signed-in user can read (the public
//                              hook subscribes via the client SDK; this
//                              endpoint is for server-side use).
// PATCH /api/admin/branding — operator-only. Body: Partial<BrandingConfig>.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { DEFAULT_BRANDING, type BrandingConfig } from '@/lib/branding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BRANDING_PATH = ['config', 'branding'] as const;

export async function GET(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const snap = await r.db.collection(BRANDING_PATH[0]).doc(BRANDING_PATH[1]).get();
  const branding: BrandingConfig = {
    ...DEFAULT_BRANDING,
    ...((snap.exists ? snap.data() : {}) as Partial<BrandingConfig>),
  };
  return NextResponse.json({ branding });
}

export async function PATCH(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });

  let body: Partial<BrandingConfig>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  // Narrow whitelist + length caps so a typo can't store an essay.
  const patch: Partial<BrandingConfig> = {};
  if (typeof body.wordmark === 'string')      patch.wordmark      = body.wordmark.trim().slice(0, 30) || DEFAULT_BRANDING.wordmark;
  if (typeof body.bannerEnabled === 'boolean') patch.bannerEnabled = body.bannerEnabled;
  if (typeof body.bannerText === 'string')    patch.bannerText    = body.bannerText.trim().slice(0, 120);
  if (typeof body.bannerEmoji === 'string')   patch.bannerEmoji   = body.bannerEmoji.trim().slice(0, 4);

  const ref = r.db.collection(BRANDING_PATH[0]).doc(BRANDING_PATH[1]);
  await ref.set(patch, { merge: true });

  const snap = await ref.get();
  const branding: BrandingConfig = {
    ...DEFAULT_BRANDING,
    ...((snap.exists ? snap.data() : {}) as Partial<BrandingConfig>),
  };
  return NextResponse.json({ branding });
}
