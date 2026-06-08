// Household · Subscriptions data layer.
//
// One collection: families/{f}/subscriptions/{subId} — every recurring
// or one-off subscription the family tracks (Netflix, gym, land rent…).
// Two billing modes — 'auto' (card on file, passive tracking) and
// 'manual' (post-due check + reminders). Property & Land subs are
// mirrored from Kaya Wealth (sourceModule === 'wealth') and edited
// there; everything else originates in Household.
//
// Schema docs:
//   Kaya Contributions and Subscrition in Budgets/
//     Kaya-Subscriptions-Contributions_Schema_2026-05-27.md
//
// P1 ships types + read helpers. Add/edit, receipts, cycles, reminders
// + the spend-ledger writer land in P2/P3/P4.

import {
  collection, doc, getDoc, getDocs, query, orderBy, limit as qlimit,
  Timestamp, onSnapshot, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { isGuestActive } from './mockFamily';

// ── Cycle subcollection types ───────────────────────────────────────
// One doc per billing cycle of a Subscription. Created on Add by
// /api/subscriptions/create (status='upcoming'); flipped to 'paid' by
// the post-due check + /api/subscriptions/cycle/close which also writes
// the spend_ledger entry. 'overdue' is set by the cycle-advancer cron
// when dueDate passes without a payment.

export type SubscriptionCycleStatus = 'upcoming' | 'due' | 'paid' | 'overdue' | 'skipped';

export interface SubscriptionCycle {
  id: string;
  dueDate: Timestamp;
  amountDue: number;
  amountPaid: number | null;
  paidOn: Timestamp | null;
  paymentMethodId: string;
  receiptIds: string[];
  status: SubscriptionCycleStatus;
  remindersSent: { daysBefore: number; sentAt: Timestamp; channel: string }[];
  postDueCheckResult: 'paid' | 'snoozed' | 'issue' | null;
}

export type SubscriptionCategory =
  | 'mobile_apps' | 'memberships' | 'media' | 'utilities_sub'
  | 'property_land' | 'vehicle' | 'education' | 'professional' | 'other';

export type SubscriptionStatus       = 'active' | 'trial' | 'paused' | 'cancelled';
export type SubscriptionBillingMode  = 'auto' | 'manual';
export type SubscriptionFrequency    =
  | 'daily' | 'weekly' | 'monthly' | 'quarterly'
  | 'semi_annual' | 'annual' | 'one_off' | 'custom';
export type SubscriptionPlatform     = 'ios' | 'android' | 'web' | 'other';
export type SubscriptionSourceModule = 'household' | 'wealth';

export interface Subscription {
  id: string;
  name: string;
  catalogueRef: string | null;

  category: SubscriptionCategory;
  subCategory: string;
  platform: SubscriptionPlatform | null;

  billingMode: SubscriptionBillingMode;
  status: SubscriptionStatus;
  trialEndsOn: Timestamp | null;

  // money — every amount stored in CENTS of the named currency, matching
  // the convention in formatCents() and the rest of Kaya.
  amountOriginal: number;
  currencyOriginal: string;        // ISO 4217 ('TZS', 'USD', 'KES'…)
  fxRate: number;                  // locked at entry; original × fxRate = household
  amountHousehold: number;
  monthlyEquivalent: number;

  // frequency
  frequency: SubscriptionFrequency;
  customMonths: number | null;
  nextBillingDate: Timestamp;
  startedOn: Timestamp;
  endedOn: Timestamp | null;
  // When a sub is put On hold with a chosen return date, the cron flips it
  // back to 'active' on/after this date. null = "hold until I resume". Optional
  // so legacy docs (written before this field existed) read as undefined→null.
  autoResumeOn?: Timestamp | null;

  // people
  accountHolderUid: string;
  beneficiaryUids: string[];
  paymentMethodId: string;

  // Attribution (2026-05-30) — which parent the COST is attributed to
  // for filtering + per-parent budget views. null / unset = Shared.
  // Distinct from `accountHolderUid` (whose Apple ID / bank pays the
  // bill); a card on Mum's account that Dad uses can be paidBy=Dad.
  paidByUid?: string | null;

  // links
  vendorSupplierId: string | null;     // → /families/{f}/suppliers/{id}
  linkedWealthAssetId: string | null;  // → /families/{f}/wealth_assets/{id} (Property only)
  sourceModule: SubscriptionSourceModule;
  isProfessionalExpense: boolean;

  // reminders (Manual subs only)
  reminderDaysBefore: number[];
  postDueCheckEnabled: boolean;
  utilisationCheckDays: number;

  // receipts (Phase 1: Property only)
  hasReceipt: boolean;
  receiptCount: number;

  // audit
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  archivedAt: Timestamp | null;
}

const subsCol = (familyId: string) =>
  collection(db, 'families', familyId, 'subscriptions');

/** Subscribe to all subscriptions for a family. Sort is client-side
 *  (next billing date ASC) — the list is tiny per family and avoiding
 *  an orderBy means no composite index needed for the read. Matches the
 *  pattern in lib/utilityMeters.ts. */
export function subscribeToSubscriptions(
  familyId: string,
  cb: (subs: Subscription[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    subsCol(familyId),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Subscription));
      list.sort((a, b) => {
        const at = a.nextBillingDate?.toMillis?.() ?? 0;
        const bt = b.nextBillingDate?.toMillis?.() ?? 0;
        return at - bt;
      });
      cb(list);
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[subscriptions] subscribe failed:', err);
      cb([]);
    },
  );
}

