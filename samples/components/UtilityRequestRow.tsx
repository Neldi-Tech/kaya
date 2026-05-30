'use client';

// Utility request list row — fixes the mobile overflow where a long
// "code · date · long meter name" title clipped the amount on the
// right ("≈ TZS 100,000" became "≈ TZS 100,00").
//
// The fix:
//   - Title becomes a TWO-LINE block: code muted on top, meter name
//     bold below. Status sits on a third line.
//   - The title block is `flex-1 min-w-0` so it absorbs the squeeze
//     and truncates with "…" at any width.
//   - The amount sits in its OWN column with `shrink-0` and
//     `whitespace-nowrap` so it never gets pushed off screen.
//
// Drops into the Utility list page in place of the existing row.
//
// Usage:
//   <UtilityRequestRow
//     code="UTL-0021"
//     date="290526"
//     meter="Luku: Security"
//     statusLabel="Awaiting approval"
//     itemCount={1}
//     amountLabel="≈ TZS 100,000"
//     accentEmoji="⚡"
//     onTap={() => router.push('/utility/UTL-0021')}
//   />

import React from 'react';

export interface UtilityRequestRowProps {
  code: string;            // 'UTL-0021'
  date: string;            // '290526' — displayed as-is
  meter: string;           // 'Luku: Security'
  statusLabel: string;     // 'Awaiting approval' | 'Closed' | …
  itemCount: number;
  /** Already formatted (e.g. '≈ TZS 100,000', 'TZS 80,000'). */
  amountLabel: string;
  accentEmoji?: string;
  onTap?: () => void;
  /** 'pending' tints the amount honey-amber; 'default' is navy-ink. */
  amountTone?: 'default' | 'pending';
}

export function UtilityRequestRow({
  code, date, meter, statusLabel, itemCount, amountLabel,
  accentEmoji = '⚡', onTap, amountTone = 'default',
}: UtilityRequestRowProps) {
  const innerClass =
    'w-full text-left bg-white rounded-[16px] p-3 flex items-start gap-3 ' +
    'border border-transparent hover:border-[#EDE3CC] transition-colors';

  const body = (
    <>
      <span className="w-7 h-7 rounded-[8px] bg-[#FFEDC0] text-[#B57A00] inline-flex items-center justify-center text-[14px] shrink-0 mt-0.5">
        {accentEmoji}
      </span>
      {/* Title block — absorbs squeeze, truncates with "…". */}
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-extrabold text-[#6B7280] truncate">
          {code} · {date}
        </p>
        <p className="text-[14px] font-extrabold text-[#0E2240] truncate">
          {meter}
        </p>
        <p className="text-[11px] text-[#6B7280] truncate">
          {itemCount} item{itemCount === 1 ? '' : 's'} · {statusLabel}
        </p>
      </div>
      {/* Amount column — fixed-right, never clipped. */}
      <p
        className={
          'text-[13px] font-black shrink-0 mt-0.5 text-right whitespace-nowrap ' +
          (amountTone === 'pending' ? 'text-[#B57A00]' : 'text-[#0E2240]')
        }
      >
        {amountLabel}
      </p>
    </>
  );

  if (onTap) {
    return (
      <button type="button" onClick={onTap} className={innerClass}>
        {body}
      </button>
    );
  }
  return <div className={innerClass}>{body}</div>;
}
