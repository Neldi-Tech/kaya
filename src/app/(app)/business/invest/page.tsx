'use client';

// Kaya Business · Junior Investor (kid screen 10) — simulated mode: REAL prices
// (server-cached marketQuotes), VIRTUAL money, parent OK on every buy. Teaches
// shares / diversify / compound risk-free. Real custodial investing = Phase 2.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Instrument, InvestmentHolding, MarketQuote,
  INVESTMENT_MENU, holdingValueCents, readBusinessConfig,
  subscribeToInvestments, subscribeToMarketQuotes, subscribeToBusinessRequests,
  requestInvestmentBuy,
} from '@/lib/business';
import { formatCash, formatCashClean } from '@/components/hive/format';
import KidSwitcher from '@/components/hive/KidSwitcher';

export default function JuniorInvestorPage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const { activeKidId, config, fxUsdToFamily } = useHive();
  const familyId = profile?.familyId;
  const fx = fxUsdToFamily ?? 1;
  const bizConfig = useMemo(() => readBusinessConfig(family), [family]);

  const [holdings, setHoldings] = useState<InvestmentHolding[]>([]);
  const [quotes, setQuotes] = useState<Record<string, MarketQuote>>({});
  const [pendingBuys, setPendingBuys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!familyId || !activeKidId) { setHoldings([]); return; }
    const u1 = subscribeToInvestments(familyId, activeKidId, setHoldings);
    const u2 = subscribeToBusinessRequests(familyId, (reqs) => {
      const s = new Set<string>();
      reqs.forEach((r) => {
        if (r.type === 'investment_buy' && r.status === 'pending' && r.kidId === activeKidId && r.instrumentSymbol) s.add(r.instrumentSymbol);
      });
      setPendingBuys(s);
    });
    return () => { u1(); u2(); };
  }, [familyId, activeKidId]);

  useEffect(() => subscribeToMarketQuotes(setQuotes), []);

  const activeKid = children.find((c) => c.id === activeKidId);
  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === activeKidId;
  const canBuy = isParent || isOwner;
  const cur = config.currency;

  const menu = useMemo(
    () => INVESTMENT_MENU.filter((i) => bizConfig.investing.menu.includes(i.symbol)),
    [bizConfig.investing.menu],
  );
  const holdingBySymbol = useMemo(() => {
    const m: Record<string, InvestmentHolding> = {};
    holdings.forEach((h) => { m[h.symbol] = h; });
    return m;
  }, [holdings]);

  const portfolio = useMemo(() => {
    let value = 0, invested = 0;
    for (const h of holdings) {
      value += holdingValueCents(h, quotes[h.symbol], fx);
      invested += h.costBasisCents ?? 0;
    }
    return { value, invested, gain: value - invested };
  }, [holdings, quotes, fx]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">📈</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-black text-[16px]">Junior Investor</div>
          <div className="text-[11px] text-hive-honey-soft/80">Grow your money while you sleep</div>
        </div>
        <Link href="/business" className="text-[12px] font-nunito font-extrabold text-hive-honey-soft hover:underline shrink-0">Portfolio →</Link>
      </div>

      <KidSwitcher />

      {/* What is a stock */}
      <div className="bg-[#F4ECD8] border border-hive-honey/60 rounded-hive p-4 mb-3">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-nunito font-extrabold text-[14px]">🤔 What is a &ldquo;stock&rdquo;?</h3>
          <span className="text-[10px] font-nunito font-black uppercase tracking-wider px-2 py-0.5 rounded-hive-pill bg-hive-navy text-hive-honey-soft">kid lesson</span>
        </div>
        <p className="text-[13px] leading-relaxed text-hive-navy">
          When a company gets big — like a toy maker, Disney, or a bank you know — they sell tiny
          <b> pieces of themselves</b>. Each piece is a <b>share</b>. If you own one and the company grows,
          your share grows too. If it shrinks, your share shrinks. The <b>stock market</b> is just where
          people trade those tiny pieces.
        </p>
      </div>

      {/* Portfolio hero */}
      <div className="rounded-hive p-4 mb-3 text-hive-cream" style={{ background: 'linear-gradient(135deg, #1F1A12 0%, #3D3320 100%)' }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-nunito font-extrabold text-hive-honey-soft">
              {activeKid ? `${activeKid.name}'s portfolio` : 'Your portfolio'}
            </div>
            <div className="font-nunito font-black text-[30px] leading-tight mt-1">{formatCash(portfolio.value, cur)}</div>
            <div className={`text-[12px] mt-0.5 ${portfolio.gain >= 0 ? 'text-[#6DBA72]' : 'text-hive-rose'}`}>
              {portfolio.gain >= 0 ? '+' : '−'}{formatCash(Math.abs(portfolio.gain), cur)} since you started
            </div>
          </div>
          <div className="text-[34px] leading-none">📈</div>
        </div>
        <p className="text-[11px] text-hive-cream/60 mt-2.5">
          🟡 Simulated: real prices, virtual money — so you learn safely. Real investing comes later, through a parent account.
        </p>
      </div>

      {/* Holdings + menu */}
      <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
        <h3 className="font-nunito font-extrabold text-[14px] mb-1">Companies you can own</h3>
        {menu.map((inst) => (
          <MenuRow
            key={inst.symbol}
            inst={inst}
            holding={holdingBySymbol[inst.symbol]}
            quote={quotes[inst.symbol]}
            fx={fx}
            currency={cur}
            canBuy={canBuy}
            pending={pendingBuys.has(inst.symbol)}
            capCents={bizConfig.investing.perBuyCapCents}
            onRequest={async (amountCents, shares) => {
              if (!familyId || !activeKidId || !profile?.uid) return;
              await requestInvestmentBuy(familyId, activeKidId, inst.symbol, shares, amountCents, profile.uid,
                `Buy ${formatCash(amountCents, cur)} of ${inst.label}`);
            }}
          />
        ))}
      </div>

      {/* Big ideas */}
      <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
        <h3 className="font-nunito font-extrabold text-[14px] mb-1">📖 Three big ideas</h3>
        {[
          ['Diversify', "Don't put all your eggs in one basket. Own different things."],
          ['Compound', 'Your gains earn gains. Money grows faster as time passes.'],
          ['Long-term', 'Stocks go up and down. Over years, patient kids win.'],
        ].map(([t, d]) => (
          <div key={t} className="py-2 border-b border-dashed border-hive-line last:border-0">
            <div className="font-nunito font-bold text-[13px]">{t}</div>
            <div className="text-[11px] text-hive-muted">{d}</div>
          </div>
        ))}
      </div>

      <div className="bg-[#F4ECD8] border border-hive-line rounded-hive p-4">
        <p className="text-[12px] text-hive-navy/80 leading-relaxed">
          🔒 <b>A parent OK is needed for every buy.</b> Phase 1 is simulated (real prices, virtual money)
          so you learn safely. Phase 2 opens real investing through a parent-controlled account.
        </p>
      </div>
    </div>
  );
}

