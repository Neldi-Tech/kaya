'use client';

// /parent/approvals — pending request inbox. Reads pending requests from
// HiveContext (real-time across all kids in the family) and renders each
// as an ApprovalRequestCard.

import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';
import ApprovalRequestCard from '@/components/hive/ApprovalRequestCard';
import BackButton from '@/components/ui/BackButton';

export default function ParentApprovalsPage() {
  const { pendingApprovals } = useHive();

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Parent · The Hive</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1">Approvals</h1>
        </div>
        <Link href="/parent/rates" className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
          Rates →
        </Link>
      </div>

      {pendingApprovals.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-10 text-center">
          <div className="text-5xl mb-3">📭</div>
          <p className="font-nunito font-extrabold text-[15px]">Inbox zero</p>
          <p className="text-hive-muted text-sm mt-1">
            Nothing waiting on your approval. New requests show up here in real time.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingApprovals.map((r) => (
            <ApprovalRequestCard key={r.id} req={r} />
          ))}
        </div>
      )}
    </div>
  );
}
