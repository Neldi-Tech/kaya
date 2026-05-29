// Server-only Kaya Coins engine — the ONLY writer of family.kayaCoins.
//
// Every balance change goes through applyKcLedger(), which mutates the
// running balance and appends an audit entry to
// families/{familyId}/kcLedger atomically (one transaction). Clients can
// never write kayaCoins (firestore.rules blocks it) — the Admin SDK used
// here bypasses rules, so this file is the trust boundary for a currency
// with real $ value.
//
// NEVER import this from a client component — it pulls in firebase-admin.

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { DEFAULT_TIERS, type SubscriptionTierId, type TierConfig } from './tiers';
import {
  computeReferralAccrualKc,
  kcCostForTierGrant,
  type KcLedgerEntry,
  type KcLedgerKind,
} from './referral';

// ── Core atomic mutation ─────────────────────────────────────────────

interface LedgerContext {
  tierId?: SubscriptionTierId | null;
  durationMonths?: number | null;
  refFamilyId?: string | null;
  paidValueCents?: number | null;
}

interface ApplyArgs {
  kind: KcLedgerKind;
  /** Signed delta: positive credits, negative debits. */
  amount: number;
  reason: string;
  createdBy: string; // operator uid, or 'system' for auto-accrual
  createdByEmail?: string | null;
  context?: LedgerContext;
  /** Fixed ledger doc id for idempotency (e.g. `pay_<paymentId>`). When
   *  the doc already exists the call is a no-op and reports the existing
   *  balance. Omit for ordinary grants/redemptions (auto id). */
  entryId?: string;
  /** Extra patch merged into the family doc in the SAME transaction —
   *  used by tier redemption to flip tierId + subscription.expiresAt
   *  atomically with the debit. Dotted keys are FieldPaths. */
  familyPatch?: Record<string, unknown>;
}

export type KcResult =
  | { ok: true; balanceAfter: number; entryId: string; idempotent?: boolean }
  | { ok: false; error: string };

/** Adjust family.kayaCoins by `args.amount`, append a kcLedger entry, and
 *  optionally patch the family doc — all in one transaction. Refuses to
 *  drive the balance negative ('insufficient-kc'). Idempotent when
 *  `entryId` is supplied. */
export async function applyKcLedger(db: Firestore, familyId: string, args: ApplyArgs): Promise<KcResult> {
  if (!familyId) return { ok: false, error: 'no-family-id' };
  if (!Number.isFinite(args.amount) || args.amount === 0) return { ok: false, error: 'bad-amount' };

  const famRef = db.collection('families').doc(familyId);
  const ledgerRef = args.entryId
    ? famRef.collection('kcLedger').doc(args.entryId)
    : famRef.collection('kcLedger').doc();

  return db.runTransaction<KcResult>(async (tx) => {
    // All reads first (transaction rule).
    const famSnap = await tx.get(famRef);
    if (!famSnap.exists) return { ok: false, error: 'family-not-found' };

    if (args.entryId) {
      const existing = await tx.get(ledgerRef);
      if (existing.exists) {
        const prior = existing.data() as { balanceAfter?: number };
        return { ok: true, balanceAfter: Number(prior.balanceAfter ?? 0), entryId: ledgerRef.id, idempotent: true };
      }
    }

    const current = Number((famSnap.data() as { kayaCoins?: number }).kayaCoins ?? 0);
    // round to 2dp to keep fractional accruals from drifting on floats.
    const next = Math.round((current + args.amount) * 100) / 100;
    if (next < 0) return { ok: false, error: 'insufficient-kc' };

    const stamp = FieldValue.serverTimestamp();
    tx.set(ledgerRef, {
      kind: args.kind,
      amount: args.amount,
      balanceAfter: next,
      reason: args.reason,
      createdBy: args.createdBy,
      createdByEmail: args.createdByEmail ?? null,
      createdAt: stamp,
      tierId: args.context?.tierId ?? null,
      durationMonths: args.context?.durationMonths ?? null,
      refFamilyId: args.context?.refFamilyId ?? null,
      paidValueCents: args.context?.paidValueCents ?? null,
    });

    tx.update(famRef, { kayaCoins: next, ...(args.familyPatch ?? {}) });
    return { ok: true, balanceAfter: next, entryId: ledgerRef.id };
  });
}

