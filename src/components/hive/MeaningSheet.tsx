'use client';

// 🍯 Meaning Sheet (HIVE PR3, approved v2 · D4/F8) — Elia's ④ exactly:
// tap a balance → 1st the MEANING (one canonical sentence, D1), 2nd the
// STORY — components + recent entries that sum to the number on screen,
// with a ✓ reconcile line and every linkable row drilling to its source.
// One sheet serves A·Money, B·Business and the Honey Pot; kids and parents
// see the identical view (D7). Compact header never blocks the numbers —
// first visit teaches, every visit informs.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';
import { useFamily } from '@/contexts/FamilyContext';
import { readPointSystemConfig } from '@/lib/firestore';
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
  const { family } = useFamily();
  // HIVEv5 PR2 — Routine → House Points rate (RP per 1 HP), shown in the ladder.
  const rpPerHp = Math.max(1, readPointSystemConfig(family).routines.pointsPerHousePoint);
  const [hpOpen, setHpOpen] = useState(false);

  const g = HIVE_GLOSSARY[kind === 'pot' ? 'pot' : kind];
  const coinsCents = honeyToCashCents(honeyCoins, honeyToCashRate, fxUsdToFamily);
  const hpCoins = hpToHoneyRate > 0 ? housePoints / hpToHoneyRate : 0;
  const hpCents = honeyToCashCents(hpCoins, honeyToCashRate, fxUsdToFamily);
  const moneyA = coinsCents + treasuryCents + cashCents + hpCents;
  const perCoinCents = honeyToCashCents(1, honeyToCashRate, fxUsdToFamily);

  // ≈ cash value of an HP amount, for dual (money-on-top) display.
  const hpToCents = (hp: number) =>
    honeyToCashCents(hpToHoneyRate > 0 ? hp / hpToHoneyRate : 0, honeyToCashRate, fxUsdToFamily);

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

  // HIVEv5 PR2 — Points (⭐ HP) move to the BOTTOM of the Money sheet: real
  // money (Pot/Cash/Coins) leads, HP reads last as "potential value" and is
  // expandable (Elia ①). Every row is amount-on-top: money big, the count is
  // commentary underneath (Elia ②, one consistent style).
  const components: { icon: string; label: string; count?: string; amount: string; layer?: string; expandable?: boolean }[] =
    kind === 'money' ? [
      { icon: '🍯', label: 'Honey Pot', count: 'money in hand', amount: formatCash(treasuryCents, currency), layer: 'treasury' },
      { icon: '💵', label: 'Cash', amount: formatCash(cashCents, currency), layer: 'cash' },
      { icon: '🪙', label: 'Honey Coins', count: `${formatHoney(honeyCoins)} Coins`, amount: formatCash(coinsCents, currency), layer: 'honey' },
      { icon: '⭐', label: 'House Points · potential value', count: `${formatHp(housePoints)} HP · if converted`, amount: `≈ ${formatCash(hpCents, currency)}`, expandable: true },
    ] : kind === 'business' ? [
      { icon: '📦', label: 'What your business owns', count: 'stock + tools + its money', amount: formatCash(businessAssetsCents, currency) },
    ] : [
      { icon: '🍯', label: 'In your Pot right now', amount: formatCash(treasuryCents, currency), layer: 'treasury' },
    ];

  // ⭐ HP story — awards (in) + conversions, dual-valued, RP origin noted.
  const hpStory = transactions
    .filter((t) => t.status === 'completed' && (t.layer === 'house_points' || (t.layer === 'honey' && t.category === 'convert')))
    .slice(0, 6);
  const isRoutine = (t: HiveTransaction) => /routine|excellent|good week/i.test(t.description || '');
  const rung = (ico: string, title: string, sub: string, bg: string, border: string) => (
    <div className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2" style={{ background: bg, borderColor: border }}>
      <span className="text-lg shrink-0">{ico}</span>
      <div className="min-w-0"><p className="font-nunito font-black text-[12px]">{title}</p><p className="text-[10px] text-hive-muted font-bold leading-snug">{sub}</p></div>
    </div>
  );
  const rateArrow = (rate: string, where: string, href: string) => (
    <div className="text-center py-1">
      <span className="inline-block bg-hive-cream border border-dashed border-hive-honey-soft rounded-full px-2.5 py-0.5 text-[10px] font-nunito font-black text-hive-honey-dk">{rate}</span>
      <Link href={href} onClick={onClose} className="block text-[9.5px] font-nunito font-bold text-[#7B61FF] mt-0.5 no-underline hover:underline">{where} ›</Link>
    </div>
  );

  if (!open) return null;

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
            {components.map((c) => {
              // Amount on top, count/commentary beneath — one consistent style.
              const inner = (
                <div className="flex items-center gap-2.5 py-2.5 border-b border-hive-line last:border-b-0">
                  <span className="text-base">{c.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-nunito font-extrabold text-[12.5px]">{c.label}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-nunito font-black text-[12.5px]">{c.amount}</p>
                    {c.count && <p className="text-[10px] text-hive-muted font-bold">{c.count}</p>}
                  </div>
                  {(c.layer || c.expandable) && <span className="text-hive-honey-dk font-black text-[11px] ml-1">{c.expandable ? (hpOpen ? '▾' : '▸') : '›'}</span>}
                </div>
              );
              if (c.expandable) {
                return (
                  <div key={c.label}>
                    <button type="button" onClick={() => setHpOpen((o) => !o)} className="w-full text-left block hover:bg-hive-cream/50 -mx-3 px-3">
                      {inner}
                    </button>
                    {hpOpen && (
                      <div className="pb-3 -mt-1">
                        {/* ⭐ HP story — dual-valued (money on top, count below). */}
                        {hpStory.length > 0 && (
                          <div className="rounded-lg bg-[#FDFAF2] border border-hive-line px-2.5 py-1.5 mb-2">
                            {hpStory.map((t) => {
                              const conv = t.layer === 'honey' && t.category === 'convert';
                              const hp = conv ? t.amount * hpToHoneyRate : t.amount;
                              const money = formatCash(hpToCents(hp), currency);
                              return (
                                <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-hive-line/60 last:border-b-0">
                                  <span className="text-sm shrink-0">{conv ? '⇄' : isRoutine(t) ? '🌟' : '🎖️'}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-nunito font-extrabold text-[11.5px] truncate">{t.description}</p>
                                    <p className="text-[9.5px] text-hive-muted font-bold">{conv ? 'converted to Coins' : isRoutine(t) ? `from routines · ${(hp * rpPerHp).toLocaleString('en-US')} RP → ${formatHp(hp)} HP` : 'from a parent'}</p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="font-nunito font-black text-[11.5px]" style={{ color: conv ? '#8A8471' : '#2E7D4F' }}>{conv ? '≈ ' : '+'}{money}</p>
                                    <p className="text-[9px] text-hive-muted font-bold">{conv ? `−${formatHp(hp)} HP → +${formatHoney(t.amount)} 🪙` : `+${formatHp(hp)} HP`}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {/* The conversion ladder — the whole answer, one place. */}
                        <p className="text-[9.5px] font-nunito font-black uppercase tracking-[1.5px] text-hive-muted mb-1.5">How points become money</p>
                        {rung('🌟', 'Behaviour / routines', 'Rated routines earn Routine Points; they auto-convert to a House Point at the threshold.', '#fff', '#E8E0CF')}
                        {rateArrow(`${rpPerHp.toLocaleString('en-US')} RP = 1 HP`, '📋 your family’s setting · change in Settings', '/settings')}
                        {rung('⭐', 'House Points · your effort score', 'parent-given points arrive here directly', '#EEF2FA', '#CCD6EA')}
                        {rateArrow(`${hpToHoneyRate.toLocaleString('en-US')} HP = 1 🪙`, 'change in Rates', '/parent/rates')}
                        {rung('🪙', 'Honey Coins', 'your in-Kaya money', '#FFF3D9', '#F7D9A3')}
                        {rateArrow(`1 🪙 = ${formatCash(perCoinCents, currency)}`, 'change in Rates', '/parent/rates')}
                        {rung('💵', 'Cash / Honey Pot', 'real money you spend', '#E7F5EC', '#bfe0cc')}
                      </div>
                    )}
                  </div>
                );
              }
              return c.layer ? (
                <Link key={c.label} href={`/hive/statement?layer=${c.layer}`} onClick={onClose} className="block no-underline text-inherit hover:bg-hive-cream/50 -mx-3 px-3">
                  {inner}
                </Link>
              ) : (
                <div key={c.label}>{inner}</div>
              );
            })}
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
                      {/* Amount on top; for points, the count reads as commentary. */}
                      <div className="text-right shrink-0">
                        {t.layer === 'house_points' ? (
                          <>
                            <p className={`font-nunito font-black text-[12px] ${t.direction === 'in' ? 'text-hive-green' : 'text-hive-rose'}`}>{t.direction === 'in' ? '+' : '−'}{formatCash(hpToCents(t.amount), currency)}</p>
                            <p className="text-[9px] text-hive-muted font-bold">{t.direction === 'in' ? '+' : '−'}{formatHp(t.amount)} HP</p>
                          </>
                        ) : (
                          <p className={`font-nunito font-black text-[12px] ${t.direction === 'in' ? 'text-hive-green' : 'text-hive-rose'}`}>{fmtAmount(t)}</p>
                        )}
                      </div>
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
