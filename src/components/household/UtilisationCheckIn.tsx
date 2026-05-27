'use client';

// Utilisation check-in nudge (spec §4.6). Surfaces when a sub hasn't
// had any interaction (updatedAt bump) in `utilisationCheckDays` days.
//
// Three actions:
//   ✓ Keeping  — bumps updatedAt; the nudge dismisses for another cycle
//   📅 Pause   — flips status to 'paused' (stops monthly equivalent roll-up)
//   ✕ Cancel   — confirm modal; flips status to 'cancelled' + archivedAt
//
// Cancel triggers a confirmation since it's sticky and affects the Wealth
// roll-up (any pending advisories that cite this sub get re-scored on the
// next wealth-advisor cron run).

import { useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export function UtilisationCheckIn({
  familyId,
  subId,
  daysSinceTouch,
  threshold,
}: {
  familyId: string;
  subId: string;
  daysSinceTouch: number;
  threshold: number;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(fields: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'families', familyId, 'subscriptions', subId), {
        ...fields,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setError((e as Error).message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-kaya bg-pulse-cream border border-pulse-navy/10 px-4 py-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55">
        Still using this?
      </div>
      <p className="mt-1 text-sm font-semibold text-pulse-navy/75">
        No interaction in {daysSinceTouch} days (check-in every {threshold} days for this
        cost band). If it&apos;s not earning its keep, pause or cancel — it stops feeding the
        monthly roll-up the moment you do.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <ActionButton tone="green" disabled={busy} onClick={() => patch({})}>
          ✓ Keeping
        </ActionButton>
        <ActionButton tone="muted" disabled={busy} onClick={() => patch({ status: 'paused' })}>
          📅 Pause
        </ActionButton>
        <ActionButton tone="coral" disabled={busy} onClick={() => setConfirmCancel(true)}>
          ✕ Cancel
        </ActionButton>
      </div>

      {error && (
        <div className="mt-2 text-xs font-semibold text-pulse-coral">{error}</div>
      )}

      {confirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-pulse-navy/55 px-4">
          <div className="max-w-sm w-full rounded-kaya bg-white px-5 py-5 sm:px-6 sm:py-6 shadow-xl">
            <h3 className="font-display text-lg font-extrabold text-pulse-navy">
              Cancel this subscription?
            </h3>
            <p className="mt-2 text-sm font-semibold text-pulse-navy/65">
              Cancelled subs stop showing in the monthly equivalent total and won&apos;t generate
              new cycles. The history stays. Any open Wealth advisory citing this sub gets
              re-scored on the next daily run.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <ActionButton tone="muted" disabled={busy} onClick={() => setConfirmCancel(false)}>
                Keep it
              </ActionButton>
              <ActionButton
                tone="coral"
                disabled={busy}
                onClick={async () => {
                  await patch({ status: 'cancelled', archivedAt: serverTimestamp(), endedOn: serverTimestamp() });
                  setConfirmCancel(false);
                }}
              >
                Yes, cancel
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  tone, children, disabled, onClick,
}: {
  tone: 'green' | 'muted' | 'coral';
  children: React.ReactNode;
  disabled?: boolean;
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
      {children}
    </button>
  );
}
