// Kaya Plus · auto top-up generator (client, on parent page-load).
//
// The "never run out" seam (approved 2026-06-06). Mirrors
// runUtilityBillGenerator exactly: for each depleting ('down') meter with
// auto top-up ON + a minimum-units threshold, if the latest reading is BELOW
// the threshold and no auto-request is already outstanding, Kaya creates a
// pending-approval utility top-up request (amount = the meter's last top-up,
// or a set amount) and — when the meter's alert toggle is on — notifies the
// parents (in-app + push) and emails them. You still approve before any money
// moves; this just removes the "helper forgot to remind" gap.
//
//   • runs once on parent page-load (no server cron) — same as the bill gen
//   • idempotent via `autoTopUpPendingRequestId` on the meter (one open
//     auto-request at a time; cleared when the balance recovers ≥ threshold)
//   • fire-and-forget — a failure never blocks the page

import {
  collection, getDocs, query, where, orderBy, limit,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import { listMeters, updateMeter, type UtilityMeter } from './utilityMeters';
import { getLatestReading } from './pulse';
import { createDraftRequest, type PurchaseRequest, type PurchaseRequestItem } from './purchase';
import { getFamilyMembers } from './firestore';
import { notifyPurchaseApprovalRequested, notifyUtilityBillDue } from './notify';
import { formatCents } from '@/components/pantry/format';

export interface AutoTopupRun {
  created: { meterId: string; label: string; requestId: string; amountCents: number }[];
  cleared: string[];   // meters whose pending guard was cleared (recovered)
}

const meterDirection = (m: UtilityMeter): 'up' | 'down' =>
  m.direction ?? (m.type === 'water' ? 'up' : 'down');

/** The most recent utility top-up amount for a meter (cents), or null. */
function lastAmountForMeter(reqs: PurchaseRequest[], meterId: string): number | null {
  for (const r of reqs) {
    if (r.meterId !== meterId) continue;
    const cents = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
    if (cents > 0) return cents;
  }
  return null;
}

/** Resolve the auto-request amount: 'fixed' → set amount; 'last' → most recent
 *  top-up for this meter, falling back to the set amount then the estimate. */
function resolveAmountCents(m: UtilityMeter, lastCents: number | null): number {
  if (m.autoTopUpSource === 'fixed') return m.autoTopUpAmountCents || m.estimatedCents || 0;
  return lastCents ?? m.autoTopUpAmountCents ?? m.estimatedCents ?? 0;
}

export async function runAutoTopupGenerator(
  familyId: string,
  byUid: string,
  opts: { currency?: string; appUrl?: string } = {},
): Promise<AutoTopupRun> {
  const run: AutoTopupRun = { created: [], cleared: [] };
  if (isGuestActive() || !familyId || !byUid) return run;

  const meters = await listMeters(familyId);
  const candidates = meters.filter(
    (m) => m.active && m.autoTopUp && (m.minUnitsThreshold ?? 0) > 0 && meterDirection(m) === 'down',
  );
  if (candidates.length === 0) return run;

  // One-shot of recent utility requests — used to size 'last' top-ups + double
  // as a freshness check. Module-only filter (no composite index needed).
  let recentReqs: PurchaseRequest[] = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'families', familyId, 'purchaseRequests'),
      where('module', '==', 'utility'),
      orderBy('createdAt', 'desc'),
      limit(60),
    ));
    recentReqs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseRequest));
  } catch { /* non-fatal — 'last' falls back to set amount / estimate */ }

  // Recipients fetched lazily + cached — only when we actually fire an alert.
  let cachedRecipients: { uids: string[]; emails: string[] } | null = null;
  const getRecipients = async (): Promise<{ uids: string[]; emails: string[] }> => {
    if (cachedRecipients) return cachedRecipients;
    try {
      const members = await getFamilyMembers(familyId);
      cachedRecipients = {
        uids: members.filter((m) => m.role === 'parent').map((m) => m.uid),
        emails: members.filter((m) => m.role === 'parent' && m.email).map((m) => m.email as string),
      };
    } catch { cachedRecipients = { uids: [], emails: [] }; }
    return cachedRecipients;
  };

  for (const m of candidates) {
    const reading = await getLatestReading(familyId, m.id).catch(() => null);
    const bal = reading && Number.isFinite(reading.value) ? reading.value : null;
    if (bal == null) continue;
    const threshold = m.minUnitsThreshold!;

    // Recovered above the threshold → clear the guard so it can fire again next time.
    if (bal >= threshold) {
      if (m.autoTopUpPendingRequestId) {
        await updateMeter(familyId, m.id, { autoTopUpPendingRequestId: '' }).catch(() => {});
        run.cleared.push(m.id);
      }
      continue;
    }

    // Below threshold — but one auto-request is already outstanding → don't nag.
    if (m.autoTopUpPendingRequestId) continue;

    const amountCents = resolveAmountCents(m, lastAmountForMeter(recentReqs, m.id));
    if (amountCents <= 0) continue; // can't size it (no last / set / estimate)

    try {
      const item: PurchaseRequestItem = {
        id: `${Date.now().toString(36)}-topup`, name: m.label || 'Top-up',
        category: 'other', qty: 1, unit: 'x', estimatedCents: amountCents,
      };
      const requestId = await createDraftRequest(familyId, {
        module: 'utility', createdBy: byUid, createdByRole: 'parent',
        initialStatus: 'pending_approval', generatedBy: 'system',
        items: [item], context: `${m.label} top-up`, meterId: m.id,
      });
      await updateMeter(familyId, m.id, { autoTopUpPendingRequestId: requestId }).catch(() => {});
      run.created.push({ meterId: m.id, label: m.label, requestId, amountCents });

      if (m.autoTopUpAlert !== false) {
        const { uids, emails } = await getRecipients();
        const estLabel = formatCents(amountCents, opts.currency || 'USD');
        if (uids.length > 0) {
          void notifyPurchaseApprovalRequested({
            familyId, requestId, requesterName: 'Auto top-up',
            requestName: `${m.label} top-up`, estimatedLabel: estLabel,
            module: 'utility', parentUids: uids,
          }).catch(() => {});
        }
        if (emails.length > 0) {
          void notifyUtilityBillDue({
            to: emails,
            billName: `${m.label} — auto top-up`,
            amountFormatted: estLabel,
            accountRef: m.providerRef || undefined,
            dueLabel: `low · ${bal}${m.unit ? ` ${m.unit}` : ''} left (below ${threshold})`,
            requestUrl: `${opts.appUrl || ''}/pantry/purchase/${requestId}`,
          });
        }
      }
    } catch { /* best-effort — next page-load retries */ }
  }

  return run;
}
