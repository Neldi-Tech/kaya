'use client';

// Wealth advisory card. Two primary actions: "Review & redirect" routes
// to a stub modal (Kaya Wealth's full redirect UI is not built yet —
// per spec, this is a placeholder pointing at the future /wealth/redirect
// route). "Dismiss" archives the advisory.

import { useState } from 'react';
import { dismissAdvisory, type WealthAdvisory } from '@/lib/wealthAdvisories';
import { formatCents } from '@/components/pantry/format';

export function AdvisoryCard({
  familyId,
  uid,
  advisory,
  householdCurrency,
}: {
  familyId: string;
  uid: string;
  advisory: WealthAdvisory;
  householdCurrency: string;
}) {
  const [showStub, setShowStub] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  async function handleDismiss() {
    setDismissing(true);
    try {
      await dismissAdvisory(familyId, advisory.id, uid);
    } finally {
      setDismissing(false);
    }
  }

  return (
    <div className="rounded-kaya bg-pulse-gold/8 border border-pulse-gold/35 px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-gold">
          Kaya Wealth · Advisory
        </div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/50">
          {dateLabel(advisory.detectedAt.toDate())}
        </div>
      </div>

      <h3 className="mt-1 font-display text-lg font-extrabold text-pulse-navy">
        {advisory.title}
      </h3>
      <p className="mt-1 text-sm font-semibold text-pulse-navy/75">{advisory.body}</p>

      {advisory.potentialAnnualSaving > 0 && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-pulse-green/12 border border-pulse-green/35 px-3 py-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-pulse-green">
            Could redirect
          </span>
          <span className="font-display font-extrabold text-pulse-green">
            {formatCents(advisory.potentialAnnualSaving, householdCurrency)}/yr
          </span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowStub(true)}
          className="rounded-full bg-pulse-navy text-pulse-cream px-4 py-2 text-sm font-display font-extrabold hover:bg-pulse-navy/90 transition-colors"
        >
          Review &amp; redirect →
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={dismissing}
          className="rounded-full bg-white text-pulse-navy border border-pulse-navy/15 px-4 py-2 text-sm font-display font-extrabold disabled:opacity-50"
        >
          {dismissing ? '…' : 'Dismiss'}
        </button>
      </div>

      {showStub && (
        <WealthRedirectStub onClose={() => setShowStub(false)} />
      )}
    </div>
  );
}

function WealthRedirectStub({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-pulse-navy/55 px-4">
      <div className="max-w-sm w-full rounded-kaya bg-white px-5 py-5 sm:px-6 sm:py-6 shadow-xl">
        <div className="text-3xl">💎</div>
        <h3 className="mt-3 font-display text-xl font-extrabold text-pulse-navy">
          Coming with Kaya Wealth v1
        </h3>
        <p className="mt-2 text-sm font-semibold text-pulse-navy/65">
          The full Review &amp; Redirect flow — pick a destination (index fund / savings),
          cancel the unused subs, log the new investment — ships when the Kaya Wealth
          module goes live. The advisory stays here until then, and you can act on it
          the moment Wealth is ready.
        </p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-pulse-navy text-pulse-cream px-4 py-2 text-sm font-display font-extrabold"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function dateLabel(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
