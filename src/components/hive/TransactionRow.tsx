'use client';

// Single ledger entry. In/out variants colour the icon background and
// the amount per the v2 mockup (mint for in, rose for out).

import type { HiveTransaction } from '@/lib/hive';
import { formatCash, formatHoney, formatHp } from './format';

const CATEGORY_ICON: Record<string, string> = {
  chore: '🧹',
  quest: '🏆',
  award: '🎖️',
  convert: '⇄',
  allowance: '💵',
  gift: '🎁',
  business: '🌳',
  interest: '🐝',
  spend: '🛒',
  donation: '❤️',
  other: '✨',
};

// HIVE PR1 — layer badges with names, per the approved Hive Clarity design.
const LAYER_LABEL: Record<HiveTransaction['layer'], string> = {
  house_points: '⭐ HP',
  honey: '🪙 Coins',
  treasury: '🍯 Pot',
  cash: '💵 Cash',
};

export default function TransactionRow({
  tx,
  currency = 'USD',
  showLayerBadge = false,
}: {
  tx: HiveTransaction;
  currency?: string;
  /** Show a small "HP" / "🍯" / "$" badge — useful on the Hive Home where
   *  all layers share one feed. */
  showLayerBadge?: boolean;
}) {
  const icon = CATEGORY_ICON[tx.category] || CATEGORY_ICON.other;
  const isIn = tx.direction === 'in';
  const amountText = (() => {
    const sign = isIn ? '+' : '−';
    // HIVE PR1 (confirmed bug): treasury (the Honey Pot) holds MONEY in
    // family-currency cents — it fell into the HP fallback and printed
    // sale proceeds as "+100,000 HP". Money now always reads as money.
    if (tx.layer === 'cash' || tx.layer === 'treasury') return `${sign}${formatCash(tx.amount, currency)}`;
    if (tx.layer === 'honey') return `${sign}${formatHoney(tx.amount)} HC`;
    return `${sign}${formatHp(tx.amount)} HP`;
  })();
  const dateLine = (() => {
    const ts = (tx.createdAt as any)?.toMillis?.();
    if (typeof ts !== 'number') return '';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  })();
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-hive-line last:border-b-0">
      <div className={`w-[34px] h-[34px] rounded-[11px] flex items-center justify-center text-base shrink-0 ${
        isIn ? 'bg-[#E6F7EE]' : 'bg-[#FCEAEA]'
      }`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-nunito font-extrabold text-[13px] leading-tight truncate">{tx.description}</p>
        <p className="text-[10px] text-hive-muted mt-0.5">
          {dateLine}
          {showLayerBadge && (
            <span className="ml-2 text-hive-honey-dk font-bold">· {LAYER_LABEL[tx.layer]}</span>
          )}
        </p>
      </div>
      <span className={`font-nunito font-black text-[13px] shrink-0 ${isIn ? 'text-hive-green' : 'text-hive-rose'}`}>
        {amountText}
      </span>
    </div>
  );
}
