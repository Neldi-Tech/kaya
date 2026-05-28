// PATCH /api/admin/families/[familyId] — operator-only.
// Body: { tierId?, addons?, isFoundingFamily? }
//
// Writes to families/{familyId} with a narrow whitelist so operators
// can't accidentally overwrite unrelated family state from this page.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { DEFAULT_ADDONS } from '@/lib/tiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIER_IDS = new Set(['nest', 'home', 'castle']);
const VALID_ADDON_IDS = new Set(DEFAULT_ADDONS.map((a) => a.id));

export async function PATCH(req: NextRequest, ctx: { params: { familyId: string } }) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });
  const { db } = r;
  const familyId = ctx.params.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family-id' }, { status: 400 });

  let body: {
    tierId?: 'nest' | 'home' | 'castle';
    addons?: string[];
    isFoundingFamily?: boolean;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const patch: Record<string, unknown> = {};

  if (body.tierId !== undefined) {
    if (!TIER_IDS.has(body.tierId)) return NextResponse.json({ error: 'bad-tier' }, { status: 400 });
    patch.tierId = body.tierId;
  }

  if (body.addons !== undefined) {
    if (!Array.isArray(body.addons)) return NextResponse.json({ error: 'bad-addons' }, { status: 400 });
    // Whitelist against DEFAULT_ADDONS so typos can't be stored.
    const filtered = body.addons.filter((a) => typeof a === 'string' && VALID_ADDON_IDS.has(a));
    patch['subscription.addons'] = filtered;
  }

  if (body.isFoundingFamily !== undefined) {
    patch.isFoundingFamily = body.isFoundingFamily === true;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'empty-patch' }, { status: 400 });
  }

  await db.collection('families').doc(familyId).update(patch);
  return NextResponse.json({ ok: true });
}
