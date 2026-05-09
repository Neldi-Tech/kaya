'use client';

// /hive/wallet — three balance cards + Convert CTA + total worth footer.
// Read-only in PR-Hive-A.2; the Convert button leads to /hive/convert
// which is a placeholder for now and gets wired up in PR-Hive-B.

import Link from 'next/link';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import BalanceCard from '@/components/hive/BalanceCard';
import KidSwitcher from '@/components/hive/KidSwitcher';
import PendingRequestBanner from '@/components/hive/PendingRequestBanner';
import RatePill from '@/components/hive/RatePill';
import BackButton from '@/components/ui/BackButton';
import { formatCash, formatHoney, formatHp, honeyToCashCents } from '@/components/hive/format';

export default function WalletPage() {
  const { children } = useFamily();
  const { activeKidId, wallet, config, totalNetWorthCents, fxUsdToFamily } = useHive();
  const activeKid = children.find((c) => c.id === activeKidId);
  const fxRate = fxUsdToFamily ?? 1;

  const honeyAsCash = honeyToCashCents(wallet.honeyCoins, config.honeyToCashRate, fxRate);
  // HP "if cashed out" is a useful hint but more speculative — we mention
  // it lower with a "if you converted" caveat so kids don't read it as a
  // current cash value.
  const hpAsCash = config.hpToHoneyRate > 0
    ? Math.round((wallet.housePoints / config.hpToHoneyRate) * config.honeyToCashRate * fxRate * 100)
    : 0;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">
          {activeKid ? `${activeKid.name}'s Wallet` : 'Wallet'}
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1 leading-tight">
          My money 💰
        </h1>
      </div>

      <KidSwitcher />

      <PendingRequestBanner />

      {/* Three balance cards stacked. Each links to the matching ledger
          surface (HP → Rewards store, Honey → Convert, Cash → Cash In). */}
      <div className="space-y-2.5 mb-4">
        <BalanceCard
          variant="hp"
          value={formatHp(wallet.housePoints)}
          sub={`spend on rewards · ≈ ${formatCash(hpAsCash, config.currency)} if converted`}
          href="/rewards"
        />
        <BalanceCard
          variant="honey"
          value={(
            <>
              {formatHoney(wallet.honeyCoins)}
              <span className="ml-2 text-[13px] text-hive-muted font-bold">/ saved</span>
            </>
          )}
          sub={`≈ ${formatCash(honeyAsCash, config.currency)} if cashed out`}
          href="/hive/convert"
        />
        <BalanceCard
          variant="cash"
          value={formatCash(wallet.cashCents, config.currency)}
          sub="real money · spend with parent approval"
          href="/hive/cash-out"
        />
      </div>

      {/* Quick links to the cash ledgers, sitting under the balance cards. */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Link
          href="/hive/cash-in"
          className="rounded-hive border border-hive-line bg-hive-paper p-3 text-center font-nunito font-extrabold text-[12px] no-underline text-inherit hover:border-hive-honey transition-colors"
        >
          ⬇ Cash in
        </Link>
        <Link
          href="/hive/cash-out"
          className="rounded-hive border border-hive-line bg-hive-paper p-3 text-center font-nunito font-extrabold text-[12px] no-underline text-inherit hover:border-hive-honey transition-colors"
        >
          ⬆ Cash out
        </Link>
      </div>

      {/* Convert CTA — placeholder until PR-Hive-B */}
      <Link
        href="/hive/convert"
        className="block w-full bg-hive-honey hover:bg-hive-honey-dk text-white rounded-hive py-3.5 text-center font-nunito font-black text-sm transition-colors shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)] no-underline"
      >
        ⇄ Convert between layers
      </Link>

      <div className="mt-3 flex justify-center">
        <RatePill
          hpToHoneyRate={config.hpToHoneyRate}
          honeyToCashRate={config.honeyToCashRate}
          currency={config.currency}
          variant="both"
        />
      </div>

      {/* Total worth */}
      <p className="mt-5 text-center text-[12px] text-hive-muted">
        Total worth:{' '}
        <strong className="text-hive-navy">
          ~{formatCash(totalNetWorthCents, config.currency)}
        </strong>{' '}
        across all layers
      </p>
    </div>
  );
}
