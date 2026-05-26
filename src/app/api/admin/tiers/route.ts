// GET   /api/admin/tiers — any signed-in user can read the resolved
//                          tier configs (so /subscription + module gates
//                          can render).
// PATCH /api/admin/tiers — operator-only. Body: { tierId, patch }.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/sparksServer';
import { loadAllTiers, saveTierPatch, sanitiseModuleIds, type TierOverrides } from '@/lib/tiersServer';
import type { SubscriptionTierId, TierConfig } from '@/lib/tiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIER_IDS = new Set<SubscriptionTierId>(['nest', 'home', 'castle']);

export async function GET(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const tiers = await loadAllTiers(r.db);
  return NextResponse.json({ tiers });
}

export async function PATCH(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });

  let body: { tierId?: string; patch?: Partial<TierConfig> };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const tierId = body.tierId as SubscriptionTierId;
  if (!TIER_IDS.has(tierId)) return NextResponse.json({ error: 'bad-tier' }, { status: 400 });
  const raw = body.patch ?? {};

  // Whitelist + coerce. Only well-known keys are written; numeric caps
  // accept null (= unlimited) explicitly. Module arrays are filtered
  // against MODULE_REGISTRY so a typo can't get stored.
  const patch: Partial<TierConfig> = {};
  if (Number.isFinite(raw.priceMonthly))            patch.priceMonthly = Math.max(0, Math.floor(raw.priceMonthly as number));
  if (Number.isFinite(raw.priceYearly))             patch.priceYearly = Math.max(0, Math.floor(raw.priceYearly as number));
  if (raw.memberLimit === null || Number.isFinite(raw.memberLimit))           patch.memberLimit = raw.memberLimit === null ? null : Math.max(0, Math.floor(raw.memberLimit as number));
  if (raw.helperLimit === null || Number.isFinite(raw.helperLimit))           patch.helperLimit = raw.helperLimit === null ? null : Math.max(0, Math.floor(raw.helperLimit as number));
  if (raw.householdLimit === null || Number.isFinite(raw.householdLimit))     patch.householdLimit = raw.householdLimit === null ? null : Math.max(0, Math.floor(raw.householdLimit as number));
  if (raw.historyRetentionDays === null || Number.isFinite(raw.historyRetentionDays)) patch.historyRetentionDays = raw.historyRetentionDays === null ? null : Math.max(0, Math.floor(raw.historyRetentionDays as number));
  if (raw.modules)      patch.modules      = sanitiseModuleIds(raw.modules);
  if (raw.addonModules) patch.addonModules = sanitiseModuleIds(raw.addonModules);

  await saveTierPatch(r.db, tierId, patch);
  const tiers = await loadAllTiers(r.db);
  return NextResponse.json({ tiers });
}
