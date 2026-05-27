'use client';

// Post-due check action row for Manual subscriptions (spec §4.7).
// Surfaces on the Detail page when:
//   - cycle.status === 'overdue' (set by the cycle-advancer cron), OR
//   - cycle.status === 'due' and today > cycle.dueDate
//
// Three buttons:
//   ✓ Paid     — marks paid, writes spend_ledger, advances nextBillingDate
//   📅 Snooze  — pushes the cycle's dueDate +3 days; check fires again
//   ⚠ Issue   — flags the cycle as having a problem; no ledger write

import { useState } from 'react';
import { closeCycle, type PostDueResult, type SubscriptionCycle } from '@/lib/subscriptions';
import { formatCents } from '@/components/pantry/format';
import { toDisplayDate } from '@/lib/dates';

export function PostDueCheck({
  familyId,
  subId,
  cycle,
  householdCurrency,
  uid,
  onResolved,
}: {
  familyId: string;
  subId: string;
  cycle: SubscriptionCycle;
  householdCurrency: string;
  uid: string;
  onResolved?: () => void;
}) {
  const [busy, setBusy] = useState<PostDueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dueIso = (() => {
    const d = cycle.dueDate?.toDate?.();
    if (!d) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  })();

  async function act(result: PostDueResult) {
    setBusy(result);
    setError(null);
    try {
      await closeCycle({
        familyId,
        subId,
        cycleId: cycle.id,
        result,
        closedByUid: uid,
      });
      onResolved?.();
    } catch (e) {
      setError((e as Error).message || 'Failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-kaya bg-pulse-coral/8 border border-pulse-coral/30 px-4 py-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-coral">
        Did you pay this cycle?
      </div>
      <div className="mt-1 font-display text-base font-extrabold text-pulse-navy">
        {formatCents(cycle.amountDue, householdCurrency)} due {toDisplayDate(dueIso)}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <ActionButton
          tone="green"
          disabled={busy != null}
          loading={busy === 'paid'}
          onClick={() => act('paid')}
        >
          ✓ Paid
        </ActionButton>
        <ActionButton
          tone="muted"
          disabled={busy != null}
          loading={busy === 'snoozed'}
          onClick={() => act('snoozed')}
        >
          📅 Snooze 3 days
        </ActionButton>
        <ActionButton
          tone="coral"
          disabled={busy != null}
          loading={busy === 'issue'}
          onClick={() => act('issue')}
        >
          ⚠ Issue
        </ActionButton>
      </div>

      {error && (
        <div className="mt-2 text-xs font-semibold text-pulse-coral">{error}</div>
      )}
    </div>
  );
}

function ActionButton({
  tone, children, disabled, loading, onClick,
}: {
  tone: 'green' | 'muted' | 'coral';
  children: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  const toneClass = tone === 'green'
    ? 'bg-pulse-green text-pulse-cream'
    : tone === 'coral'
      ? 'bg-pulse-coral text-pulse-cream'
      : 'bg-white text-pulse-navy border border-pulse-navy/15';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-4 py-2 text-sm font-display font-extrabold transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${toneClass}`}
    >
      {loading ? '…' : children}
    </button>
  );
}
