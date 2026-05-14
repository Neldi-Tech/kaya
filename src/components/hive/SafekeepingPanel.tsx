'use client';

// Safekeeping panel — moves cash between the two v3 sub-balances:
//   👛 On Hand   — spendable cash the kid holds
//   🏦 On Deposit — safekeeping (savings set aside)
//
// Deposit (on-hand → safekeeping) is open to the kid: setting your
// own money aside is always allowed. Withdraw (safekeeping → on-hand)
// is gated to parents via `canWithdraw` so a kid can't un-safekeep on
// impulse — that's the whole point of safekeeping.
//
// Both are pure intra-cash transfers — total cash never changes, so
// they don't count as spending or earning.

import { useState } from 'react';
import {
  Wallet, depositToSafekeeping, withdrawFromSafekeeping,
} from '@/lib/hive';
import NumberInput from './NumberInput';
import { formatCash } from './format';

export default function SafekeepingPanel({
  familyId, kidId, uid, wallet, currency, canWithdraw,
}: {
  familyId: string;
  kidId: string;
  uid: string;
  wallet: Wallet;
  currency: string;
  /** Withdraw is a parent action — kids see it disabled with a hint. */
  canWithdraw: boolean;
}) {
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  // Major-unit input → minor-unit cents. Decimals allowed so USD-style
  // currencies work; TZS-style whole-number entry rounds cleanly.
  const cents = Math.round(amount * 100);
  const sourceCents = mode === 'deposit'
    ? wallet.cashOnHandCents
    : wallet.cashOnDepositCents;
  const overdraw = cents > sourceCents;

  const projOnHand = mode === 'deposit'
    ? wallet.cashOnHandCents - cents
    : wallet.cashOnHandCents + cents;
  const projDeposit = mode === 'deposit'
    ? wallet.cashOnDepositCents + cents
    : wallet.cashOnDepositCents - cents;

  const submit = async () => {
    setError(''); setDone('');
    if (cents <= 0) { setError('Pick an amount.'); return; }
    if (overdraw) {
      setError(mode === 'deposit'
        ? 'Not enough on-hand Cash to move.'
        : 'Not enough Cash in safekeeping.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'deposit') {
        await depositToSafekeeping(familyId, kidId, cents, uid);
        setDone('Moved to safekeeping 🏦');
      } else {
        await withdrawFromSafekeeping(familyId, kidId, cents, uid);
        setDone('Withdrawn to on-hand 👛');
      }
      setAmount(0);
      setTimeout(() => setDone(''), 2600);
    } catch (e: any) {
      setError(e?.message || 'Could not complete that move.');
    }
    setBusy(false);
  };

  return (
    <div className="rounded-hive border border-hive-line bg-hive-paper p-4">
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted">
        Safekeeping
      </p>

      {/* Mode toggle */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 bg-hive-cream/60 rounded-hive-pill p-1">
        <button
          type="button"
          onClick={() => { setMode('deposit'); setError(''); }}
          className={`rounded-hive-pill py-2 text-[12px] font-nunito font-extrabold transition-colors ${
            mode === 'deposit'
              ? 'bg-hive-honey text-white shadow-sm'
              : 'text-hive-muted'
          }`}
        >
          ↑ To safekeeping
        </button>
        <button
          type="button"
          onClick={() => { if (canWithdraw) { setMode('withdraw'); setError(''); } }}
          disabled={!canWithdraw}
          className={`rounded-hive-pill py-2 text-[12px] font-nunito font-extrabold transition-colors ${
            mode === 'withdraw'
              ? 'bg-hive-green text-white shadow-sm'
              : canWithdraw
                ? 'text-hive-muted'
                : 'text-hive-muted/40 cursor-not-allowed'
          }`}
        >
          ↓ Withdraw
        </button>
      </div>
      {!canWithdraw && (
        <p className="text-[10px] text-hive-muted mt-1.5 leading-snug">
          Ask a parent to withdraw cash back from safekeeping.
        </p>
      )}

      {/* Sub-balance tiles */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-hive bg-hive-cream/60 p-2.5">
          <p className="text-[10px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">
            👛 On hand
          </p>
          <p className="font-nunito font-black text-[15px] mt-0.5">
            {formatCash(wallet.cashOnHandCents, currency)}
          </p>
        </div>
        <div className="rounded-hive bg-hive-cream/60 p-2.5">
          <p className="text-[10px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">
            🏦 On deposit
          </p>
          <p className="font-nunito font-black text-[15px] mt-0.5">
            {formatCash(wallet.cashOnDepositCents, currency)}
          </p>
        </div>
      </div>

      {/* Amount input */}
      <div className="mt-3 flex items-center gap-2 rounded-hive border border-hive-line bg-hive-cream/40 px-3 py-2.5">
        <span className="text-[12px] font-nunito font-extrabold text-hive-muted shrink-0">
          {mode === 'deposit' ? 'Move' : 'Withdraw'}
        </span>
        <NumberInput
          value={amount}
          onChange={setAmount}
          allowDecimal
          min={0}
          ariaLabel="Safekeeping amount"
          placeholder="0"
          onEnter={submit}
          className="font-nunito font-black text-xl bg-transparent outline-none w-full min-w-0 placeholder:text-hive-muted/30"
        />
      </div>

      {/* Projection */}
      {cents > 0 && !overdraw && (
        <p className="text-[11px] text-hive-muted mt-2">
          After: 👛 {formatCash(projOnHand, currency)} · 🏦 {formatCash(projDeposit, currency)}
        </p>
      )}
      {error && <p className="text-[11px] text-hive-rose mt-2 font-bold">{error}</p>}
      {done && <p className="text-[11px] text-hive-green mt-2 font-bold">{done}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy || cents <= 0 || overdraw}
        className={`mt-3 w-full rounded-hive py-3 text-center font-nunito font-black text-sm text-white transition-colors disabled:opacity-40 ${
          mode === 'deposit'
            ? 'bg-hive-honey hover:bg-hive-honey-dk'
            : 'bg-hive-green hover:brightness-95'
        }`}
      >
        {busy
          ? 'Working…'
          : mode === 'deposit'
            ? '↑ Move to safekeeping'
            : '↓ Withdraw to on-hand'}
      </button>
    </div>
  );
}