export async function listSubscriptions(familyId: string): Promise<Subscription[]> {
  if (isGuestActive()) return [];
  const snap = await getDocs(subsCol(familyId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Subscription));
}

export async function getSubscription(
  familyId: string,
  subId: string,
): Promise<Subscription | null> {
  if (isGuestActive()) return null;
  const snap = await getDoc(doc(db, 'families', familyId, 'subscriptions', subId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Subscription;
}

const cyclesCol = (familyId: string, subId: string) =>
  collection(db, 'families', familyId, 'subscriptions', subId, 'cycles');

/** Subscribe to a sub's cycles ordered by dueDate DESC (most recent first).
 *  Uses the (cycles collectionGroup, status, dueDate ASC) index for the
 *  collection-scope variant the cycle-advancer cron needs; this collection
 *  query benefits from the auto-created single-field index on dueDate. */
export function subscribeToCycles(
  familyId: string,
  subId: string,
  cb: (cycles: SubscriptionCycle[]) => void,
  opts: { maxEntries?: number } = {},
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    cyclesCol(familyId, subId),
    orderBy('dueDate', 'desc'),
    qlimit(opts.maxEntries ?? 12),
  );
  return onSnapshot(
    q,
    (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SubscriptionCycle)));
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[subscriptions/cycles] subscribe failed:', err);
      cb([]);
    },
  );
}

// ── Categories + sub-categories (spec §3.1, §3.2) ────────────────────

export const SUBSCRIPTION_CATEGORIES: { id: SubscriptionCategory; emoji: string; label: string }[] = [
  { id: 'mobile_apps',   emoji: '📱', label: 'Mobile Apps & Software' },
  { id: 'memberships',   emoji: '🎫', label: 'Memberships' },
  { id: 'media',         emoji: '🎬', label: 'Media & Entertainment' },
  { id: 'utilities_sub', emoji: '🔌', label: 'Utilities as Subscription' },
  { id: 'property_land', emoji: '🏠', label: 'Property & Land' },
  { id: 'vehicle',       emoji: '🚗', label: 'Vehicle & Transport' },
  { id: 'education',     emoji: '🎓', label: 'Education & Learning' },
  { id: 'professional',  emoji: '💼', label: 'Professional & Tools' },
  { id: 'other',         emoji: '📦', label: 'Other' },
];

