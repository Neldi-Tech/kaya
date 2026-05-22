'use client';

import { useState } from 'react';

// Generic collapsible settings card — renders the standard white card
// chrome with a tappable header (title + optional right-aligned summary
// + chevron) and hides its body until expanded. Collapsed by default to
// keep the Settings page short; each instance keeps its own open state.
// `title` is a ReactNode so callers can pass dynamic labels (e.g. the
// "Born on the same day · women" suffix).
export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">{title}</span>
        <span className="flex items-center gap-2 shrink-0">
          {summary != null && <span className="text-[10px] text-kaya-sand-light">{summary}</span>}
          <span className={`inline-block text-sm text-kaya-sand transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