// ── Manual grant (operator action) ───────────────────────────────────

/** Credit KC to a family from the Admin portal. `amount` must be a
 *  positive number. */
export async function grantKc(
  db: Firestore,
  args: { familyId: string; amount: number; reason: string; operatorUid: string; operatorEmail: string | null },
): Promise<KcResult> {
  if (!Number.isFinite(args.amount) || args.amount <= 0) return { ok: false, error: 'bad-amount' };
  // Clamp to 2dp; manual grants are usually whole but tolerate fractions.
  const amount = Math.round(args.amount * 100) / 100;
  return applyKcLedger(db, args.familyId, {
    kind: 'grant',
    amount,
    reason: args.reason?.trim() || 'Manual grant',
    createdBy: args.operatorUid,
    createdByEmail: args.operatorEmail,
  });
}

// ── KC → tier redemption (operator action) ───────────────────────────

/** Adds `months` calendar months to `from`, preserving the day-of-month
 *  where possible (clamps on shorter months). */
function addCalendarMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const targetMonth = d.getMonth() + months;
  const result = new Date(d.getFullYear(), targetMonth, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  // If the day overflowed (e.g. Jan 31 + 1mo), JS rolls into the next
  // month — pull back to the last day of the intended month.
  if (result.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    result.setDate(0);
  }
  return result;
}

/** Spend KC to grant a family `months` of `tierId`. Computes the cost
 *  from the tier's monthly price (defaults overridable via `tiers`),
 *  debits the balance, writes the ledger entry, and flips the family's
 *  tier + subscription.expiresAt — all atomically. Tiers only for now
 *  (Nest is free → rejected; addons are not part of a KC grant). */
export async function redeemKcForTier(
  db: Firestore,
  args: {
    familyId: string;
    tierId: SubscriptionTierId;
    months: number;
    operatorUid: string;
    operatorEmail: string | null;
    tiers?: Record<SubscriptionTierId, TierConfig>;
  },
): Promise<KcResult & { cost?: number }> {
  if (args.tierId !== 'home' && args.tierId !== 'castle') return { ok: false, error: 'bad-tier' };
  if (!Number.isInteger(args.months) || args.months <= 0) return { ok: false, error: 'bad-duration' };

  const cfg = (args.tiers ?? DEFAULT_TIERS)[args.tierId];
  const cost = kcCostForTierGrant(cfg.priceMonthly, args.months);
  if (cost <= 0) return { ok: false, error: 'zero-cost' };

  const expiresAt = addCalendarMonths(new Date(), args.months);
  const familyPatch: Record<string, unknown> = {
    tierId: args.tierId,
    'subscription.addons': [],
    'subscription.expiresAt': expiresAt,
    'subscription.redeemedAt': FieldValue.serverTimestamp(),
    'subscription.redeemedVia': 'kaya-coins',
    'subscription.redeemedCodeId': FieldValue.delete(),
  };

  const monthLabel = `${args.months} month${args.months === 1 ? '' : 's'}`;
  const res = await applyKcLedger(db, args.familyId, {
    kind: 'redemption',
    amount: -cost,
    reason: `Redeemed ${cost} KC → ${cfg.name} · ${monthLabel}`,
    createdBy: args.operatorUid,
    createdByEmail: args.operatorEmail,
    context: { tierId: args.tierId, durationMonths: args.months },
    familyPatch,
  });
  return res.ok ? { ...res, cost } : res;
}

// ── Auto-accrual SEAM (future billing webhook) ───────────────────────

/** Credit a referrer 10% of a referred family's payment as KC. This is
 *  the wire-up point for the future billing webhook — it is NOT called
 *  by anything today because closed beta has no payment events (upgrades
 *  are manual Tier Codes). Idempotent on `paymentId` so a webhook retry
 *  won't double-credit. Wire this into the payment-succeeded handler
 *  when billing lands. */
