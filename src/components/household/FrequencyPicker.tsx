'use client';

// Frequency picker used by both modules. Spec §2 defines the canonical
// monthly-equivalent conversion table; the helper that uses this value
// lives in lib/contributions.ts (contribMonthlyEquivalentCents) and
// lib/subscriptions.ts (subMonthlyEquivalentCents).
//
// Subscriptions have a larger frequency set (daily / weekly / semi_annual)
// than Contributions (which top out at annual). The picker is generic
// over the string union — pass the right options list from the caller.

import type { ContributionFrequency } from '@/lib/contributions';
import type { SubscriptionFrequency } from '@/lib/subscriptions';

export type AnyFrequency = ContributionFrequency | SubscriptionFrequency;

export const CONTRIB_FREQUENCY_OPTIONS: { id: ContributionFrequency; label: string }[] = [
  { id: 'one_off',   label: 'One-off' },
  { id: 'monthly',   label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annual',    label: 'Annual' },
  { id: 'custom',    label: 'Every N months' },
];

export const SUB_FREQUENCY_OPTIONS: { id: SubscriptionFrequency; label: string }[] = [
  { id: 'monthly',     label: 'Monthly' },
  { id: 'annual',      label: 'Annual' },
  { id: 'quarterly',   label: 'Quarterly' },
  { id: 'semi_annual', label: 'Semi-annual' },
  { id: 'weekly',      label: 'Weekly' },
  { id: 'daily',       label: 'Daily' },
  { id: 'one_off',     label: 'One-off' },
  { id: 'custom',      label: 'Every N months' },
];

export function FrequencyPicker<T extends AnyFrequency>({
  value,
  customMonths,
  onChange,
  options,
  label = 'Frequency',
}: {
  value: T;
  customMonths: number | null;
  onChange: (v: T, customMonths: number | null) => void;
  options: { id: T; label: string }[];
  label?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">
        {label}
      </label>
      <div className="flex gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T, customMonths)}
          className="flex-1 rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
        >
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
        {value === ('custom' as T) && (
          <input
            type="number"
            min={1}
            max={36}
            value={customMonths ?? ''}
            onChange={(e) => {
              const n = e.target.value === '' ? null : parseInt(e.target.value, 10);
              onChange(value, Number.isFinite(n as number) ? (n as number) : null);
            }}
            placeholder="months"
            className="w-28 rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
          />
        )}
      </div>
    </div>
  );
}
