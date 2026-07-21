'use client';

// /hive/statement — 📜 the kid's bank statement (HIVE PR2, approved v2).
//
// The full story behind the balances: every completed ledger entry, grouped
// by local day (DD-Mmm-YYYY), with a PER-LAYER running balance (F7 — the
// Hive spans three units; summing HP with TZS would be nonsense math) and a
// reconciliation footer (F4): closing balances equal the wallet on screen,
// with an honest "brought forward" line for history beyond this window (F6).
// Business rows drill down to their sale history (F5/refId); layer chips
// filter to one clean story. "See all" on the Hive home lands here.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  subscribeToHiveTransactions,
  type HiveTransaction, type HiveLayer,
} from '@/lib/hive';
import { formatCash, formatHoney, formatHp } from '@/components/hive/format';
import { toDisplayDate } from '@/lib/dates';

const LAYERS: { key: 'all' | HiveLayer; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'house_points', label: '⭐ HP' },
  { key: 'honey', label: '🪙 Coins' },
  { key: 'treasury', label: '🍯 Pot' },
  { key: 'cash', label: '💵 Cash' },
];

const CATEGORY_ICON: Record<string, string> = {
  chore: '🧹', quest: '🏆', award: '🎖️', convert: '⇄', allowance: '💵',
  gift: '🎁', business: '🌳', spend: '🛒', donation: '❤️', other: '✨',
};

const dayKeyOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function HiveStatementPage() {
  const { profile } = useAuth();
  const { activeKidId, wallet, config } = useHive();
  const familyId = profile?.familyId;
  const [txs, setTxs] = useState<HiveTransaction[]>([]);
  const [layer, setLayer] = useState<'all' | HiveLayer>('all');
  const [loading, setLoading] = useState(true);

  // Own subscription with a deeper window than the home feed (200 entries).
  useEffect(() => {
    if (!familyId || !activeKidId) return;
    setLoading(true);
    const unsub = subscribeToHiveTransactions(familyId, activeKidId, (t) => {
      setTxs(t);
      setLoading(false);
    }, 200);
    return unsub;
  }, [familyId, activeKidId]);

  const currency = config.currency;

  // Completed entries only — pending approvals don't move balances, so they
  // don't belong on a statement.
  const completed = useMemo(() => txs.filter((t) => t.status === 'completed'), [txs]);

  // Per-layer running balances, bank-statement style: start from the wallet
  // TODAY and walk newest→oldest, so each row shows the balance AFTER it —
  // and closing always reconciles to the screen by construction. Whatever
  // remains after the walk is the honest "brought forward" (F6).
  const { rows, broughtForward } = useMemo(() => {
    const run: Record<HiveLayer, number> = {
      house_points: wallet.housePoints || 0,
      honey: wallet.honeyCoins || 0,
      treasury: wallet.treasuryCents || 0,
      cash: wallet.cashCents || 0,
    };
    const out = completed.map((t) => {
      const after = run[t.layer];
      run[t.layer] = after - (t.direction === 'in' ? t.amount : -t.amount);
      return { tx: t, after };
    });
    return { rows: out, broughtForward: { ...run } };
  }, [completed, wallet]);

  const filtered = useMemo(
    () => (layer === 'all' ? rows : rows.filter((r) => r.tx.layer === layer)),
    [rows, layer],
  );

  // Group by local day, newest first (rows already ordered desc).
  const groups = useMemo(() => {
    const out: { key: string; rows: typeof filtered }[] = [];
    filtered.forEach((r) => {
      const ms = (r.tx.createdAt as { toMillis?: () => number })?.toMillis?.();
      const key = typeof ms === 'number' ? dayKeyOf(ms) : 'unknown';
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(r);
      else out.push({ key, rows: [r] });
    });
    return out;
  }, [filtered]);

  const fmtAmount = (t: HiveTransaction) => {
    const sign = t.direction === 'in' ? '+' : '−';
    if (t.layer === 'cash' || t.layer === 'treasury') return `${sign}${formatCash(t.amount, currency)}`;
    if (t.layer === 'honey') return `${sign}${formatHoney(t.amount)} HC`;
    return `${sign}${formatHp(t.amount)} HP`;
  };
  const fmtBalance = (l: HiveLayer, v: number) => {
    if (l === 'cash') return `Cash: ${formatCash(v, currency)}`;
    if (l === 'treasury') return `Pot: ${formatCash(v, currency)}`;
    if (l === 'honey') return `Coins: ${formatHoney(v)}`;
    return `HP: ${formatHp(v)}`;
  };
  const linkFor = (t: HiveTransaction): string | null => {
    if (t.category === 'business' && t.refId) return `/business/${t.refId}/history`;
    return null;
  };

  const anyBeyondWindow = txs.length >= 200
    || Object.values(broughtForward).some((v) => v !== 0);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <Link href="/hive" className="text-[12px] text-hive-honey-dk font-nunito font-bold no-underline hover:underline inline-block mb-2">
        ← The Hive
      </Link>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="font-nunito font-black text-2xl lg:text-[32px] tracking-tight">📜 My Statement</h1>
      </div>
      <p className="text-hive-muted text-sm mb-3">
        Every move of your money — day by day, with your balance after each one.
      </p>

      {/* Layer chips (F7) */}
      <div className="flex gap-1.5 flex-wrap mb-4">
        {LAYERS.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => setLayer(l.key)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-nunito font-extrabold border transition-colors ${
              layer === l.key
                ? 'bg-hive-honey text-white border-hive-honey-dk'
                : 'bg-white text-hive-muted border-hive-line hover:border-hive-honey'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-hive-muted font-bold">Loading your story…</p>}
      {!loading && filtered.length === 0 && (
        <div className="bg-hive-paper border border-dashed border-hive-line rounded-hive p-6 text-center">
          <div className="text-2xl mb-1">🌱</div>
          <p className="font-nunito font-extrabold text-sm">Nothing here yet</p>
          <p className="text-[12px] text-hive-muted font-bold mt-1">
            Earn House Points or make a sale — your story starts with the first entry.
          </p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key}>
          <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px] text-hive-muted mt-4 mb-1.5">
            {g.key === 'unknown' ? 'Earlier' : toDisplayDate(g.key) || g.key}
          </p>
          <div className="bg-hive-paper border border-hive-line rounded-hive px-3">
            {g.rows.map(({ tx, after }) => {
              const href = linkFor(tx);
              const inner = (
                <div className="flex items-center gap-2.5 py-2.5 border-b border-hive-line last:border-b-0">
                  <div className={`w-[34px] h-[34px] rounded-[11px] flex items-center justify-center text-base shrink-0 ${
                    tx.direction === 'in' ? 'bg-[#E6F7EE]' : 'bg-[#FCEAEA]'
                  }`}>
                    {CATEGORY_ICON[tx.category] || '✨'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-nunito font-extrabold text-[13px] leading-tight truncate">{tx.description}</p>
                    <p className="text-[10px] text-hive-muted mt-0.5">
                      {LAYERS.find((l) => l.key === tx.layer)?.label}
                      {href ? ' · tap to open the sale ›' : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-nunito font-black text-[13px] ${tx.direction === 'in' ? 'text-hive-green' : 'text-hive-rose'}`}>
                      {fmtAmount(tx)}
                    </p>
                    <p className="text-[9.5px] text-hive-muted font-bold">{fmtBalance(tx.layer, after)}</p>
                  </div>
                </div>
              );
              return href ? (
                <Link key={tx.id} href={href} className="block no-underline text-inherit hover:bg-hive-cream/50 -mx-3 px-3">
                  {inner}
                </Link>
              ) : (
                <div key={tx.id}>{inner}</div>
              );
            })}
          </div>
        </div>
      ))}

      {!loading && filtered.length > 0 && (
        <>
          {anyBeyondWindow && (
            <p className="text-[11px] text-hive-muted font-bold mt-3 text-center">
              ⏮ Brought forward (before this statement): ⭐ {formatHp(broughtForward.house_points)} ·
              🪙 {formatHoney(broughtForward.honey)} · 🍯 {formatCash(broughtForward.treasury, currency)} ·
              💵 {formatCash(broughtForward.cash, currency)}
            </p>
          )}
          {/* Reconciliation footer (F4) — closing = the wallet, always. */}
          <div className="mt-3 rounded-hive border border-[#bfe0cc] bg-[#E7F5EC] px-4 py-3">
            <p className="font-nunito font-black text-[13px] text-pantry-leaf-dk">✓ These add up to your balances today</p>
            <p className="text-[11.5px] text-hive-muted font-bold mt-0.5">
              ⭐ {formatHp(wallet.housePoints || 0)} HP · 🪙 {formatHoney(wallet.honeyCoins || 0)} ·
              🍯 {formatCash(wallet.treasuryCents || 0, currency)} · 💵 {formatCash(wallet.cashCents || 0, currency)}
              {' '}— exactly what your wallet shows.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
