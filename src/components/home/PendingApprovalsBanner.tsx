'use client';

// PendingApprovalsBanner — v4-final §02 Step 9 (locked 2026-05-18).
//
// Aggregator banner on the parent /home that surfaces every approval
// the parent has waiting across BOTH (a) the new Household
// purchaseRequests collection (all 5 modules: pantry/outdoor/drivers/
// utility/payroll) AND (b) the existing Hive (kid wallet) approvalRequests.
//
// Each row shows a "source" chip so the parent can tell at a glance
// what kind of approval it is, plus a short description + relative
// time + cents/honey amount. Tap → the matching detail page (purchase
// → /pantry/purchase/{id}; Hive → /parent/approvals).
//
// Renders nothing when there's nothing pending — keeps the home calm
// in the common case. Parent-only by construction (mount site checks
// role); component still no-ops if family hasn't loaded yet.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  subscribeToOpenRequests, MODULE_EMOJI, MODULE_LABEL,
  type PurchaseRequest,
} from '@/lib/purchase';
import type { ApprovalRequest } from '@/lib/hive';

const MAX_VISIBLE = 5;

// Map Hive approval type to short label for the source chip.
const HIVE_TYPE_LABEL: Record<string, string> = {
  hp_to_honey: 'HP → Honey',
  cash_out:    'Cash out',
  spend:       'Spend',
};

interface UnifiedRow {
  key: string;
  source: 'purchase' | 'hive';
  /** Source chip emoji (📦 Pantry, ⚡ Utility, 🍯 Hive, etc.) */
  chipEmoji: string;
  /** Source chip text label */
  chipLabel: string;
  /** Main line: title + short subtitle */
  title: string;
  subtitle: string;
  /** ms-since-epoch for sorting newest-first */
  createdAtMs: number;
  /** Where tapping the row goes. */
  href: string;
}

/** Humanise a recent timestamp. "just now / 5m / 2h / 3d". */
function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

/** Format cents → display string. Lightweight — uses Intl.NumberFormat
 *  with USD as the placeholder currency since this is a banner and the
 *  caller's currency context isn't passed in. Good enough for the
 *  glance; the detail page renders proper currency. */
function fmtCents(cents: number | undefined): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function PendingApprovalsBanner() {
  const router = useRouter();
  const { family, children } = useFamily();
  const { pendingApprovals: hivePending } = useHive();

  const [purchaseOpen, setPurchaseOpen] = useState<PurchaseRequest[]>([]);

  // Subscribe to all open requests for the family. We filter to
  // pending_approval client-side — cheap, and avoids needing a new
  // composite index just for the banner. The home page already pays
  // for a Hive subscription via HiveContext; this is one more.
  useEffect(() => {
    if (!family) return;
    const unsub = subscribeToOpenRequests(family.id, setPurchaseOpen);
    return () => unsub();
  }, [family]);

  // Build a unified row list, sorted newest-first.
  const rows = useMemo<UnifiedRow[]>(() => {
    const out: UnifiedRow[] = [];

    // Purchase requests — only pending_approval ones count as "waiting
    // on a parent". 'approved' means at least one parent has signed
    // off; 'draft' / 'reconciling' don't need approval action.
    for (const r of purchaseOpen) {
      if (r.status !== 'pending_approval') continue;
      const itemCount = r.items?.length ?? 0;
      const amount = fmtCents(r.estimatedTotalCents);
      const itemLabel = itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : null;
      const subtitle = [amount, itemLabel].filter(Boolean).join(' · ');
      out.push({
        key: `p:${r.id}`,
        source: 'purchase',
        chipEmoji: MODULE_EMOJI[r.module],
        chipLabel: MODULE_LABEL[r.module],
        title: r.name || `${MODULE_LABEL[r.module]} request`,
        subtitle: subtitle || 'No items',
        createdAtMs: r.createdAt?.toMillis?.() ?? 0,
        href: `/pantry/purchase/${r.id}`,
      });
    }

    // Hive approvals — pending ones from the kids' wallets.
    for (const a of hivePending) {
      const kid = children.find((c) => c.id === a.kidId);
      const kidName = kid?.name ?? 'Kid';
      const typeLabel = HIVE_TYPE_LABEL[a.type] ?? a.type;
      const amount = fmtCents(a.amountCents);
      const subtitle = amount
        ? `${kidName} · ${amount}`
        : kidName;
      out.push({
        key: `h:${a.id}`,
        source: 'hive',
        chipEmoji: '🍯',
        chipLabel: `Hive · ${typeLabel}`,
        title: a.description || `${typeLabel} request`,
        subtitle,
        createdAtMs: a.createdAt?.toMillis?.() ?? 0,
        href: '/parent/approvals',
      });
    }

    out.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return out;
  }, [purchaseOpen, hivePending, children]);

  // Nothing pending — render nothing. Keeps the home clean in the
  // common case; the parent only sees the banner when there's work.
  if (rows.length === 0) return null;

  const visible = rows.slice(0, MAX_VISIBLE);
  const overflow = rows.length - visible.length;

  return (
    <div className="bg-[#FFF3D9] border-2 border-hive-honey rounded-hive-lg p-3 lg:p-4 mb-5 lg:mb-6">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk inline-flex items-center gap-1.5">
          ✅ Approvals waiting · {rows.length}
        </p>
        <Link
          href="/parent/approvals"
          className="text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:underline"
        >
          Hive inbox →
        </Link>
      </div>
      <ul className="space-y-1.5">
        {visible.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => router.push(r.href)}
              className="w-full text-left bg-white hover:bg-hive-cream/60 border border-hive-line rounded-hive p-2.5 flex items-center gap-2.5 transition-colors"
            >
              <span
                className="text-[10px] font-nunito font-extrabold uppercase tracking-wider px-2 py-1 rounded-full bg-hive-cream border border-hive-line flex-shrink-0 inline-flex items-center gap-1"
                aria-label={r.chipLabel}
              >
                <span className="text-sm leading-none">{r.chipEmoji}</span>
                <span className="hidden sm:inline">{r.chipLabel}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-nunito font-extrabold text-[13px] text-hive-ink truncate">
                  {r.title}
                </p>
                <p className="text-[11px] text-hive-muted truncate">{r.subtitle}</p>
              </div>
              <span className="text-[10px] text-hive-muted font-bold flex-shrink-0">
                {timeAgo(r.createdAtMs)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {overflow > 0 && (
        <p className="text-[10px] text-hive-muted text-center mt-2 font-bold">
          + {overflow} more · open the matching module to see them
        </p>
      )}
    </div>
  );
}
