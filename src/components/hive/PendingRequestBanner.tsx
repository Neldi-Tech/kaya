'use client';

// Compact summary of the kid's still-pending requests, surfaced at the
// top of the Wallet (and the Hive Home). Hidden when there are none.

import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';

export default function PendingRequestBanner({ href = '/hive/cash-out' }: { href?: string }) {
  const { myRequests } = useHive();
  const pending = myRequests.filter((r) => r.status === 'pending');
  if (pending.length === 0) return null;
  return (
    <Link
      href={href}
      className="block rounded-hive bg-hive-honey-soft border-2 border-dashed border-hive-honey px-4 py-3 mb-4 no-underline text-inherit hover:brightness-[1.02] transition"
    >
      <div className="flex items-center gap-3">
        <div className="text-2xl shrink-0">⏳</div>
        <div className="flex-1 min-w-0">
          <p className="font-nunito font-extrabold text-[13px] text-hive-honey-dk">
            {pending.length === 1
              ? '1 request waiting on parent'
              : `${pending.length} requests waiting on parent`}
          </p>
          <p className="text-[11px] text-hive-muted truncate">
            {pending[0].description}
          </p>
        </div>
        <span className="text-hive-honey-dk font-nunito font-extrabold text-[12px]">View →</span>
      </div>
    </Link>
  );
}