export const SUBSCRIPTION_SUBCATEGORIES: Record<SubscriptionCategory, string[]> = {
  mobile_apps:   ['iOS App', 'Android App', 'Web/SaaS App', 'Cross-platform', 'Cloud Storage', 'AI Tools'],
  memberships:   ['Social Club', 'Sports / Gym', 'Business / Professional Body', 'Co-working', 'Loyalty (paid tier)', 'Religious / Spiritual community'],
  media:         ['Streaming Video', 'Streaming Music', 'Print / Digital News', 'Podcasts (paid)', 'Gaming'],
  utilities_sub: ['Security monitoring', 'Internet (subscription)', 'Home automation / IoT'],
  property_land: ['Annual Land Rent', 'Property Tax instalments', 'Body Corporate / HOA fees', 'Borehole servicing'],
  vehicle:       ['Insurance (annual)', 'Road licence', 'Vehicle tracker', 'Parking lease'],
  education:     ['School tuition portals', 'Online course subscriptions', 'Tutoring platforms'],
  professional:  ['Domains & hosting', 'Developer tools', 'Productivity SaaS (work)', 'Trade / industry associations'],
  other:         ['Other'],
};

export function subCategoryEmoji(cat: SubscriptionCategory): string {
  return SUBSCRIPTION_CATEGORIES.find((c) => c.id === cat)?.emoji ?? '📦';
}

export function subCategoryLabel(cat: SubscriptionCategory): string {
  return SUBSCRIPTION_CATEGORIES.find((c) => c.id === cat)?.label ?? 'Other';
}

// ── Platform (iOS / Android / Web / Other) ───────────────────────────
// Every subscription already records a `platform`; it's most meaningful for
// the Mobile Apps & Software category, where the list surfaces a platform
// filter + a "by platform" breakdown so a parent can see which phone (or the
// web) is carrying the most software subscriptions.

export const SUBSCRIPTION_PLATFORMS: { id: SubscriptionPlatform; emoji: string; label: string }[] = [
  { id: 'ios',     emoji: '📱', label: 'iOS' },
  { id: 'android', emoji: '🤖', label: 'Android' },
  { id: 'web',     emoji: '🌐', label: 'Web/SaaS' },
  { id: 'other',   emoji: '📦', label: 'Other' },
];

export function platformLabel(p: SubscriptionPlatform | null | undefined): string {
  return SUBSCRIPTION_PLATFORMS.find((x) => x.id === p)?.label ?? 'Other';
}

// ── Frequency → monthly equivalent (spec §2) ─────────────────────────

export function subMonthlyEquivalentCents(
  amountCents: number,
  frequency: SubscriptionFrequency,
  customMonths?: number | null,
): number {
  if (amountCents <= 0) return 0;
  switch (frequency) {
    case 'daily':       return Math.round(amountCents * 30);
    case 'weekly':      return Math.round(amountCents * 4.33);
    case 'monthly':     return amountCents;
    case 'quarterly':   return Math.round(amountCents / 3);
    case 'semi_annual': return Math.round(amountCents / 6);
    case 'annual':      return Math.round(amountCents / 12);
    case 'one_off':     return 0;
    case 'custom':      return customMonths && customMonths > 0
                          ? Math.round(amountCents / customMonths)
                          : amountCents;
  }
}

// ── Spend-counting rule (Hold / Stop · 2026-06-07) ───────────────────
//
// What still weighs on the household's monthly/annual spend right now?
//   active / trial   → yes, in full (the live commitment).
//   paused (On hold) → no — you're not paying while it's held; it snaps
//                      back in when resumed.
//   cancelled (Stop) → only if it was PREPAID for a multi-month period you
//                      haven't used up yet. A monthly/weekly/daily sub stops
//                      charging the moment you stop, so it drops immediately.
//                      An annual/semi-annual/quarterly that's already paid
//                      keeps counting until its paid-through date (the next
//                      renewal you already paid for) — that money is sunk —
//                      then drops automatically once `now` passes it.

