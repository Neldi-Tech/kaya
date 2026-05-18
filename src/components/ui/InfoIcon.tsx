'use client';

// InfoIcon · a tiny "(i)" badge that surfaces a short tooltip.
//
// Hover on desktop (CSS group-hover) + tap-toggle on mobile (controlled
// open state with backdrop dismiss). Used across the Household section
// to disambiguate similar-named surfaces (Staples vs Browse, People vs
// Workplan, etc.) per v4-final §02 (locked 2026-05-18).
//
// Keep it stateless from the parent's POV — pass the tooltip string,
// the component owns the open/close state. Use `align` to nudge the
// popover left/right when it would overflow the viewport.

import { useEffect, useRef, useState } from 'react';

interface InfoIconProps {
  tooltip: string;
  /** Visual size of the (i) badge. Default 'sm' (16px). */
  size?: 'xs' | 'sm';
  /** Where the popover anchors relative to the badge. Use 'right' on
   *  items at the left edge of the page; 'left' on items at the right. */
  align?: 'left' | 'right' | 'center';
  /** Optional accessible label override; defaults to "More info". */
  ariaLabel?: string;
  /** Stop the click event from bubbling — useful when InfoIcon sits
   *  inside a <Link> or other tappable wrapper. Default true. */
  stopPropagation?: boolean;
}

export default function InfoIcon({
  tooltip,
  size = 'sm',
  align = 'right',
  ariaLabel = 'More info',
  stopPropagation = true,
}: InfoIconProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // Tap-outside / escape dismiss on mobile.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Defer so the same click that opened doesn't immediately close.
    const t = setTimeout(() => {
      window.addEventListener('click', onClick);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dot = size === 'xs' ? 'w-3.5 h-3.5 text-[8px]' : 'w-4 h-4 text-[9px]';
  const pos =
    align === 'right' ? 'left-0 top-full mt-1' :
    align === 'left'  ? 'right-0 top-full mt-1' :
    'left-1/2 -translate-x-1/2 top-full mt-1';

  return (
    <span ref={rootRef} className="relative inline-block group/info">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={(e) => {
          if (stopPropagation) {
            e.preventDefault();
            e.stopPropagation();
          }
          setOpen((v) => !v);
        }}
        className={`inline-flex items-center justify-center rounded-full bg-hive-cream border border-hive-line text-hive-muted font-black font-nunito hover:bg-hive-paper hover:text-hive-navy ${dot}`}
      >
        i
      </button>
      <span
        role="tooltip"
        className={`absolute z-50 w-[220px] bg-hive-navy text-hive-cream text-[11px] leading-snug font-bold px-3 py-2 rounded-lg shadow-xl pointer-events-none transition-opacity ${pos} ${
          open
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 group-hover/info:opacity-100 lg:group-hover/info:pointer-events-auto'
        }`}
      >
        {tooltip}
      </span>
    </span>
  );
}
