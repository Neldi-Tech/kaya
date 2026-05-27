'use client';

// Amount + currency picker with a live household-currency equivalent
// rendered below. FX rate is resolved from src/lib/fx.ts when the user
// changes currency or amount, and reported back to the parent via
// onChange so it can be locked on submit.

import { useEffect, useState } from 'react';
import { formatCents } from '@/components/pantry/format';
import { resolveFxRate, applyFxRate, SUPPORTED_CURRENCIES } from '@/lib/fx';

export interface CurrencyAmountValue {
  amountCents: number;
  currency: string;
  fxRate: number;        // 1 when currency === householdCurrency
  amountHouseholdCents: number;
  fxResolved: boolean;   // false while in-flight, true once resolved
}

export function CurrencyAmountInput({
  value,
  onChange,
  householdCurrency,
  label = 'Amount',
}: {
  value: CurrencyAmountValue;
  onChange: (v: CurrencyAmountValue) => void;
  householdCurrency: string;
  label?: string;
}) {
  const [resolving, setResolving] = useState(false);

  // Re-resolve when currency or household currency changes.
  useEffect(() => {
    let cancelled = false;
    async function go() {
      if (!value.currency || !householdCurrency) return;
      if (value.currency === householdCurrency) {
        onChange({
          ...value,
          fxRate: 1,
          amountHouseholdCents: value.amountCents,
          fxResolved: true,
        });
        return;
      }
      setResolving(true);
      const rate = await resolveFxRate(value.currency, householdCurrency);
      if (cancelled) return;
      setResolving(false);
      if (rate == null) {
        onChange({ ...value, fxRate: 0, amountHouseholdCents: 0, fxResolved: false });
        return;
      }
      onChange({
        ...value,
        fxRate: rate,
        amountHouseholdCents: applyFxRate(value.amountCents, rate),
        fxResolved: true,
      });
    }
    go();
    return () => { cancelled = true; };
    // amountCents change recomputes the household side via the same effect
    // because applyFxRate is pure — re-running yields the new cents amount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.currency, householdCurrency, value.amountCents]);

  const sameCurrency = value.currency === householdCurrency;

  return (
    <div className="space-y-1">
      <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={value.amountCents === 0 ? '' : (value.amountCents / 100).toString()}
          onChange={(e) => {
            const raw = e.target.value;
            const n = raw === '' ? 0 : Math.round(parseFloat(raw) * 100);
            onChange({ ...value, amountCents: Number.isFinite(n) ? n : 0 });
          }}
          placeholder="0.00"
          className="flex-1 rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-display text-lg font-bold text-pulse-navy focus:border-pulse-gold focus:outline-none"
        />
        <select
          value={value.currency}
          onChange={(e) => onChange({ ...value, currency: e.target.value })}
          className="rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
        >
          {SUPPORTED_CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>{c.code}</option>
          ))}
        </select>
      </div>

      {/* Household equivalent line */}
      <div className="text-xs font-semibold text-pulse-navy/60 min-h-[1rem]">
        {sameCurrency
          ? `Household currency — no conversion needed`
          : resolving
            ? 'Resolving FX…'
            : value.fxResolved
              ? <>≈ <span className="text-pulse-navy">{formatCents(value.amountHouseholdCents, householdCurrency)}</span> in household currency (rate locked at submit)</>
              : <span className="text-pulse-coral">FX unavailable — household amount will be 0 until rate resolves</span>}
      </div>
    </div>
  );
}