/** Is this a prepaid, multi-month billing period (where stopping mid-term
 *  still leaves a sunk cost)? Custom counts as prepaid only when it spans
 *  ≥ 2 months. */
export function isPrepaidFrequency(
  frequency: SubscriptionFrequency,
  customMonths?: number | null,
): boolean {
  switch (frequency) {
    case 'quarterly':
    case 'semi_annual':
    case 'annual':
      return true;
    case 'custom':
      return (customMonths ?? 0) >= 2;
    default:                 // daily / weekly / monthly / one_off
      return false;
  }
}

/** Does this sub's cost still count toward monthly/annual totals right now?
 *  See the rule block above. */
export function subCountsTowardSpend(s: Subscription, now: Date = new Date()): boolean {
  if (s.status === 'active' || s.status === 'trial') return true;
  if (s.status === 'paused') return false;
  if (s.status === 'cancelled') {
    if (!isPrepaidFrequency(s.frequency, s.customMonths)) return false;
    const paidThrough = s.nextBillingDate?.toMillis?.() ?? 0;
    return paidThrough > now.getTime();
  }
  return false;
}

// ── KPI roll-up (client-side, from subscriptions list) ───────────────
//
// "This month due" — sum amountHousehold of active/trial subs whose
//   nextBillingDate falls in this calendar month (a stopped sub has nothing
//   due — it's already paid or no longer charging).
// "Monthly equivalent" — sum monthlyEquivalent for every sub that still
//   counts (active/trial + prepaid-stopped within its paid-through window).
// "Annualized commitment" — monthly equivalent × 12.
// "Active count" — active/trial subscriptions only (what's live).

export interface SubscriptionKpis {
  thisMonthDueCents: number;
  monthlyEquivalentCents: number;
  annualizedCents: number;
  activeCount: number;
  byCategory: Map<SubscriptionCategory, number>;  // category → count, for chips
}

export function computeSubscriptionKpis(
  subs: Subscription[],
  now: Date = new Date(),
): SubscriptionKpis {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

  let dueThisMonth = 0;
  let monthlyEq    = 0;
  let activeCount  = 0;
  const byCategory = new Map<SubscriptionCategory, number>();

  for (const s of subs) {
    const live = s.status === 'active' || s.status === 'trial';
    // Monthly / annual smoothing includes prepaid-stopped subs until their
    // paid-through date — that committed money still weighs on the budget.
    if (subCountsTowardSpend(s, now)) {
      monthlyEq += s.monthlyEquivalent || 0;
    }
    if (!live) continue;
    activeCount += 1;
    byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + 1);
    const nextMs = s.nextBillingDate?.toMillis?.() ?? 0;
    if (nextMs >= monthStart && nextMs < monthEnd) {
      dueThisMonth += s.amountHousehold || 0;
    }
  }

  return {
    thisMonthDueCents: dueThisMonth,
    monthlyEquivalentCents: monthlyEq,
    annualizedCents: monthlyEq * 12,
    activeCount,
    byCategory,
  };
}

// ── Platform breakdown (Mobile Apps & Software) ──────────────────────
//
// Count + monthly-equivalent spend per platform across the supplied subs
// (the list passes the category-scoped, live subs). Drives the "By platform"
// card and the platform filter chips. Only subs that still count toward
// spend contribute to the monthly figure; the count is all non-stopped subs
// so the chips reflect what you can actually browse.

export interface PlatformBucket {
  platform: SubscriptionPlatform;
  count: number;
  monthlyCents: number;
}

