'use client';

// /hive/cash-in — incoming-cash ledger. Mirrors section 2 of the v2
// mockup: two summary tiles (this month / weekly avg) + the ledger of
// `direction === 'in' && layer === 'cash'` transactions.

import { useMemo } from 'react';
import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';
import KidSwitcher from '@/components/hive/KidSwitcher';
import TransactionRow from '@/components/hive/TransactionRow';
import BackButton from '@/components/ui/BackButton';
import { formatCash } from '@/components/hive/format';

export default function CashInPage() {
  const { transactions, config } = useHive();

  const incoming = useMemo(
    () => transactions.filter((t) => t.layer === 'cash' && t.direction === 'in'),
    [transactions],
  );

  // This month + weekly average from incoming cash only.
  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let monthCents = 0;
    const weeks: Record<string, number> = {};
    for (const t of incoming) {
      const ts = (t.createdAt as any)?.toMillis?.();
      if (typeof ts !== 'number') continue;
      if (ts >= monthStart) monthCents += t.amount;
      const wk = Math.floor((Date.now() - ts) / (7 * 86_400_000));
      if (wk >= 0 && wk < 8) weeks[wk] = (weeks[wk] || 0) + t.amount;
    }
    const sumWeeks = Object.values(weeks).reduce((a, b) => a + b, 0);
    const numWeeks = Math.max(1, Object.keys(weeks).length);
    const avg = Math.round(sumWeeks / numWeeks);
    return { monthCents, avgWeekCents: avg };
  }, [incoming]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Cash · In</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">Money I received</h1>
      </div>

      <KidSwitcher />

      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <div className="rounded-hive border bg-[#E6F7EE] border-[#8FD3AB] p-4">
          <p className="text-[10px] uppercase tracking-[1.5px] font-bold text-hive-muted">This month</p>
          <p className="font-nunito font-black text-2xl mt-1 text-hive-green">+{formatCash(stats.monthCents, config.currency)}</p>
        </div>
        <div className="rounded-hive border border-hive-line bg-hive-paper p-4">
          <p className="text-[10px] uppercase tracking-[1.5px] font-bold text-hive-muted">Avg / week</p>
          <p className="font-nunito font-black text-2xl mt-1">{formatCash(stats.avgWeekCents, config.currency)}</p>
        </div>
      </div>

      <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 mb-4">
        {incoming.length === 0 ? (
          <p className="text-hive-muted text-sm py-6 text-center">
            No cash received yet. Allowance and gifts your parents add will show up here.
          </p>
        ) : (
          incoming.map((t) => (
            <TransactionRow key={t.id} tx={t} currency={config.currency} />
          ))
        )}

        {/* Phase 3 placeholder, per the mockup */}
        <div className="mt-3 pt-3 border-t border-hive-line/60 flex items-center gap-2.5 opacity-50">
          <div className="w-[34px] h-[34px] rounded-[11px] bg-[#E6F7EE] flex items-center justify-center text-base">🌳</div>
          <div className="flex-1 min-w-0">
            <p className="font-nunito font-extrabold text-[13px]">
              Orchard sale
              <span className="ml-2 inline-block bg-hive-honey-soft text-hive-honey-dk text-[9px] font-extrabold px-1.5 py-0.5 rounded-md">PHASE 3</span>
            </p>
            <p className="text-[10px] text-hive-muted">Coming soon — business income</p>
          </div>
          <span className="font-nunito font-black text-[13px] text-hive-muted">—</span>
        </div>
      </div>

      <p className="text-center text-[11px] text-hive-muted leading-relaxed">
        All deposits logged. Parents add manually from{' '}
        <Link href="/parent/hive-deposit" className="text-hive-honey-dk font-bold hover:underline">/parent/hive-deposit</Link>.
      </p>
    </div>
  );
}
