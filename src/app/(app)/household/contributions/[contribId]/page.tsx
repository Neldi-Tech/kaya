'use client';

// Household → Contributions → Detail (read-only in P2).
// Edit + delete flows ship in a follow-up.

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  Contribution, getContribution,
  CONTRIBUTION_CATEGORIES, categoryEmoji, categoryLabel,
} from '@/lib/contributions';
import { formatCents } from '@/components/pantry/format';
import { toDisplayDate } from '@/lib/dates';
import { StatusBadge, type StatusTone } from '@/components/household/StatusBadge';

const VISIBILITY_TONE: Record<Contribution['visibility'], StatusTone> = {
  parents_only:     'muted',
  family:           'green',
  private_to_giver: 'neutral',
};
const VISIBILITY_LABEL: Record<Contribution['visibility'], string> = {
  parents_only:     'Parents only',
  family:           'Family visible',
  private_to_giver: 'Private',
};

function tsToIso(ts: Contribution['dateGiven']): string {
  if (!ts) return '';
  const d = ts.toDate();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function ContributionDetailPage() {
  const { profile, loading: authLoading } = useAuth();
  const { family } = useFamily();
  const router = useRouter();
  const params = useParams<{ contribId: string }>();
  const contribId = params?.contribId;

  const [contrib, setContrib] = useState<Contribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!profile) { router.replace('/login'); return; }
    if (profile.role === 'kid') { router.replace('/home'); return; }
    if (!profile.familyId || !contribId) return;
    (async () => {
      const c = await getContribution(profile.familyId!, contribId);
      if (!c) setNotFound(true);
      else setContrib(c);
      setLoading(false);
    })();
  }, [profile, authLoading, contribId, router]);

  if (authLoading || loading) {
    return <div className="p-6 text-pulse-navy/60">Loading…</div>;
  }
  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-10">
        <p className="text-pulse-navy/70 font-semibold">
          This contribution doesn&apos;t exist (or you don&apos;t have access).
        </p>
        <Link href="/household/contributions" className="mt-3 inline-block font-bold text-pulse-gold hover:underline">
          ← Back to all contributions
        </Link>
      </div>
    );
  }
  if (!contrib) return null;

  const householdCurrency = family?.hiveConfig?.currency ?? 'USD';
  const titheBadge = contrib.isPercentOfIncome
    ? `${(contrib.percentRate ?? 0).toFixed(1)}% of income`
    : null;

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <Link href="/household/contributions" className="text-xs font-bold uppercase tracking-wide text-pulse-navy/55 hover:text-pulse-navy">
          ← Contributions
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-3xl">{categoryEmoji(contrib.category)}</span>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-pulse-navy leading-tight">
              {contrib.recipientName}
            </h1>
            <div className="text-xs font-bold uppercase tracking-wide text-pulse-navy/55">
              {categoryLabel(contrib.category)} · {contrib.subCategory}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone={VISIBILITY_TONE[contrib.visibility]}>{VISIBILITY_LABEL[contrib.visibility]}</StatusBadge>
          {titheBadge && <StatusBadge tone="gold">{titheBadge}</StatusBadge>}
          {contrib.taxDeductible && <StatusBadge tone="green">Tax-deductible</StatusBadge>}
          {contrib.anonymousFlag && <StatusBadge tone="neutral">Anonymous</StatusBadge>}
        </div>
      </header>

      <div className="rounded-kaya bg-white border border-pulse-navy/10 px-5 py-5 sm:px-6 sm:py-6 space-y-4">
        {/* Amount block */}
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-extrabold text-pulse-navy">
            {formatCents(contrib.amountHousehold, householdCurrency)}
          </span>
          {contrib.currencyOriginal !== householdCurrency && (
            <span className="text-sm font-semibold text-pulse-navy/55">
              ({formatCents(contrib.amountOriginal, contrib.currencyOriginal)} @ {contrib.fxRate.toFixed(4)})
            </span>
          )}
        </div>
        <div className="text-xs font-semibold text-pulse-navy/60">
          {contrib.frequency === 'one_off'
            ? 'One-off'
            : `Recurring · ${contrib.frequency === 'custom' ? `every ${contrib.customMonths ?? '?'} months` : contrib.frequency}`}
          {' · '}
          {toDisplayDate(tsToIso(contrib.dateGiven))}
        </div>

        <hr className="border-pulse-navy/8" />

        <DetailRow label="Payment" value={paymentLabel(contrib.paymentMethod)} />
        {contrib.paymentMethod === 'in_kind' && contrib.inKindDescription && (
          <DetailRow label="In-kind detail" value={contrib.inKindDescription} />
        )}
        {contrib.givenOnBehalfOf && (
          <DetailRow label="On behalf of" value={contrib.givenOnBehalfOf} />
        )}
        {contrib.occasion && (
          <DetailRow
            label="Occasion"
            value={`${contrib.occasion.name}${contrib.occasion.date ? ' · ' + toDisplayDate(tsToIso(contrib.occasion.date)) : ''}`}
          />
        )}
        {contrib.isPercentOfIncome && contrib.incomeBasis != null && (
          <DetailRow
            label="Income basis"
            value={`${formatCents(contrib.incomeBasis, householdCurrency)} · ${(contrib.percentRate ?? 0).toFixed(1)}%`}
          />
        )}
        {contrib.notes && (
          <div className="pt-2 border-t border-pulse-navy/8">
            <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55 mb-1">Notes</div>
            <p className="text-sm font-semibold text-pulse-navy whitespace-pre-wrap">{contrib.notes}</p>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-pulse-navy/50">
        Edit + delete ship in a follow-up. Need to fix something now? Add a new entry and mark this one with a note.
      </p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55 shrink-0">
        {label}
      </span>
      <span className="font-semibold text-pulse-navy text-right">{value}</span>
    </div>
  );
}

function paymentLabel(p: Contribution['paymentMethod']): string {
  switch (p) {
    case 'mpesa':   return 'M-Pesa / mobile money';
    case 'bank':    return 'Bank transfer';
    case 'cash':    return 'Cash';
    case 'cheque':  return 'Cheque';
    case 'in_kind': return 'In-kind (non-cash)';
    default:        return 'Other';
  }
}
