'use client';

// 🍯 Meaning Sheet (HIVE PR3, approved v2 · D4/F8) — Elia's ④ exactly:
// tap a balance → 1st the MEANING (one canonical sentence, D1), 2nd the
// STORY — components + recent entries that sum to the number on screen,
// with a ✓ reconcile line and every linkable row drilling to its source.
// One sheet serves A·Money, B·Business and the Honey Pot; kids and parents
// see the identical view (D7). Compact header never blocks the numbers —
// first visit teaches, every visit informs.

import { useMemo } from 'react';
import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';
import { HIVE_GLOSSARY } from '@/lib/hiveGlossary';
import type { HiveTransaction } from '@/lib/hive';
import { formatCash, formatHoney, formatHp, honeyToCashCents } from './format';

export type MeaningKind = 'money' | 'business' | 'pot';

export default function MeaningSheet({
  kind, open, onClose,
  treasuryCents, honeyCoins, housePoints, cashCents,
  businessAssetsCents = 0,
  hpToHoneyRate = 1, honeyToCashRate = 1, fxUsdToFamily = 1,
  currency = 'USD',
}: {
  kind: MeaningKind;
  open: boolean;
  onClose: () => void;
  treasuryCents: number;
  honeyCoins: number;
  housePoints: number;
  cashCents: number;
  businessAssetsCents?: number;
  hpToHoneyRate?: number;
  honeyToCashRate?: number;
  fxUsdToFamily?: number;
  currency?: string;
}) {
  const { transactions } = useHive();

  const g = HIVE_GLOSSARY[kind === 'pot' ? 'pot' : kind];
  const coinsCents = honeyToCashCents(honeyCoins, honeyToCashRate, fxUsdToFamily);
  const hpCoins = hpToHoneyRate > 0 ? housePoints / hpToHoneyRate : 0;
  const hpCents = honeyToCashCents(hpCoins, honeyToCashRate, fxUsdToFamily);
  const moneyA = coinsCents + treasuryCents + cashCents + hpCents;

  // The story — entries relevant to this surface, newest first.
  const story = useMemo(() => {
    const completed = transactions.filter((t) => t.status === 'completed');
    if (kind === 'pot') return completed.filter((t) => t.layer === 'treasury').slice(0, 6);
    if (kind === 'business') return completed.filter((t) => t.category === 'business').slice(0, 6);
    return completed.slice(0, 6);
  }, [transactions, kind]);

  const fmtAmount = (t: HiveTransaction) => {
    const sign = t.direction === 'in' ? '+' : '−';
    if (t.layer === 'cash' || t.layer === 'treasury') return `${sign}${formatCash(t.amount, currency)}`;
    if (t.layer === 'honey') return `${sign}${formatHoney(t.amount)} HC`;
    return `${sign}${formatHp(t.amount)} HP`;
  };
  const linkFor = (t: HiveTransaction): string | null =>
    (t.category === 'business' && t.refId ? `/business/${t.refId}/history` : null);

  if (!open) return null;

  const components: { icon: string; label: string; sub?: string; amount: string }[] =
    kind === 'money' ? [
      { icon: '⭐', label: `House Points · ${formatHp(housePoints)}`, sub: 'at today’s rates', amount: formatCash(hpCents, currency) },
      { icon: '🪙', label: `Honey Coins · ${formatHoney(honeyCoins)}`, amount: formatCash(coinsCents, currency) },
      { icon: '🍯', label: 'Honey Pot', amount: formatCash(treasuryCents, currency) },
      { icon: '💵', label: 'Cash', amount: formatCash(cashCents, currency) },
    ] : kind === 'business' ? [
      { icon: '📦', label: 'What your business owns', sub: 'stock + tools + its money', amount: formatCash(businessAssetsCents, currency) },
    ] : [
      { icon: '🍯', label: 'In your Pot right now', amount: formatCash(treasuryCents, currency) },
    ];

  const reconcile =
    kind === 'money' ? `✓ Adds up to A · Money: ${formatCash(moneyA, currency)}`
    : kind === 'business' ? `✓ B · Business today: ${formatCash(businessAssetsCents, currency)}`
    : `✓ That's your Pot today: ${formatCash(treasuryCents, currency)}`;

  return (
    <>
      <div className="fixed inset-0 bg-hive-navy/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-hive-paper rounded-t-3xl shadow-2xl z-50 pb-8 pt-2 max-h-[85vh] overflow-y-auto">
        <div className="flex justify-center pt-1 pb-2">
          <div className="w-12 h-1 rounded-full bg-hive-line"></div>
        </div>
        <div className="px-4">
          {/* 1st — the meaning (D1, compact so it never blocks). */}
          <div className="rounded-xl bg-[#EEF2FA] border border-[#CCD6EA] px-3 py-2.5 mb-3">
            <p className="font-nunito font-black text-[13.5px] text-hive-navy">{g.emoji} {g.name}</p>
            <p className="text-[12px] font-bold mt-0.5 leading-relaxed" style={{ color: '#42506B' }}>{g.def}</p>
          </div>

          {/* 2nd — what makes the number. */}
          <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px] text-hive-muted mb-1.5">
            {kind === 'money' ? 'What makes your Money' : kind === 'business' ? 'What it holds' : 'Right now'}
          </p>
          <div className="bg-white border border-hive-line rounded-hive px-3 mb-3">
            {components.map((c) => (
              <div key={c.label} className="flex items-center gap-2.5 py-2.5 border-b border-hive-line last:border-b-0">
                <span className="text-base">{c.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-nunito font-extrabold text-[12.5px]">{c.label}</p>
                  {c.sub && <p className="text-[10px] text-hive-muted font-bold">{c.sub}</p>}
                </div>
                <span className="font-nunito font-black text-[12.5px]">{c.amount}</span>
              </div>
            ))}
          </div>

          {/* …then the recent story, each row linking onward when it can. */}
          {story.length > 0 && (
            <>
              <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px] text-hive-muted mb-1.5">Recent story</p>
              <div className="bg-white border border-hive-line rounded-hive px-3 mb-3">
                {story.map((t) => {
                  const href = linkFor(t);
                  const inner = (
                    <div className="flex items-center gap-2.5 py-2.5 border-b border-hive-line last:border-b-0">
                      <div className={`w-[30px] h-[30px] rounded-[10px] flex items-center justify-center text-sm shrink-0 ${t.direction === 'in' ? 'bg-[#E6F7EE]' : 'bg-[#FCEAEA]'}`}>
                        {t.category === 'business' ? '🌳' : t.category === 'convert' ? '⇄' : t.category === 'spend' ? '🛒' : '✨'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-nunito font-extrabold text-[12px] truncate">{t.description}</p>
                        {href && <p className="text-[10px] text-hive-honey-dk font-bold">open the sale ›</p>}
                      </div>
                      <span className={`font-nunito font-black text-[12px] shrink-0 ${t.direction === 'in' ? 'text-hive-green' : 'text-hive-rose'}`}>
                        {fmtAmount(t)}
                      </span>
                    </div>
                  );
                  return href
                    ? <Link key={t.id} href={href} className="block no-underline text-inherit hover:bg-hive-cream/50 -mx-3 px-3">{inner}</Link>
                    : <div key={t.id}>{inner}</div>;
                })}
              </div>
            </>
          )}

          {/* Trust by arithmetic (F4). */}
          <div className="rounded-hive border border-[#bfe0cc] bg-[#E7F5EC] px-3 py-2.5 mb-3">
            <p className="font-nunito font-black text-[12.5px] text-pantry-leaf-dk">{reconcile}</p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/hive/statement"
              className="flex-1 text-center bg-hive-honey text-white font-nunito font-black text-[13px] rounded-xl py-2.5 no-underline"
            >
              📜 Open my full statement →
            </Link>
            {kind === 'business' && (
              <Link
                href="/business"
                className="flex-1 text-center bg-white border border-hive-honey text-hive-honey-dk font-nunito font-black text-[13px] rounded-xl py-2.5 no-underline"
              >
                🏪 My business →
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
