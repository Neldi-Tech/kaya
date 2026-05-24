'use client';

// Layer-aware balance card matching section 2 of the v2 mockup. Three
// gradients (cool blue-grey for HP, honey for Honey, mint for Cash) with
// matching icon, label, value, sub-line and a chevron.

import Link from 'next/link';
import type { ReactNode } from 'react';
import HoneyCoin from './HoneyCoin';

type Variant = 'hp' | 'honey' | 'cash';

const VARIANTS: Record<Variant, { bg: string; border: string; icon: string; lbl: string }> = {
  hp: {
    bg: 'bg-gradient-to-br from-[#E5EBF3] to-[#F4F7FB]',
    border: 'border-[#D5DEE9]',
    icon: '⭐',
    lbl: 'House Points',
  },
  honey: {
    bg: 'bg-gradient-to-br from-[#FFF3D9] to-hive-honey-soft',
    border: 'border-hive-honey',
    icon: '🍯',
    lbl: 'Honey Coins',
  },
  cash: {
    bg: 'bg-gradient-to-br from-[#E6F7EE] to-[#C9EBD7]',
    border: 'border-[#8FD3AB]',
    icon: '💵',
    lbl: 'Cash',
  },
};

export default function BalanceCard({
  variant,
  value,
  sub,
  href,
  rightSlot,
}: {
  variant: Variant;
  /** Pre-formatted main value (e.g. "1,240" or "$42.50"). */
  value: ReactNode;
  /** Small caption under the value. */
  sub?: ReactNode;
  /** When set, the whole card becomes a Link. */
  href?: string;
  /** Optional override for the right-edge content (defaults to › chevron). */
  rightSlot?: ReactNode;
}) {
  const v = VARIANTS[variant];
  const inner = (
    <>
      <div className="w-[46px] h-[46px] rounded-[14px] bg-white/60 flex items-center justify-center text-2xl shrink-0">
        {variant === 'honey' ? <HoneyCoin size={30} /> : v.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-[2px] font-bold text-hive-muted">{v.lbl}</p>
        <p className="font-nunito font-black text-[22px] leading-none mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-hive-muted font-bold mt-1">{sub}</p>}
      </div>
      {rightSlot ?? (href ? <span className="text-lg text-hive-muted">›</span> : null)}
    </>
  );
  const cls = `relative overflow-hidden rounded-hive border ${v.bg} ${v.border} px-4 py-3.5 flex items-center gap-3.5 ${
    href ? 'hover:brightness-[1.02] transition' : ''
  }`;
  return href ? (
    <Link href={href} className={`${cls} no-underline text-inherit`}>{inner}</Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
