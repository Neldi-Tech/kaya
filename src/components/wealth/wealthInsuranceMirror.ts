// Kaya Wealth · insurance mirror (PR4 · 2026-06-01).
//
// The funnel, down only (Non-Negotiable #8 / Concept Note §7): an insured
// asset's premium + renewal mirror DOWN to Household → Subscriptions as a
// read-only entry. Household never writes back up; Wealth stays the single
// source of truth. The subscription is tagged sourceModule='wealth' +
// linkedWealthAssetId so the Household side can show it as Wealth-managed.
//
// Idempotent: creates the linked subscription the first time, updates it in
// place when the premium/renewal change, and cancels it when insurance is
// removed. Best-effort — a mirror failure never blocks the asset save (the
// asset is already written; re-saving retries).

import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { isGuestActive } from '@/lib/mockFamily';
import { resolveFxRate } from '@/lib/fx';
import { createSubscription, updateSubscription } from '@/lib/subscriptions';
import { buildInsuranceMirror, type WealthAsset, type WealthAuthor } from '@/lib/wealth';

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoToTs(iso: string): Timestamp {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Timestamp.now();
  return Timestamp.fromDate(new Date(+m[1], +m[2] - 1, +m[3]));
}

/** Reconcile the Household subscription that mirrors this asset's insurance.
 *  Pass the just-saved asset (with its id + current insurance + any existing
 *  `mirroredSubscriptionId`). No-op when there's nothing to mirror and no
 *  prior mirror exists. */
export async function syncInsuranceMirror(params: {
  familyId: string;
  asset: WealthAsset;
  householdCurrency: string;
  author: WealthAuthor;
}): Promise<void> {
  if (isGuestActive()) return;
  const { familyId, asset, householdCurrency, author } = params;
  const assetRef = doc(db, 'families', familyId, 'wealth_assets', asset.id);
  const existingSubId = asset.mirroredSubscriptionId || null;
  const payload = buildInsuranceMirror(asset); // null unless insured + premium + renewal

  // Insurance absent / removed → cancel any existing mirror + clear the link.
  if (!payload) {
    if (existingSubId) {
      try {
        await updateSubscription(familyId, existingSubId, {
          status: 'cancelled', endedOn: Timestamp.now(), archivedAt: Timestamp.now(),
        });
      } catch { /* best-effort */ }
      try { await updateDoc(assetRef, { mirroredSubscriptionId: null }); } catch { /* best-effort */ }
    }
    return;
  }

  const fxRate = (await resolveFxRate(payload.currencyOriginal, householdCurrency)) ?? 1;
  const amountHousehold = Math.round(payload.amountOriginalCents * fxRate);

  // Existing mirror → update in place (premium / renewal / re-activate).
  if (existingSubId) {
    try {
      await updateSubscription(familyId, existingSubId, {
        name: payload.name,
        amountOriginal: payload.amountOriginalCents,
        currencyOriginal: payload.currencyOriginal,
        fxRate,
        amountHousehold,
        monthlyEquivalent: Math.round(amountHousehold / 12),
        nextBillingDate: isoToTs(payload.nextBillingDateIso),
        status: 'active',
        archivedAt: null,
      });
    } catch { /* best-effort */ }
    return;
  }

  // First time → create the linked subscription, then store its id on the asset.
  const clientToken = newId();
  try {
    await createSubscription({
      familyId,
      name: payload.name,
      category: payload.category,
      subCategory: payload.subCategory,
      billingMode: 'manual',
      amountOriginalCents: payload.amountOriginalCents,
      currencyOriginal: payload.currencyOriginal,
      fxRate,
      frequency: payload.frequency,
      nextBillingDateIso: payload.nextBillingDateIso,
      startedOnIso: todayIso(),
      accountHolderUid: asset.ownerId || author.uid,
      createdByUid: author.uid,
      clientToken,
      sourceModule: 'wealth',
      linkedWealthAssetId: asset.id,
    });
    await updateDoc(assetRef, { mirroredSubscriptionId: clientToken });
  } catch { /* best-effort — re-saving the asset retries the mirror */ }
}
