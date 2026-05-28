'use client';

// Kaya Sparks · collapsible month header for the gallery surfaces.
//
// 3-column grid (name · count chip · chevron) so the count + chevron
// align vertically across every header on the page.

import type { ReactNode } from 'react';

interface Props {
  label: string;             // "August 2024", "Undated"
  count: number;             // items in this month
  open: boolean;             // controlled — caller owns the open set
  onToggle: () => void;
  children: ReactNode;       // rendered when open
  /** Hide the top border when this is the first group on the page —
   *  the highlights rail already provides separation. */
  first?: boolean;
}

export default function MonthGroup({ label, count, open, onToggle, children, first }: Props) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full grid items-center gap-2 py-2 px-1 text-left ${first ? '' : 'border-t border-[#ECE4D3] mt-3'}`}
        style={{ gridTemplateColumns: '1fr 56px 18px' }}
      >
        <span className="text-[13px] font-extrabold text-[#0F1F44] flex items-center gap-1.5 min-w-0 truncate">
          <span aria-hidden>📅</span>
          <span className="truncate">{label}</span>
        </span>
        <span
          className="justify-self-end bg-[#F4ECDB] text-[#5A6488] text-[10.5px] font-extrabold rounded-full px-2.5 py-[2px] text-center tabular-nums"
          style={{ minWidth: 48 }}
        >
          {count}
        </span>
        <span
          className="justify-self-end text-[#5A6488] text-[11px] inline-block w-[18px] text-center transition-transform"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}
