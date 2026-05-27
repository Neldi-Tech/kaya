// Household · Contributions data layer.
//
// One collection: families/{f}/contributions/{contribId} — gifts,
// tithes, condolences (msiba), charity, family support. Parents-only
// by default; per-entry `visibility = 'family'` lets a kid read it
// (e.g. a teaching moment about giving).
//
// Schema docs:
//   Kaya Contributions and Subscrition in Budgets/
//     Kaya-Subscriptions-Contributions_Schema_2026-05-27.md
//
// P1 ships types + read helpers. Add/edit, the tithe % calc, occasion
// grouping + ledger writes land in P2.

import {
  collection, doc, getDoc, getDocs, Timestamp, onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

export type ContributionCategory =
  | 'faith' | 'charity' | 'life_events' | 'family_community'
  | 'civic' | 'education_sponsorship' | 'workplace' | 'other';

export type ContributionRecipientType = 'person' | 'organization' | 'cause' | 'community';

export type ContributionFrequency =
  | 'monthly' | 'quarterly' | 'annual' | 'one_off' | 'custom';

export type ContributionPaymentMethod =
  | 'mpesa' | 'bank' | 'cash' | 'cheque' | 'in_kind' | 'other';

export type ContributionVisibility =
  | 'parents_only' | 'family' | 'private_to_giver';

export interface ContributionOccasion {
  name: string;
  date: Timestamp;
  groupId: string | null;
}

export interface Contribution {
  id: string;
  recipientName: string;
  recipientType: ContributionRecipientType;
  recipientSupplierId: string | null;   // → /families/{f}/suppliers/{id}
  catalogueRef: string | null;
  anonymousFlag: boolean;

  category: ContributionCategory;
  subCategory: string;

  occasion: ContributionOccasion | null;

  // money — cents in the named currency (matches formatCents convention)
  amountOriginal: number;
  currencyOriginal: string;
  fxRate: number;
  amountHousehold: number;
  monthlyEquivalent: number;

  frequency: ContributionFrequency;
  customMonths: number | null;
  dateGiven: Timestamp;

  givenByUid: string;
  givenOnBehalfOf: string;

  paymentMethod: ContributionPaymentMethod;
  inKindDescription: string | null;
  estimatedValue: number | null;

  // tithe-specific
  isPercentOfIncome: boolean;
  percentRate: number | null;
  incomeBasis: number | null;
  incomeSourceRef: string | null;

  taxDeductible: boolean;
  receiptHeld: boolean;

  visibility: ContributionVisibility;

  notes: string;
  tags: string[];

  remembranceRecurring: boolean;
  remembranceDate: Timestamp | null;

  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

const contribsCol = (familyId: string) =>
  collection(db, 'families', familyId, 'contributions');

/** Subscribe to all contributions for a family. Sort is client-side
 *  (date given DESC) — the list is small enough that avoiding an
 *  orderBy keeps the read index-free. */
export function subscribeToContributions(
  familyId: string,
  cb: (contribs: Contribution[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    contribsCol(familyId),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Contribution));
      list.sort((a, b) => {
        const at = a.dateGiven?.toMillis?.() ?? 0;
        const bt = b.dateGiven?.toMillis?.() ?? 0;
        return bt - at;
      });
      cb(list);
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[contributions] subscribe failed:', err);
      cb([]);
    },
  );
}

export async function listContributions(familyId: string): Promise<Contribution[]> {
  if (isGuestActive()) return [];
  const snap = await getDocs(contribsCol(familyId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Contribution));
}

