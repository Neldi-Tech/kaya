'use client';

// Numeric input that doesn't get a "sticky" leading 0 and formats with
// thousand separators. Value is always a JS number; the displayed string
// is decoupled while the field is focused so the user can type freely
// without React rewriting their cursor position.
//
// Generic UI primitive — used by both the Hive and the Pantry. Keep this
// in /ui/ so other modules can adopt it without cross-section imports.
//
// Behaviour:
//   - When focused, shows raw digits (no commas) so the cursor never
//     sits on a separator while typing.
//   - On focus, selects all so the first keystroke replaces the value.
//     Kills the sticky-leading-0 bug that controlled type=number inputs
//     suffer when state is 0.
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
    const cleaned = raw.replace(allowDecimal ? /[^0-9.]/g : /[^0-9]/g, '');
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
        requestAnimationFrame(() => {
          try { e.target.select(); } catch {}
        });
      }}
      onBlur={() => {
        setFocused(false);
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
