// GET   /api/sparks/settings — any signed-in user can read (drives client UI).
// PATCH /api/sparks/settings — operator-only.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth, loadSparksSettings, saveSparksSettings } from '@/lib/sparksServer';
import { DEFAULT_SPARKS_SETTINGS, type SparksSettings } from '@/lib/sparks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db } = r;
  const settings = await loadSparksSettings(db);
  return NextResponse.json({ settings });
}

export async function PATCH(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx } = r;
  if (!ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });

  let body: Partial<SparksSettings>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  // Coerce + bound each field — only known keys are persisted, and number
  // fields get sane min/max so a typo can't break the public UI.
  const patch: Partial<SparksSettings> = {};
  if (typeof body.showRoadmap === 'boolean')          patch.showRoadmap = body.showRoadmap;
  if (typeof body.allowAnonymous === 'boolean')       patch.allowAnonymous = body.allowAnonymous;
  if (typeof body.kidsDefaultAnonymous === 'boolean') patch.kidsDefaultAnonymous = body.kidsDefaultAnonymous;
  if (typeof body.autoPublish === 'boolean')          patch.autoPublish = body.autoPublish;
  if (typeof body.enableSparkBadge === 'boolean')     patch.enableSparkBadge = body.enableSparkBadge;
  if (typeof body.anonymousEarnsCoins === 'boolean')  patch.anonymousEarnsCoins = body.anonymousEarnsCoins;
  if (typeof body.showStoriesCategory === 'boolean')  patch.showStoriesCategory = body.showStoriesCategory;
  if (Number.isFinite(body.honeyCoinsPerShippedIdea)) {
    patch.honeyCoinsPerShippedIdea = Math.max(0, Math.min(10_000, Math.floor(body.honeyCoinsPerShippedIdea as number)));
  }
  if (Number.isFinite(body.founderCoffeeTopN)) {
    patch.founderCoffeeTopN = Math.max(0, Math.min(20, Math.floor(body.founderCoffeeTopN as number)));
  }

  const settings = await saveSparksSettings(db, { ...DEFAULT_SPARKS_SETTINGS, ...patch });
  return NextResponse.json({ settings });
}