export async function getContribution(
  familyId: string,
  contribId: string,
): Promise<Contribution | null> {
  if (isGuestActive()) return null;
  const snap = await getDoc(doc(db, 'families', familyId, 'contributions', contribId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Contribution;
}

// ── Categories + sub-categories (spec §4.1, §4.2) ────────────────────

export const CONTRIBUTION_CATEGORIES: { id: ContributionCategory; emoji: string; label: string }[] = [
  { id: 'faith',                emoji: '🙏', label: 'Faith & Religious' },
  { id: 'charity',              emoji: '❤️', label: 'Charity & Humanitarian' },
  { id: 'life_events',          emoji: '🎉', label: 'Life Events' },
  { id: 'family_community',     emoji: '👨‍👩‍👧', label: 'Family & Community Support' },
  { id: 'civic',                emoji: '🗳️', label: 'Civic & Causes' },
  { id: 'education_sponsorship',emoji: '🎓', label: 'Education Sponsorship' },
  { id: 'workplace',            emoji: '💼', label: 'Workplace & Professional' },
  { id: 'other',                emoji: '📦', label: 'Other' },
];

/** Sub-category options per category. Free-text on the doc but the
 *  picker offers these as suggestions. From spec §4.2. */
export const CONTRIBUTION_SUBCATEGORIES: Record<ContributionCategory, string[]> = {
  faith: ['Tithe', 'Offering', 'Building fund', 'Mission support', 'Pastor / clergy gift', 'Pilgrimage / Hajj', 'Other religious giving'],
  charity: ['Registered charity (one-off)', 'Registered charity (recurring)', 'Disaster relief', 'Orphanage / children’s home', 'Health / medical fund', 'Animal welfare'],
  life_events: ['Wedding gift', 'Anniversary gift', 'Birthday gift', 'Baby shower / new baby', 'Graduation', 'Housewarming', 'Condolences / Funeral (msiba)', 'Memorial / annual remembrance'],
  family_community: ['Family member support', 'Extended family contribution', 'Neighbourhood collection (mchango wa mtaa)', 'Village development', 'Friend in need (discreet)'],
  civic: ['Political / civic contribution', 'Environmental cause', 'Advocacy / NGO', 'Crowdfunding (GoFundMe, M-Changa)'],
  education_sponsorship: ['Sponsored child — school fees', 'Sponsored child — uniform / supplies', 'Bursary / scholarship fund'],
  workplace: ['Office collection', 'Industry association', 'Corporate matching'],
  other: ['Other'],
};

export function categoryEmoji(cat: ContributionCategory): string {
  return CONTRIBUTION_CATEGORIES.find((c) => c.id === cat)?.emoji ?? '📦';
}

export function categoryLabel(cat: ContributionCategory): string {
  return CONTRIBUTION_CATEGORIES.find((c) => c.id === cat)?.label ?? 'Other';
}

// ── Frequency → monthly equivalent (spec §2) ─────────────────────────

export function contribMonthlyEquivalentCents(
  amountCents: number,
  frequency: ContributionFrequency,
  customMonths?: number | null,
): number {
  if (amountCents <= 0) return 0;
  switch (frequency) {
    case 'monthly':   return amountCents;
    case 'quarterly': return Math.round(amountCents / 3);
    case 'annual':    return Math.round(amountCents / 12);
    case 'one_off':   return 0;
    case 'custom':    return customMonths && customMonths > 0
                        ? Math.round(amountCents / customMonths)
                        : amountCents;
  }
}

// ── KPI roll-up (client-side, no ledger needed) ──────────────────────
//
// Every contribution doc carries amountHousehold + dateGiven, so the
// 3 KPIs on the list page derive directly from the contribs list —
// no spend_ledger read needed. The ledger is what Wealth uses for
// cross-module roll-ups; this module owns its own dashboard.

export interface ContributionKpis {
  ytdTotalCents: number;
  thisMonthCents: number;
  tithePercent: number | null;  // null when no incomeBasis recorded in any YTD tithe doc
  topRecipients: { name: string; cents: number }[];
}

export function computeContributionKpis(
  contribs: Contribution[],
  now: Date = new Date(),
): ContributionKpis {
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let ytdTotal = 0;
  let thisMonth = 0;
  let titheSum = 0;
  let incomeSum = 0;
  const byRecipient = new Map<string, number>();

  for (const c of contribs) {
    const ms = c.dateGiven?.toMillis?.() ?? 0;
    if (ms < yearStart) continue;
    const amt = c.amountHousehold || 0;
    ytdTotal += amt;
    if (ms >= monthStart) thisMonth += amt;
    if (c.subCategory?.toLowerCase().includes('tithe') || c.isPercentOfIncome) {
      titheSum += amt;
      if (c.incomeBasis && c.incomeBasis > 0) incomeSum += c.incomeBasis;
    }
    const key = c.recipientName || '(unnamed)';
    byRecipient.set(key, (byRecipient.get(key) ?? 0) + amt);
  }

  const tithePercent = incomeSum > 0 ? (titheSum / incomeSum) * 100 : null;
  const topRecipients = Array.from(byRecipient.entries())
    .map(([name, cents]) => ({ name, cents }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 3);

  return { ytdTotalCents: ytdTotal, thisMonthCents: thisMonth, tithePercent, topRecipients };
}

// ── Create (calls API which writes entry + ledger atomically) ────────
//
// Client never writes to /spend_ledger (rules deny). The route uses
// the Admin SDK in a transaction: contributions/{id} + spend_ledger/{id}
// land together, or neither does. Idempotency via the client-passed
// `clientToken` UUID — re-submissions with the same token return the
// existing doc id instead of creating a duplicate.

export interface CreateContributionInput {
  // Identity
  recipientName: string;
  recipientType: ContributionRecipientType;
  anonymousFlag?: boolean;

  // Taxonomy
  category: ContributionCategory;
  subCategory: string;

  // Optional occasion
  occasionName?: string;
  occasionDateIso?: string;
  occasionGroupId?: string | null;

  // Money — cents in currencyOriginal
  amountOriginalCents: number;
  currencyOriginal: string;
  fxRate: number;

  // Frequency
  frequency: ContributionFrequency;
  customMonths?: number | null;
  dateGivenIso: string;

  // People
  givenByUid: string;
  givenOnBehalfOf?: string;

  // Payment
  paymentMethod: ContributionPaymentMethod;
  inKindDescription?: string;
  estimatedValueCents?: number;

  // Tithe
  isPercentOfIncome?: boolean;
  percentRate?: number | null;
  incomeBasisCents?: number | null;

  // Reporting flags
  taxDeductible?: boolean;
  receiptHeld?: boolean;

  // Visibility (default parents_only)
  visibility?: ContributionVisibility;

  notes?: string;
  tags?: string[];

  // Audit + idempotency
  familyId: string;
  createdByUid: string;
  clientToken: string;
}

export async function createContribution(
  input: CreateContributionInput,
): Promise<{ contribId: string }> {
  if (isGuestActive()) return { contribId: 'guest-contrib' };
  const res = await fetch('/api/contributions/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`createContribution failed: ${res.status} ${text}`);
  }
  return res.json();
}
