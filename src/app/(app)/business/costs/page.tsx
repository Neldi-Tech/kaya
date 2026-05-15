'use client';

// Business → Costs — chronological list of all logged costs.
// Float-funded costs show instantly as approved; wallet-funded costs
// go through the parent approval queue and show as pending.

import Link from 'next/link';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { COST_CATEGORIES } from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import KidSwitcher from '@/components/hive/KidSwitcher';
import BackButton from '@/components/ui/BackButton';

const STATUS_META: Record<string, { label: string; dot: string }> = {
  pending_approval: { label: 'Pending',  dot: 'bg-hive-honey' },
  approved:         { label: 'Approved', dot: 'bg-hive-green' },
  rejected:         { label: 'Rejected', dot: 'bg-hive-rose'  },
};

export default function CostsPage() {
  const { children } = useFamily();
  const { activeKidId, config } = useHive();
  const { costs, loading } = useBusiness();

  const activeKid = children.find((c) => c.id === activeKidId);
  const cur = config.currency;

  const catEmoji = (catId: string) =>
    COST_CATEGORIES.find((c) => c.id === catId)?.emoji || '•';

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden mb-1"><BackButton /></div>

      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-green">
          {activeKid ? `${activeKid.name}'s Business` : 'My Business'}
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1 leading-tight">
          Costs 🧾
        </h1>
      </div>

      <KidSwitcher />

      <Link
        href="/business/costs/new"
        className="block w-full bg-hive-green hover:bg-[#2A8553] text-white rounded-hive py-3 text-center font-nunito font-black text-[13px] transition-colors no-underline mb-4"
      >
        + Log a cost
      </Link>

      {loading ? (
        <div className="py-12 text-center text-hive-muted text-sm">Loading…</div>
      ) : costs.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <p className="text-4xl mb-3">🧾</p>
          <p className="font-nunito font-extrabold text-[14px] mb-1">No costs yet</p>
          <p className="text-[12px] text-hive-muted">Log seeds, feed, packaging — anything you spent money on for the business.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {costs.map((c) => {
            const sm = STATUS_META[c.status] ?? { label: c.status, dot: 'bg-hive-muted' };
            const dateMs = (c.costDate as any)?.toMillis?.() || (c.createdAt as any)?.toMillis?.();
            const dateStr = dateMs
              ? new Date(dateMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '';
            return (
              <div key={c.id} className="bg-hive-paper border border-hive-line rounded-hive px-4 py-3 flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${sm.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <p className="font-nunito font-extrabold text-[14px] truncate">
                      {catEmoji(c.category)} {c.description}
                    </p>
                    <span className="text-[10px] text-hive-muted">{dateStr}</span>
                  </div>
                  <p className="text-[11px] text-hive-muted mt-0.5">
                    {sm.label} · {c.fundingSource === 'float' ? '💰 from float' : '👛 from wallet'}
                  </p>
                  {c.rejectionReason && (
                    <p className="text-[11px] text-hive-rose mt-0.5">{c.rejectionReason}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-nunito font-black text-[16px] text-hive-rose">
                    −{formatCash(c.amountCents, cur)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