function MenuRow({ inst, holding, quote, fx, currency, canBuy, pending, capCents, onRequest }: {
  inst: Instrument;
  holding?: InvestmentHolding;
  quote?: MarketQuote;
  fx: number;
  currency: string;
  canBuy: boolean;
  pending: boolean;
  capCents: number;
  onRequest: (amountCents: number, shares: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const priceFamilyCents = quote ? Math.round(quote.priceUsd * fx * 100) : null;
  const value = holding ? holdingValueCents(holding, quote, fx) : 0;
  const gainPct = holding && holding.costBasisCents > 0
    ? Math.round(((value - holding.costBasisCents) / holding.costBasisCents) * 100)
    : null;

  const amountCents = (() => {
    const n = parseFloat(amount.replace(/,/g, ''));
    return Number.isNaN(n) ? 0 : Math.round(n * 100);
  })();
  const overCap = amountCents > capCents;
  const shares = priceFamilyCents && priceFamilyCents > 0 ? amountCents / priceFamilyCents : 0;

  const submit = async () => {
    if (amountCents <= 0 || !priceFamilyCents) { setError('Enter an amount.'); return; }
    if (overCap) { setError(`Max ${formatCash(capCents, currency)} per buy.`); return; }
    setError(''); setBusy(true);
    try { await onRequest(amountCents, shares); setDone(true); setOpen(false); }
    catch (e: any) { setError(e?.message || 'Could not send the request.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="py-2.5 border-b border-dashed border-hive-line last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-nunito font-bold text-[13px]">{inst.emoji} {inst.label}</div>
          <div className="text-[11px] text-hive-muted truncate">{inst.blurb}</div>
        </div>
        <div className="text-right shrink-0">
          {holding && holding.shares > 0 ? (
            <>
              <div className="font-nunito font-extrabold text-[13px]">{formatCash(value, currency)}</div>
              {gainPct !== null && <div className={`text-[11px] ${gainPct >= 0 ? 'text-[#2F7D32]' : 'text-hive-rose'}`}>{gainPct >= 0 ? '+' : ''}{gainPct}%</div>}
            </>
          ) : (
            <div className="text-[11px] text-hive-muted">
              {priceFamilyCents ? `${formatCashClean(priceFamilyCents, currency)}/share` : 'price soon'}
            </div>
          )}
        </div>
      </div>

      {canBuy && (
        <div className="mt-2">
          {done || pending ? (
            <span className="text-[11px] font-nunito font-bold text-[#B25E16]">⏳ Waiting for a parent OK</span>
          ) : !open ? (
            <button onClick={() => setOpen(true)} disabled={!priceFamilyCents}
              className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline disabled:opacity-40 disabled:no-underline">
              {priceFamilyCents ? (holding && holding.shares > 0 ? '+ Add more' : '+ Buy a piece') : 'Price loading…'}
            </button>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={`Amount (${currency})`}
                className="flex-1 h-10 px-3 bg-hive-cream rounded-hive border border-hive-line text-[13px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" autoFocus />
              <button onClick={submit} disabled={busy || amountCents <= 0}
                className="h-10 px-3 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[12px] disabled:opacity-40">
                {busy ? '…' : 'Request'}
              </button>
              <button onClick={() => { setOpen(false); setAmount(''); setError(''); }} className="text-hive-muted text-[12px]">✕</button>
            </div>
          )}
          {open && amountCents > 0 && priceFamilyCents && !overCap && (
            <div className="text-[11px] text-hive-muted mt-1">≈ {shares.toFixed(3)} shares · needs a parent OK</div>
          )}
          {error && <p className="text-hive-rose text-[11px] font-bold mt-1">{error}</p>}
        </div>
      )}
    </div>
  );
}