export function computePlatformBreakdown(
  subs: Subscription[],
  now: Date = new Date(),
): PlatformBucket[] {
  const map = new Map<SubscriptionPlatform, PlatformBucket>();
  for (const s of subs) {
    const p = (s.platform ?? 'other') as SubscriptionPlatform;
    const bucket = map.get(p) ?? { platform: p, count: 0, monthlyCents: 0 };
    bucket.count += 1;
    if (subCountsTowardSpend(s, now)) bucket.monthlyCents += s.monthlyEquivalent || 0;
    map.set(p, bucket);
  }
  // Stable order matching SUBSCRIPTION_PLATFORMS, biggest spend first within.
  return SUBSCRIPTION_PLATFORMS
    .map((p) => map.get(p.id))
    .filter((b): b is PlatformBucket => b != null)
    .sort((a, b) => b.monthlyCents - a.monthlyCents || b.count - a.count);
}

// ── Create (server route writes entry + seeds first cycle) ───────────

export interface CreateSubscriptionInput {
  // Identity
  name: string;
  catalogueRef?: string | null;

  // Taxonomy
  category: SubscriptionCategory;
  subCategory: string;
  platform?: SubscriptionPlatform | null;

  // Billing
  billingMode: SubscriptionBillingMode;
  status?: SubscriptionStatus;
  trialEndsOnIso?: string | null;

  // Money — cents in currencyOriginal
  amountOriginalCents: number;
  currencyOriginal: string;
  fxRate: number;

  // Frequency
  frequency: SubscriptionFrequency;
  customMonths?: number | null;
  nextBillingDateIso: string;
  startedOnIso: string;

  // People
  accountHolderUid: string;
  beneficiaryUids?: string[];
  paymentMethodId?: string;
  /** Per-parent cost attribution; null/undefined = Shared. */
  paidByUid?: string | null;

  // Links
  vendorSupplierId?: string | null;
  isProfessionalExpense?: boolean;

  // Reminders (Manual: [7,2,0] default; Auto: [] or [2])
  reminderDaysBefore?: number[];

  // Audit + idempotency
  familyId: string;
  createdByUid: string;
  clientToken: string;

  // Wealth → Household mirror (Non-Negotiable #8). Omit for normal
  // household subscriptions; Kaya Wealth sets these when an insured asset's
  // premium flows down.
  sourceModule?: SubscriptionSourceModule;
  linkedWealthAssetId?: string | null;
}

