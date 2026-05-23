'use client';

// BudgetBalanceMeter — shows a category's monthly budget balance + what
// would be left "after this entry", so a parent stays aware while
// logging spend (2026-05-23). Reusable across Dine Out quick-log, the
// purchase request/reconcile detail, and any future spend-entry surface.
//
// Self-contained: reads the family cap (householdBudgets[module]) + sums
// this-month CLOSED spend for the module from the live feed. Pass
// `pendingAmountCents` (the amount being entered) to show the projected
// remaining. Renders a gentle "set a cap" hint when no budget is set.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, type PurchaseModule, MODULE_LABEL, subscribeToRecentRequests,
} from '@/lib/purchase';
import { formatCents } from '@/components/pantry/format';

const monthKeyOf = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export default function BudgetBalanceMeter({
  module, pendingAmountCents = 0, excludeRequestId, className,
}: {
  module: PurchaseModule;
  /** Amount being entered right now — drives the "after this" line. */
  pendingAmountCents?: number;
  /** Skip this request from the month's spent (e.g. when reconciling a
   *  request that's already counted), to avoid double-counting. */
  excludeRequestId?: string;
  className?: string;
}) {
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;

  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  useEffect(() => {
    if (!profile?.familyId) return;
    return subscribeToRecentRequests(profile.familyId, setRecent);
  }, [profile?.familyId]);

  const thisMonth = monthKeyOf();
  const spentCents = useMemo(() => recent
    .filter((r) => r.module === module && r.status === 'closed' && r.id !== excludeRequestId)
    .filter((r) => { const at = r.closedAt?.toDate?.(); return !!at && monthKeyOf(at) === thisMonth; })
    .reduce((a, r) => a + (r.actualTotalCents ?? r.estimatedTotalCents ?? 0), 0),
    [recent, module, excludeRequestId, thisMonth]);

  const capCents = family?.householdBudgets?.[module] ?? 0;
  const pend = Math.max(0, pendingAmountCents);
  const leftCents = capCents - spentCents;
  const afterCents = leftCents - pend;
  const hasCap = capCents > 0;
  const pct = hasCap ? Math.min(100, Math.round((spentCents / capCents) * 100)) : 0;
  const tone: 'ok' | 'warn' | 'over' =
    !hasCap ? 'ok'
    : afterCents < 0 ? 'over'
    : spentCents / capCents >= 0.85 ? 'warn'
    : 'ok';
  const tones = {
    ok:   { card: 'bg-[#EDF8F0] border-[#9FD3BB]', lab: 'text-pantry-leaf-dk', fill: 'bg-pantry-leaf' },
    warn: { card: 'bg-[#FFF3D9] border-hive-honey', lab: 'text-hive-honey-dk', fill: 'bg-hive-honey' },
    over: { card: 'bg-[#FCEAEA] border-[#E8B5B5]', lab: 'text-hive-rose',      fill: 'bg-hive-rose' },
  }[tone];

  if (!hasCap) {
    return (
      <div className={`rounded-hive border border-hive-line bg-hive-cream/60 p-2.5 text-[11px] text-hive-muted ${className ?? ''}`}>
        No {MODULE_LABEL[module]} budget set — <a href={`/pantry/budget/compose/${module}`} className="font-bold text-hive-navy underline">set a cap</a> to track the balance here.
      </div>
    );
  }

  return (
    <div className={`rounded-hive border ${tones.card} p-3 ${className ?? ''}`}>
      <div className="flex items-baseline justify-between">
        <span className={`text-[9px] font-nunito font-black uppercase tracking-wider ${tones.lab}`}>{MODULE_LABEL[module]} · this month</span>
        <span className="font-nunito font-black text-sm">{formatCents(Math.max(0, leftCents), currency)} left</span>
      </div>
      <div className="h-2 rounded-full bg-white mt-2 overflow-hidden border border-black/5">
        <div className={`h-full rounded-full ${tones.fill}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-hive-muted mt-1.5">
        {formatCents(spentCents, currency)} of {formatCents(capCents, currency)} spent
        {pend > 0 && (
          <> · <span className="font-bold text-hive-navy">after this: {afterCents < 0 ? `${formatCents(-afterCents, currency)} over ⚠` : `${formatCents(afterCents, currency)} left`}</span></>
        )}
      </div>
    </div>
  );
}
