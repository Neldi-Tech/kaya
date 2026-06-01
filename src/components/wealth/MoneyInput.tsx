'use client';

// Kaya Wealth · live-formatting money input (2026-06-01).
//
// Shows #,###,### as you type (grouped thousands, ≤2 decimals) and parses
// cleanly back to a number. This also fixes the save bug: a plain
// type="number" input rejects a typed "5,000,000", so the amount never
// captured and the form couldn't submit.

/** Raw input → grouped thousands with ≤2 decimals (display string). */
export function formatMoneyInput(raw: string): string {
  let s = (raw || '').replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  const [intPart, dec = ''] = s.split('.');
  const intFmt = intPart.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return s.includes('.') ? `${intFmt || '0'}.${dec.slice(0, 2)}` : intFmt;
}

/** Formatted string → number (major units). */
export function parseMoneyInput(formatted: string): number {
  return parseFloat((formatted || '').replace(/,/g, '')) || 0;
}

/** Formatted string → integer cents. */
export function moneyToCents(formatted: string): number {
  return Math.round(parseMoneyInput(formatted) * 100);
}

export function MoneyInput({ value, onChange, placeholder, autoFocus }: {
  value: string;
  onChange: (formatted: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input inputMode="decimal" value={value} placeholder={placeholder} autoFocus={autoFocus}
      onChange={(e) => onChange(formatMoneyInput(e.target.value))} />
  );
}
