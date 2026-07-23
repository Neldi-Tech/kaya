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
  subscribeToHiveTransactions, correctWalletTx, PLAN_CATEGORIES,
  type HiveTransaction, type HiveLayer, type TxCategory,
} from '@/lib/hive';
import { DEPOSIT_BUILTINS } from '@/lib/moneyBuddy';
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
  shopping: '🛒', books: '📚', treats: '🍦', savings: '🍯', interest: '🐝',
};

// ✏️ Which rows the fix sheet accepts: money rows only, not transfers
// (two linked halves), not ↩️ reversals (fix the repost instead).
const isFixable = (t: HiveTransaction): boolean =>
  (t.layer === 'treasury' || t.layer === 'cash')
  && t.category !== 'convert'
  && t.correctionKind !== 'reversal';

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

  // HIVEv5 PR1 — deep-link pre-filter: /hive/statement?layer=treasury lands
  // straight on the Pot's own story (from the meaning sheet, Pot hero, wallet
  // cards). Read once from the URL; the chips take over after.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('layer');
    if (q && (['house_points', 'honey', 'treasury', 'cash'] as const).includes(q as HiveLayer)) {
      setLayer(q as HiveLayer);
    }
  }, []);

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

  // HIVEv5 PR1 — LAST-30-DAYS window with an exact ⏮ earlier-months carry
  // (Elia ③): show the last 30 days individually, and summarise everything
  // before as one per-layer line. The math is exact by construction — we
  // anchor to the real wallet and walk newest→oldest, so `earlier` = the
  // balance at the 30-day boundary = wallet − Σ(window effects). Thus
  // earlier + listed = the total, to the cent.
  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const { rows, earlier, hasEarlier } = useMemo(() => {
    const run: Record<HiveLayer, number> = {
      house_points: wallet.housePoints || 0,
      honey: wallet.honeyCoins || 0,
      treasury: wallet.treasuryCents || 0,
      cash: wallet.cashCents || 0,
    };
    const cutoff = Date.now() - WINDOW_MS;
    const win: { tx: HiveTransaction; after: number }[] = [];
    let older = false;
    for (const t of completed) {
      const ms = (t.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
      if (ms >= cutoff) {
        const after = run[t.layer];
        run[t.layer] = after - (t.direction === 'in' ? t.amount : -t.amount);
        win.push({ tx: t, after });
      } else {
        older = true;
        break; // rows are newest→oldest; once we cross the boundary we stop.
        // `run` now holds the balance BEFORE the window = the earlier carry.
      }
    }
    const carry = { ...run };
    const hasEarlier = older || txs.length >= 200 || Object.values(carry).some((v) => v !== 0);
    return { rows: win, earlier: carry, hasEarlier };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed, wallet, txs.length]);

  const filtered = useMemo(
    () => (layer === 'all' ? rows : rows.filter((r) => r.tx.layer === layer)),
    [rows, layer],
  );

  // ✏️ Corrections (parent-only) — deposits AND spends. Originals that have
  // been corrected stay on the book (immutable) but render dimmed with a
  // "corrected ↩️" note; the repost carries the fixed details.
  const isParentUser = profile?.role === 'parent';
  const correctedIds = useMemo(
    () => new Set(
      txs.filter((t) => t.correctionKind === 'reversal' && t.correctsTxId)
        .map((t) => t.correctsTxId as string),
    ),
    [txs],
  );
  const [fixTx, setFixTx] = useState<HiveTransaction | null>(null);
  const [fixPocket, setFixPocket] = useState<'treasury' | 'cash'>('cash');
  const [fixCategory, setFixCategory] = useState<TxCategory>('other');
  const [fixDesc, setFixDesc] = useState('');
  const [fixSaving, setFixSaving] = useState(false);
  const [fixError, setFixError] = useState('');
  const openFix = (t: HiveTransaction) => {
    setFixTx(t);
    setFixPocket(t.layer === 'treasury' ? 'treasury' : 'cash');
    setFixCategory(t.category);
    setFixDesc(t.description || '');
    setFixError('');
  };
  const saveFix = async () => {
    if (!familyId || !activeKidId || !fixTx) return;
    setFixError('');
    setFixSaving(true);
    try {
      await correctWalletTx(familyId, activeKidId, fixTx.id, {
        pocket: fixPocket, category: fixCategory, description: fixDesc,
      }, profile!.uid);
      setFixTx(null);
    } catch (e: any) {
      setFixError(e?.message || 'Couldn’t save the correction.');
    }
    setFixSaving(false);
  };
  // Deposit rows pick from deposit categories; spend rows from spend chips.
  const fixChips = fixTx?.direction === 'in'
    ? DEPOSIT_BUILTINS.map((c) => ({ id: c.txCategory, emoji: c.emoji, label: c.label }))
    : PLAN_CATEGORIES.filter((c) => c.id !== 'savings');

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

  // Per-layer earlier-months summary text, respecting the active filter.
  const earlierText = (() => {
    if (layer === 'house_points') return `⭐ ${formatHp(earlier.house_points)} HP`;
    if (layer === 'honey') return `🪙 ${formatHoney(earlier.honey)}`;
    if (layer === 'treasury') return `🍯 ${formatCash(earlier.treasury, currency)}`;
    if (layer === 'cash') return `💵 ${formatCash(earlier.cash, currency)}`;
    return `⭐ ${formatHp(earlier.house_points)} HP · 🪙 ${formatHoney(earlier.honey)} · 🍯 ${formatCash(earlier.treasury, currency)} · 💵 ${formatCash(earlier.cash, currency)}`;
  })();

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

      {!loading && (filtered.length > 0 || hasEarlier) && (
        <p className="text-[11px] font-nunito font-extrabold text-hive-honey-dk mb-1">Showing the last 30 days</p>
      )}
      {/* ⏮ Earlier months — exact per-unit carry so listed + earlier = total. */}
      {!loading && hasEarlier && (
        <div className="rounded-hive border border-dashed border-hive-honey-soft bg-hive-cream px-3 py-2 mb-2 flex items-center gap-2">
          <span className="text-base shrink-0">⏮</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-nunito font-black text-hive-honey-dk">Earlier months</p>
            <p className="text-[10.5px] text-hive-muted font-bold">{earlierText}</p>
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-hive-muted font-bold">Loading your story…</p>}
      {!loading && filtered.length === 0 && !hasEarlier && (
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
              const wasCorrected = correctedIds.has(tx.id);
              const inner = (
                <div className={`flex items-center gap-2.5 py-2.5 border-b border-hive-line last:border-b-0 ${wasCorrected ? 'opacity-50' : ''}`}>
                  <div className={`w-[34px] h-[34px] rounded-[11px] flex items-center justify-center text-base shrink-0 ${
                    tx.direction === 'in' ? 'bg-[#E6F7EE]' : 'bg-[#FCEAEA]'
                  }`}>
                    {CATEGORY_ICON[tx.category] || '✨'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-nunito font-extrabold text-[13px] leading-tight truncate">{tx.description}</p>
                    <p className="text-[10px] text-hive-muted mt-0.5">
                      {LAYERS.find((l) => l.key === tx.layer)?.label}
                      {wasCorrected ? ' · corrected ↩️' : ''}
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
              const row = href ? (
                <Link href={href} className="block no-underline text-inherit hover:bg-hive-cream/50 -mx-3 px-3">
                  {inner}
                </Link>
              ) : (
                inner
              );
              return (
                <div key={tx.id} className="flex items-center gap-1.5">
                  <div className="flex-1 min-w-0">{row}</div>
                  {isParentUser && isFixable(tx) && !wasCorrected && (
                    <button
                      onClick={() => openFix(tx)}
                      title="Fix this entry (pocket / category / description)"
                      className="shrink-0 w-8 h-8 rounded-[10px] border border-hive-line bg-hive-cream text-[13px] hover:border-hive-honey transition-colors"
                    >
                      ✏️
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {!loading && (filtered.length > 0 || hasEarlier) && (
        /* Reconciliation footer — earlier + these 30 days = the wallet, exactly. */
        <div className="mt-3 rounded-hive border border-[#bfe0cc] bg-[#E7F5EC] px-4 py-3">
          <p className="font-nunito font-black text-[13px] text-pantry-leaf-dk">✓ Earlier + these 30 days = your balances today</p>
          <p className="text-[11.5px] text-hive-muted font-bold mt-0.5">
            ⭐ {formatHp(wallet.housePoints || 0)} HP · 🪙 {formatHoney(wallet.honeyCoins || 0)} ·
            🍯 {formatCash(wallet.treasuryCents || 0, currency)} · 💵 {formatCash(wallet.cashCents || 0, currency)}
            {' '}— exactly what your wallet shows.
          </p>
        </div>
      )}

      {/* ✏️ Fix-entry sheet (parent-only) — deposits AND spends. The book
          stays append-only: original + ↩️ reversal + repost all remain. */}
      {fixTx && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end lg:items-center justify-center p-0 lg:p-6" onClick={() => !fixSaving && setFixTx(null)}>
          <div
            className="w-full max-w-md bg-hive-paper rounded-t-hive-lg lg:rounded-hive-lg p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">
                ✏️ Fix this {fixTx.direction === 'in' ? 'deposit' : 'spend'}
              </p>
              <p className="font-nunito font-black text-lg mt-1">
                {fixTx.direction === 'in' ? '+' : '−'}{formatCash(fixTx.amount, currency)} · {fixTx.description}
              </p>
              <p className="text-[11px] text-hive-muted mt-0.5">
                Posted {fixTx.direction === 'in' ? 'to' : 'against'} {fixTx.layer === 'treasury' ? 'the 🍯 Honey Pot' : '💵 Cash'}.
                The original stays on the statement — Kaya writes a ↩️ correction pair.
              </p>
            </div>

            <div>
              <label className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted block mb-1.5">
                Should have {fixTx.direction === 'in' ? 'landed in…' : 'left…'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setFixPocket('cash')}
                  aria-pressed={fixPocket === 'cash'}
                  className={`p-2.5 rounded-hive border-2 text-left transition-all ${fixPocket === 'cash' ? 'border-hive-green bg-[#EAF7F0]' : 'border-hive-line bg-hive-paper'}`}
                >
                  <p className="font-nunito font-extrabold text-[13px]">💵 Cash</p>
                </button>
                <button
                  onClick={() => setFixPocket('treasury')}
                  aria-pressed={fixPocket === 'treasury'}
                  className={`p-2.5 rounded-hive border-2 text-left transition-all ${fixPocket === 'treasury' ? 'border-hive-honey bg-hive-honey-soft/40' : 'border-hive-line bg-hive-paper'}`}
                >
                  <p className="font-nunito font-extrabold text-[13px]">🍯 Honey Pot</p>
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted block mb-1.5">Category</label>
              <div className="flex flex-wrap gap-1.5">
                {fixChips.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setFixCategory(c.id as TxCategory)}
                    className={`px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border transition-colors ${
                      fixCategory === c.id ? 'bg-hive-honey text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                    }`}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted block mb-1">Description</label>
              <input
                value={fixDesc}
                onChange={(e) => setFixDesc(e.target.value)}
                maxLength={120}
                className="w-full h-11 px-3 bg-hive-cream rounded-[12px] text-sm border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
              />
            </div>

            {fixError && <p className="text-hive-rose text-sm font-bold">{fixError}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => setFixTx(null)}
                disabled={fixSaving}
                className="h-11 px-4 rounded-hive bg-hive-cream text-hive-muted font-nunito font-extrabold text-[13px]"
              >
                Cancel
              </button>
              <button
                onClick={saveFix}
                disabled={fixSaving}
                className="flex-1 h-11 rounded-hive bg-hive-honey hover:bg-hive-honey-dk text-white font-nunito font-black text-[13px] disabled:opacity-40 transition-colors"
              >
                {fixSaving ? 'Saving…' : 'Save correction ↩️'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