export async function recordReferredPayment(
  db: Firestore,
  args: { referrerFamilyId: string; referredFamilyId: string; paidValueCents: number; paymentId: string },
): Promise<KcResult> {
  const kc = computeReferralAccrualKc(args.paidValueCents);
  if (kc <= 0) return { ok: false, error: 'zero-accrual' };
  return applyKcLedger(db, args.referrerFamilyId, {
    kind: 'accrual',
    amount: kc,
    reason: `Referral reward · 10% of $${(args.paidValueCents / 100).toFixed(2)}`,
    createdBy: 'system',
    createdByEmail: null,
    context: { refFamilyId: args.referredFamilyId, paidValueCents: args.paidValueCents },
    entryId: `pay_${args.paymentId}`,
  });
}

// ── Founding serial assignment (apex-badge SEAM) ─────────────────────

/** Stamp the next FF-### serial on a family that has EARNED the apex
 *  Founding Family badge (1,000 referrals). Idempotent — a family keeps
 *  its first number forever. Pulls a monotonic sequence from
 *  meta/global.foundingFamilyCount, mirroring how familyCount drives the
 *  Charter serials. The caller decides eligibility (1,000 effective
 *  referrals); this just allocates the next number atomically. No family
 *  qualifies in closed beta yet, so this is a documented SEAM — wire it
 *  into the badge-earned hook (or a one-off backfill) when the day comes. */
export async function assignFoundingNumber(
  db: Firestore,
  familyId: string,
): Promise<{ ok: true; foundingNumber: number; idempotent?: boolean } | { ok: false; error: string }> {
  if (!familyId) return { ok: false, error: 'no-family-id' };
  const famRef = db.collection('families').doc(familyId);
  const metaRef = db.collection('meta').doc('global');
  return db.runTransaction(async (tx) => {
    const famSnap = await tx.get(famRef);
    if (!famSnap.exists) return { ok: false as const, error: 'family-not-found' };
    const existing = (famSnap.data() as { foundingNumber?: number }).foundingNumber;
    if (typeof existing === 'number' && existing > 0) {
      return { ok: true as const, foundingNumber: existing, idempotent: true };
    }
    const metaSnap = await tx.get(metaRef);
    const prev = (metaSnap.exists ? (metaSnap.data() as { foundingFamilyCount?: number }).foundingFamilyCount : 0) || 0;
    const next = prev + 1;
    tx.set(metaRef, { foundingFamilyCount: next }, { merge: true });
    tx.update(famRef, { foundingNumber: next });
    return { ok: true as const, foundingNumber: next };
  });
}

// ── Read helper (Admin portal) ───────────────────────────────────────

/** Most-recent ledger entries for a family, newest first. */
export async function listKcLedger(db: Firestore, familyId: string, max = 50): Promise<KcLedgerEntry[]> {
  const snap = await db
    .collection('families').doc(familyId)
    .collection('kcLedger')
    .orderBy('createdAt', 'desc')
    .limit(max)
    .get();
  return snap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    const createdAtMs = x.createdAt && typeof (x.createdAt as { toMillis?: () => number }).toMillis === 'function'
      ? (x.createdAt as { toMillis: () => number }).toMillis()
      : 0;
    return {
      id: d.id,
      kind: (x.kind as KcLedgerEntry['kind']) ?? 'adjustment',
      amount: Number(x.amount ?? 0),
      balanceAfter: Number(x.balanceAfter ?? 0),
      reason: String(x.reason ?? ''),
      createdAtMs,
      createdByEmail: (x.createdByEmail as string | null) ?? null,
      tierId: (x.tierId as SubscriptionTierId | null) ?? null,
      durationMonths: typeof x.durationMonths === 'number' ? x.durationMonths : null,
      refFamilyId: (x.refFamilyId as string | null) ?? null,
      paidValueCents: typeof x.paidValueCents === 'number' ? x.paidValueCents : null,
    };
  });
}
