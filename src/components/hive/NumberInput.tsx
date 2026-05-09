'use client';

// Numeric input that doesn't get a "sticky" leading 0 and formats with
// thousand separators. Value is always a JS number; the displayed string
// is decoupled while the field is focused so the user can type freely
// without React rewriting their cursor position.
//
// Used everywhere across the Hive (deposit amount, threshold, plan
// budget, conversion amount, goal target). Replaces every previous
// `<input type="number">` in the Hive surface.
//
// Behaviour:
//   - When focused, shows the raw digits (no commas) so the cursor
//     never lands on a separator and re-typing is predictable.
//   - On focus, selects all so the first keystroke replaces the value
//     (this is the actual sticky-leading-0 fix).
//   - On blur, formats with `Intl.NumberFormat('en-US', …)`.
//   - When `value` is exactly 0 it shows empty + the placeholder. We
//     never render "0" because a leading 0 is the bug we're fixing.

import { useEffect, useState } from 'react';

export interface NumberInputProps {
  value: number;
  onChange: (next: number) => void;
  /** Allow a decimal separator while typing (e.g. for USD amounts). */
  allowDecimal?: boolean;
  min?: number;
  max?: number;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  inputMode?: 'numeric' | 'decimal';
  /** Called on Enter. Useful for form submits inline with the input. */
  onEnter?: () => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
}

export default function NumberInput({
  value, onChange,
  allowDecimal = false,
  min = 0,
  max,
  className = '',
  placeholder = '0',
  ariaLabel,
  inputMode,
  onEnter,
  onBlur: onBlurOuter,
  autoFocus,
  disabled,
}: NumberInputProps) {
  const [focused, setFocused] = useState(false);
  // While focused, the user owns the displayed string. We snapshot it
  // here on focus and update it on each keystroke. When unfocused, we
  // recompute from the current `value` prop.
  const [draft, setDraft] = useState<string>(() => formatNumber(value, allowDecimal));

  // Re-sync the formatted display when `value` changes externally and
  // we're not currently typing.
  useEffect(() => {
    if (!focused) setDraft(formatNumber(value, allowDecimal));
  }, [value, allowDecimal, focused]);

  const handleChange = (raw: string) => {
    // Strip everything that isn't a digit (or a decimal point if allowed).
    // We don't strip commas during edit — but stripCommas() runs on focus
    // so the field is comma-free while typing anyway.
    const cleaned = raw.replace(allowDecimal ? /[^0-9.]/g : /[^0-9]/g, '');
    // Collapse multiple decimal points to one.
    const normalised = allowDecimal && cleaned.split('.').length > 2
      ? cleaned.slice(0, cleaned.lastIndexOf('.'))
      : cleaned;
    setDraft(normalised);

    if (normalised === '' || normalised === '.') {
      onChange(0);
      return;
    }
    const n = parseFloat(normalised);
    if (!Number.isFinite(n)) return;
    const clamped = clamp(n, min, max);
    onChange(clamped);
  };

  return (
    <input
      type="text"
      inputMode={inputMode || (allowDecimal ? 'decimal' : 'numeric')}
      value={focused ? draft : formatNumber(value, allowDecimal)}
      onChange={(e) => handleChange(e.target.value)}
      onFocus={(e) => {
        setFocused(true);
        setDraft(stripFormat(formatNumber(value, allowDecimal)));
        // Select-all so the first keystroke replaces — kills the
        // "leading 0 / cursor at end" UX.
        requestAnimationFrame(() => {
          try { e.target.select(); } catch {}
        });
      }}
      onBlur={() => {
        setFocused(false);
        // Re-format with commas on blur. The actual numeric value is
        // already in `value` from prior onChange calls.
        setDraft(formatNumber(value, allowDecimal));
        onBlurOuter?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) onEnter();
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      autoFocus={autoFocus}
      disabled={disabled}
    />
  );
}

function formatNumber(n: number, allowDecimal: boolean): string {
  if (!Number.isFinite(n) || n === 0) return '';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    // Show up to 2 decimals when allowed AND when needed (n has a fractional part).
    maximumFractionDigits: allowDecimal ? 2 : 0,
  }).format(n);
}

function stripFormat(s: string): string {
  return s.replace(/,/g, '');
}

function clamp(n: number, min: number, max?: number): number {
  if (typeof max === 'number') return Math.min(max, Math.max(min, n));
  return Math.max(min, n);
}