export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<{ subId: string }> {
  if (isGuestActive()) return { subId: 'guest-sub' };
  const res = await fetch('/api/subscriptions/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`createSubscription failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ── Mark a cycle paid (post-due check) ───────────────────────────────
//
// Wraps /api/subscriptions/cycle/close which flips the cycle to 'paid',
// bumps nextBillingDate on the parent sub, and writes the spend_ledger
// entry — all in one transaction. Result codes:
//   'paid'    — recorded the payment
//   'snoozed' — push the post-due check 3 days; cycle stays open
//   'issue'   — flag the cycle as having a problem; surfaces in support

export type PostDueResult = 'paid' | 'snoozed' | 'issue';

export interface CloseCycleInput {
  familyId: string;
  subId: string;
  cycleId: string;
  result: PostDueResult;
  paidAmountCents?: number;  // optional override; defaults to amountDue
  paidOnIso?: string;        // optional override; defaults to today
  paymentMethodId?: string;
  closedByUid: string;
}

export async function closeCycle(
  input: CloseCycleInput,
): Promise<{ ok: true; ledgerId: string | null }> {
  if (isGuestActive()) return { ok: true, ledgerId: null };
  const res = await fetch('/api/subscriptions/cycle/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`closeCycle failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ── Edit / delete (Phase 2 follow-up · 2026-05-30) ───────────────────
//
// Subset of `Subscription` the UI is allowed to patch. We deliberately
// exclude createdAt/createdBy/sourceModule/linkedWealthAssetId/cycle
// state — those are immutable from the user's perspective (cycles
// mutate via closeCycle; sourceModule is set on create). To pause /
// cancel a subscription, set `status`.

export type SubscriptionEditableFields = Partial<Pick<
  Subscription,
  | 'name' | 'category' | 'subCategory' | 'platform'
  | 'billingMode' | 'status' | 'trialEndsOn'
  | 'amountOriginal' | 'currencyOriginal' | 'fxRate'
  | 'amountHousehold' | 'monthlyEquivalent'
  | 'frequency' | 'customMonths'
  | 'nextBillingDate' | 'startedOn' | 'endedOn'
  | 'accountHolderUid' | 'beneficiaryUids' | 'paymentMethodId' | 'paidByUid'
  | 'vendorSupplierId' | 'isProfessionalExpense'
  | 'reminderDaysBefore' | 'postDueCheckEnabled' | 'utilisationCheckDays'
  | 'platform' | 'autoResumeOn' | 'archivedAt'
>>;

/** Patch fields on a subscription. `updatedAt` is set server-side.
 *  Cycles + ledger entries are untouched — if the user changes amount
 *  or billing date, future cycles pick up the new values; existing
 *  cycles are immutable history. */
export async function updateSubscription(
  familyId: string,
  subId: string,
  patch: SubscriptionEditableFields,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(db, 'families', familyId, 'subscriptions', subId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

// ── Hold / Stop / Resume / Reactivate (2026-06-07) ───────────────────
//
// Thin, intent-named wrappers over updateSubscription so the detail page
// reads clearly and every status transition sets the right companion fields
// in one write. History (cycles + ledger) is never touched — these only
// change what's counted going forward.

/** Put a subscription On hold (temporary). Optionally schedule an automatic
 *  return to active on `resumeOn` (the cron flips it back). Pass null/omit to
 *  hold until the parent resumes manually. */
export async function holdSubscription(
  familyId: string,
  subId: string,
  resumeOn?: Timestamp | null,
): Promise<void> {
  return updateSubscription(familyId, subId, {
    status: 'paused',
    autoResumeOn: resumeOn ?? null,
  });
}

/** Resume a held subscription → active, clearing any auto-resume date. */
export async function resumeSubscription(familyId: string, subId: string): Promise<void> {
  return updateSubscription(familyId, subId, {
    status: 'active',
    autoResumeOn: null,
  });
}

/** Stop (deactivate) a subscription. Stamps `endedOn` (defaults to now) and
 *  clears any auto-resume. Counting then follows the paid-through rule:
 *  prepaid subs keep counting until nextBillingDate, monthly drop at once. */
export async function stopSubscription(
  familyId: string,
  subId: string,
  endedOn?: Timestamp | null,
): Promise<void> {
  return updateSubscription(familyId, subId, {
    status: 'cancelled',
    endedOn: endedOn ?? Timestamp.now(),
    autoResumeOn: null,
  });
}

/** Reactivate a stopped subscription → active, clearing the end date. */
export async function reactivateSubscription(familyId: string, subId: string): Promise<void> {
  return updateSubscription(familyId, subId, {
    status: 'active',
    endedOn: null,
    autoResumeOn: null,
  });
}

/** Hard-delete a subscription. The cycles subcollection becomes
 *  orphaned (Firestore doesn't cascade) — that's fine since cycles
 *  are immutable history; the spend_ledger still references them.
 *  Most use cases should call `updateSubscription({ status: 'cancelled' })`
 *  instead to preserve the trail; delete is for "this was created in
 *  error" only. */
export async function deleteSubscription(
  familyId: string,
  subId: string,
): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(doc(db, 'families', familyId, 'subscriptions', subId));
}

// ── Receipt auto-detect (Phase 1 · 2026-05-30) ───────────────────────
//
// Parse an App Store / Play / service receipt (pasted text OR a
// screenshot/PDF-page image) into subscription drafts the parent then
// reviews + confirms. Wraps /api/subscriptions/scan-receipt.

export interface ParsedSubscriptionDraft {
  name: string;
  amount: number;            // plain number in `currency`
  currency: string;
  cadence: SubscriptionFrequency;
  platform: SubscriptionPlatform;
  nextBilling: string;       // 'YYYY-MM-DD' or ''
  vendor: string;
}

export interface ScanReceiptResult {
  subscriptions: ParsedSubscriptionDraft[];
  skipped?: boolean;
  error?: string;
}

/** Resize + base64-encode an image File for the parse call. Long edge
 *  capped at 1600px — Claude reads receipts fine at that size and the
 *  payload stays small. */
async function imageToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
  return { base64: dataUrl.split(',', 2)[1] ?? '', mediaType: 'image/jpeg' };
}

/** Parse a receipt from pasted text. */
export async function scanReceiptText(text: string, currency?: string): Promise<ScanReceiptResult> {
  try {
    const res = await fetch('/api/subscriptions/scan-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, currency }),
    });
    if (!res.ok) return { subscriptions: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data?.skipped) return { subscriptions: [], skipped: true };
    return { subscriptions: data.subscriptions ?? [] };
  } catch (e) {
    return { subscriptions: [], error: e instanceof Error ? e.message : 'Parse failed' };
  }
}

/** Parse a receipt from an uploaded image File. */
export async function scanReceiptImage(file: File, currency?: string): Promise<ScanReceiptResult> {
  try {
    const { base64, mediaType } = await imageToBase64(file);
    const res = await fetch('/api/subscriptions/scan-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mediaType, currency }),
    });
    if (!res.ok) return { subscriptions: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data?.skipped) return { subscriptions: [], skipped: true };
    return { subscriptions: data.subscriptions ?? [] };
  } catch (e) {
    return { subscriptions: [], error: e instanceof Error ? e.message : 'Parse failed' };
  }
}

// ── Gmail scheduled scan (config-gated) ──────────────────────────────
//
// The parent connects Gmail once (read-only). Kaya re-scans on a weekly
// cron and surfaces new subscriptions as suggestions the parent confirms —
// no one has to remember to do anything. Dormant until the operator sets
// the Google OAuth client env (see status probe).

/** A pending suggestion = a parsed draft plus its server id (so the review
 *  sheet can mark it added/dismissed). */
export type GmailSuggestion = ParsedSubscriptionDraft & { id: string };

export interface GmailState {
  connected: boolean;
  email: string | null;
  lastScanAtMs: number | null;
  suggestions: GmailSuggestion[];
}

/** Is the Gmail-connect path available in this environment? The UI hides
 *  the entry point unless this is true. */
export async function getGmailScanStatus(): Promise<boolean> {
  try {
    const res = await fetch('/api/subscriptions/gmail/status');
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.configured;
  } catch {
    return false;
  }
}

/** Connection + pending-suggestion state for the signed-in parent. */
export async function getGmailState(): Promise<GmailState> {
  const empty: GmailState = { connected: false, email: null, lastScanAtMs: null, suggestions: [] };
  const u = auth.currentUser;
  if (!u) return empty;
  try {
    const token = await u.getIdToken();
    const res = await fetch('/api/subscriptions/gmail/state', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return empty;
    const data = await res.json();
    return {
      connected: !!data?.connected,
      email: data?.email ?? null,
      lastScanAtMs: data?.lastScanAtMs ?? null,
      suggestions: (data?.suggestions ?? []) as GmailSuggestion[],
    };
  } catch {
    return empty;
  }
}

/** Mark suggestions added (turned into subs) or dismissed (skipped). */
export async function resolveGmailSuggestions(addedIds: string[], dismissedIds: string[]): Promise<void> {
  const u = auth.currentUser;
  if (!u) return;
  try {
    const token = await u.getIdToken();
    await fetch('/api/subscriptions/gmail/resolve', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ addedIds, dismissedIds }),
    });
  } catch { /* non-fatal — worst case a resolved suggestion re-shows next load */ }
}

/** Disconnect Gmail: revoke the token at Google + delete the connection. */
export async function disconnectGmail(): Promise<void> {
  const u = auth.currentUser;
  if (!u) return;
  try {
    const token = await u.getIdToken();
    await fetch('/api/subscriptions/gmail/disconnect', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch { /* best-effort */ }
}
