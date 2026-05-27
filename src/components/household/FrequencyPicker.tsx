'use client';

// Frequency picker used by both modules. Spec §2 defines the canonical
// monthly-equivalent conversion table; the helper that uses this value
// lives in lib/contributions.ts (contribMonthlyEquivalentCents) and
// lib/subscriptions.ts will get its own in P3.

import type { ContributionFrequency } from '@/lib/contributions';

// Contributions only use the 5-option set (most are one-off; tithe is
// monthly). Subscriptions in P3 will add daily/weekly/semi_annual.
export const CONTRIB_FREQUENCY_OPTIONS: { id: ContributionFrequency; label: string }[] = [
  { id: 'one_off',   label: 'One-off' },
  { id: 'monthly',   label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annual',    label: 'Annual' },
  { id: 'custom',    label: 'Every N months' },
];

export function FrequencyPicker({
  value,
  customMonths,
  onChange,
  label = 'Frequency',
}: {
  value: ContributionFrequency;
  customMonths: number | null;
  onChange: (v: ContributionFrequency, customMonths: number | null) => void;
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
          onChange={(e) => onChange(e.target.value as ContributionFrequency, customMonths)}
          className="flex-1 rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
        >
          {CONTRIB_FREQUENCY_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
        {value === 'custom' && (
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
