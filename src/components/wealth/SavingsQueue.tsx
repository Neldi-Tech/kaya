'use client';

// Kaya Wealth · Savings Queue & Advisories (Phase 2 · PR7 · 2026-06-01).
//
// The funnel UP, made visible. A queue balance the family promotes into real
// investments ONLY on confirmation, plus advisory cards the user acts on or
// dismisses. Nothing here moves money without an explicit click.

import { useEffect, useMemo, useState } from 'react';
import { formatCents } from '@/components/pantry/format';
import { ASSET_CLASSES, type AssetClassId } from '@/lib/wealth';
import {
  subscribeSavings, queueBalance, depositToQueue, withdrawFromQueue, promoteToInvestment,
  type SavingsQueue as SQ, type SavingsView,
} from '@/lib/wealthSavings';
import {
  subscribeAdvisories, dismissAdvisory, markAdvisoryActed, refreshAdvisories, type Advisory,
} from '@/lib/wealthAdvisoriesClient';
import type { WealthData } from './useWealthData';
import { MoneyInput, moneyToCents, formatMoneyInput } from './MoneyInput';

const refreshed = new Set<string>(); // one auto-refresh per family per session
const INVEST_CLASSES = ASSET_CLASSES.filter((c) => !c.isLiability);

export default function SavingsQueue({ data, view }: { data: WealthData; view: SavingsView }) {
  const { familyId, author, householdCurrency, isParent } = data;
  const [queue, setQueue] = useState<SQ>({ sharedCents: 0, personalCents: {} });
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [depositOpen, setDepositOpen] = useState(false);
  const [promote, setPromote] = useState<null | { amountCents: number; advisoryId?: string }>(null);

  useEffect(() => { if (familyId) return subscribeSavings(familyId, setQueue); }, [familyId]);
  useEffect(() => { if (familyId) return subscribeAdvisories(familyId, setAdvisories); }, [familyId]);
  useEffect(() => {
    if (isParent && familyId && !refreshed.has(familyId)) { refreshed.add(familyId); void refreshAdvisories(householdCurrency); }
  }, [isParent, familyId, householdCurrency]);

  const balance = queueBalance(queue, view, author.uid);
  const cards = useMemo(() => advisories.filter((a) => a.visibility === view), [advisories, view]);

  const act = async (a: Advisory) => {
    if (!familyId) return;
    if (a.kind === 'promote_queue') { setPromote({ amountCents: a.amountCents ?? balance, advisoryId: a.id }); return; }
    await markAdvisoryActed(familyId, a.id, null);
  };

  return (
    <div className="adult-block">
      <div className="section-title">
        <h2>🐷 Savings Queue <span className="pilltag">Confirm to invest</span></h2>
        {isParent && <a onClick={() => familyId && refreshAdvisories(householdCurrency)} style={{ cursor: 'pointer' }}>↻ Refresh advice</a>}
      </div>

      <div className="grid g2">
        {/* QUEUE */}
        <div className="card">
          <div style={{ fontSize: 11.5, color: 'var(--grey)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700 }}>Set aside, not yet invested</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--navy)', margin: '6px 0 2px' }}>{formatCents(balance, householdCurrency)}</div>
          <div style={{ fontSize: 12, color: 'var(--grey)', lineHeight: 1.5, marginBottom: 14 }}>
            Household spend never auto-invests. Money waits here until you choose to put it to work.
          </div>
          {isParent ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="addbtn" style={{ width: 'auto', flex: 1, minWidth: 130 }} onClick={() => setDepositOpen(true)}>+ Deposit</button>
              <button className="glock-cta" style={{ width: 'auto', flex: 1, minWidth: 130, marginTop: 0 }} disabled={balance <= 0} onClick={() => setPromote({ amountCents: balance })}>Promote to investment →</button>
            </div>
          ) : <div style={{ fontSize: 12, color: 'var(--grey)' }}>Parents manage the queue.</div>}
        </div>

        {/* ADVISORIES */}
        <div className="card">
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--navy)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="ai-orb" style={{ width: 22, height: 22, borderRadius: '50%', background: 'radial-gradient(circle at 30% 30%,var(--gold-soft),var(--gold))' }} /> Advisories
          </div>
          {cards.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--grey)', lineHeight: 1.55 }}>No advice right now. Add to the queue or an asset and tap ↻ Refresh — Kaya surfaces ways to put money to work.</div>}
          {cards.map((a) => (
            <div key={a.id} style={{ borderTop: '1px dashed var(--line)', padding: '11px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--navy)' }}>{a.title}</div>
                {isParent && <button onClick={() => familyId && dismissAdvisory(familyId, a.id)} style={{ background: 'none', border: 'none', color: 'var(--grey)', cursor: 'pointer', fontSize: 13 }} title="Dismiss">✕</button>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--grey)', lineHeight: 1.5, margin: '3px 0 8px' }}>{a.body}</div>
              {isParent && (
                <button className="reveal" style={{ color: 'var(--blue)', fontWeight: 700 }} onClick={() => act(a)}>
                  {a.ctaLabel || 'Got it'}{a.amountCents ? ` · ${formatCents(a.amountCents, a.currency || householdCurrency)}` : ''} →
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {depositOpen && familyId && (
        <DepositModal householdCurrency={householdCurrency} onClose={() => setDepositOpen(false)}
          onDeposit={async (cents) => { await depositToQueue(familyId, view, author.uid, cents); setDepositOpen(false); }}
          onWithdraw={balance > 0 ? async (cents) => { await withdrawFromQueue(familyId, view, author.uid, Math.min(cents, balance)); setDepositOpen(false); } : undefined} />
      )}

      {promote && familyId && (
        <PromoteModal max={promote.amountCents} householdCurrency={householdCurrency} onClose={() => setPromote(null)}
          onPromote={async (cents, name, cls) => {
            const assetId = await promoteToInvestment({ familyId, view, ownerId: author.uid, author, amountCents: cents, currency: householdCurrency, name, assetClass: cls });
            if (promote.advisoryId) await markAdvisoryActed(familyId, promote.advisoryId, assetId);
            setPromote(null);
          }} />
      )}
    </div>
  );
}

// ── Deposit / withdraw ───────────────────────────────────────────────

function DepositModal({ householdCurrency, onClose, onDeposit, onWithdraw }: {
  householdCurrency: string; onClose: () => void;
  onDeposit: (cents: number) => Promise<void>; onWithdraw?: (cents: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = moneyToCents(amount);
  const run = async (fn?: (c: number) => Promise<void>) => { if (!fn || cents <= 0 || busy) return; setBusy(true); await fn(cents); };
  return (
    <div className="kw-modal-back" onClick={onClose}>
      <div className="kw-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🐷 Savings Queue</h3>
        <div className="msub">Set money aside for investing later — or take some back.</div>
        <div className="kw-field"><label>Amount ({householdCurrency})</label><MoneyInput value={amount} onChange={setAmount} placeholder="0" autoFocus /></div>
        <div className="kw-modal-actions">
          {onWithdraw && <button className="kw-btn-ghost" disabled={cents <= 0 || busy} onClick={() => run(onWithdraw)}>Withdraw</button>}
          <button className="kw-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="kw-btn-primary" disabled={cents <= 0 || busy} onClick={() => run(onDeposit)}>{busy ? '…' : 'Deposit'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Promote to investment (the confirmed funnel-up) ──────────────────

function PromoteModal({ max, householdCurrency, onClose, onPromote }: {
  max: number; householdCurrency: string; onClose: () => void;
  onPromote: (cents: number, name: string, cls: AssetClassId) => Promise<void>;
}) {
  const [amount, setAmount] = useState(formatMoneyInput(String(max / 100)));
  const [name, setName] = useState('');
  const [cls, setCls] = useState<AssetClassId>('public_markets');
  const [busy, setBusy] = useState(false);
  const cents = moneyToCents(amount);
  const canSave = cents > 0 && cents <= max && name.trim().length > 0 && !busy;
  const go = async () => { if (!canSave) return; setBusy(true); try { await onPromote(cents, name.trim(), cls); } catch { setBusy(false); } };
  return (
    <div className="kw-modal-back" onClick={onClose}>
      <div className="kw-modal" onClick={(e) => e.stopPropagation()}>
        <h3>📈 Promote to investment</h3>
        <div className="msub">Moves money from the queue into a real holding in your Asset Register. You confirm — nothing is automatic.</div>
        <div className="kw-row2">
          <div className="kw-field"><label>Amount ({householdCurrency})</label><MoneyInput value={amount} onChange={setAmount} placeholder="0" autoFocus /></div>
          <div className="kw-field"><label>Invest as</label>
            <select value={cls} onChange={(e) => setCls(e.target.value as AssetClassId)}>
              {INVEST_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
            </select>
          </div>
        </div>
        <div className="kw-field"><label>Investment name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="15-yr Treasury Bond" /></div>
        <div style={{ fontSize: 11.5, color: 'var(--grey)', marginBottom: 10 }}>Available in queue: {formatCents(max, householdCurrency)}</div>
        <div className="kw-modal-actions">
          <button className="kw-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="kw-btn-primary" disabled={!canSave} onClick={go}>{busy ? 'Investing…' : 'Confirm & invest'}</button>
        </div>
      </div>
    </div>
  );
}
