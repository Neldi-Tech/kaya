'use client';

// ReconcileTimer — 12h countdown / overdue stamp for approved purchase
// requests that haven't been reconciled yet. (2026-05-19)
//
// Why 12h: Elia's audit cadence. After a parent approves a shop, the
// helper has half a day to shop + close out. Past that we surface the
// status so neither side forgets — usually a real reconciliation is
// just a couple hours, so >12h means something stalled.
//
// Two variants exported:
//   <ReconcileTimerBanner /> — full-width banner for the detail page
//   <ReconcileTimerChip />   — compact pill for list rows
//
// Both share the same time math via `computeReconcileTimer`. State
// auto-refreshes every minute so the countdown stays current without
// the page being reloaded.

import { useEffect, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';

const RECONCILE_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h

export type ReconcileTimerState =
  | { kind: 'on-time'; remainingMs: number; remainingLabel: string }
  | { kind: 'overdue'; overdueMs: number; overdueLabel: string };

/** Pure-function version — useful for sorting / row-render decisions
 *  outside React. Returns null when the request isn't in a state where
 *  the timer applies (no approvedAt, or already reconciled). */
export function computeReconcileTimer(
  approvedAt: Timestamp | undefined,
  now: number = Date.now(),
): ReconcileTimerState | null {
  if (!approvedAt) return null;
  const approved = approvedAt.toMillis ? approvedAt.toMillis() : 0;
  if (!approved) return null;
  const elapsed = now - approved;
  if (elapsed < RECONCILE_WINDOW_MS) {
    return {
      kind: 'on-time',
      remainingMs: RECONCILE_WINDOW_MS - elapsed,
      remainingLabel: formatDuration(RECONCILE_WINDOW_MS - elapsed),
    };
  }
  return {
    kind: 'overdue',
    overdueMs: elapsed - RECONCILE_WINDOW_MS,
    overdueLabel: formatDuration(elapsed - RECONCILE_WINDOW_MS),
  };
}

/** "8h 12m" or "47m" — compact, ignores seconds. */
function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return hh === 0 ? `${d}d` : `${d}d ${hh}h`;
  }
  return `${h}h ${m}m`;
}

/** Hook — recomputes the timer state every minute so the UI stays
 *  live without the user refreshing. */
function useReconcileTimer(approvedAt: Timestamp | undefined): ReconcileTimerState | null {
  const [state, setState] = useState<ReconcileTimerState | null>(() => computeReconcileTimer(approvedAt));
  useEffect(() => {
    if (!approvedAt) { setState(null); return; }
    const tick = () => setState(computeReconcileTimer(approvedAt));
    tick(); // immediate on mount or change
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [approvedAt]);
  return state;
}

/** Full-width detail-page banner. Renders nothing when the timer
 *  doesn't apply (no approvedAt or already past close). */
export function ReconcileTimerBanner({ approvedAt }: { approvedAt: Timestamp | undefined }) {
  const state = useReconcileTimer(approvedAt);
  if (!state) return null;
  if (state.kind === 'on-time') {
    return (
      <div className="bg-pantry-leaf-soft border border-pantry-leaf/30 rounded-hive p-3 mt-3 flex items-center gap-3">
        <span className="text-lg">⏰</span>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-extrabold text-sm text-pantry-leaf-dk">
            {state.remainingLabel} to reconcile
          </div>
          <div className="text-[11px] text-hive-muted font-bold">
            Soft 12-hour window after approval. Close out the reconcile when the shop is done.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-[#FCEAEA] border border-hive-rose rounded-hive p-3 mt-3 flex items-center gap-3">
      <span className="text-lg">⚠️</span>
      <div className="flex-1 min-w-0">
        <div className="font-nunito font-extrabold text-sm text-hive-rose">
          Overdue · {state.overdueLabel} past the 12h window
        </div>
        <div className="text-[11px] text-hive-muted font-bold">
          The 12-hour soft window has passed. Reconcile now to keep budget + audit accurate.
        </div>
      </div>
    </div>
  );
}

/** Compact pill for list rows. Returns null when not applicable. */
export function ReconcileTimerChip({ approvedAt }: { approvedAt: Timestamp | undefined }) {
  const state = useReconcileTimer(approvedAt);
  if (!state) return null;
  const overdue = state.kind === 'overdue';
  return (
    <span
      className={`text-[10px] font-nunito font-extrabold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
        overdue
          ? 'bg-[#FCEAEA] text-hive-rose border-hive-rose'
          : 'bg-pantry-leaf-soft text-pantry-leaf-dk border-pantry-leaf/40'
      }`}
      title={overdue ? `Overdue ${state.overdueLabel}` : `${state.remainingLabel} left to reconcile`}
    >
      {overdue ? `⚠ ${state.overdueLabel} overdue` : `⏰ ${state.remainingLabel} left`}
    </span>
  );
}
