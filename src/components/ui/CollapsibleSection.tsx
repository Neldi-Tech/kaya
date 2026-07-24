'use client';

import { useEffect, useState } from 'react';

// Generic collapsible settings card — renders the standard white card
// chrome with a tappable header (title + optional right-aligned summary
// + chevron) and hides its body until expanded. Collapsed by default to
// keep the Settings page short.
//
// SET PR3 (M7/M9) additions, all opt-in and backwards compatible:
//   • `id`       — anchors the card AND makes `#id` deep links open it and
//                  scroll to it (hashchange-aware, so in-page links work).
//   • `remember` — persists open/closed per device (localStorage).
//   • `icon`     — leading emoji for the folded header.
// `title` is a ReactNode so callers can pass dynamic labels (e.g. the
// "Born on the same day · women" suffix).
export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  id,
  remember = false,
  icon,
  children,
}: {
  title: React.ReactNode;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  id?: string;
  remember?: boolean;
  icon?: string;
  children: React.ReactNode;
}) {
  const storageKey = id && remember ? `kaya.settings.open.${id}` : null;
  const [open, setOpen] = useState(defaultOpen);

  // Restore the remembered state once on mount (client-only).
  useEffect(() => {
    if (!storageKey) return;
    try {
      const v = localStorage.getItem(storageKey);
      if (v != null) setOpen(v === '1');
    } catch { /* private mode etc. — fall back to defaultOpen */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (storageKey) { try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch {} }
      return next;
    });
  };

  // #id deep link → open + scroll (works on load AND on in-page hash taps,
  // e.g. the 🔎 quick-find chips or the kids' 🌍 More-sheet shortcut).
  useEffect(() => {
    if (!id) return;
    const check = () => {
      if (typeof window === 'undefined' || window.location.hash !== `#${id}`) return;
      setOpen(true);
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [id]);

  return (
    <div id={id} className="bg-white border border-kaya-warm-dark rounded-kaya p-4 scroll-mt-24">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="text-xs text-kaya-sand font-semibold uppercase tracking-wider flex items-center gap-1.5">
          {icon && <span className="text-sm leading-none normal-case">{icon}</span>}
          {title}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {summary != null && <span className="text-[10px] text-kaya-sand-light">{summary}</span>}
          {/* Labelled Show/Hide pill — a clear, high-contrast expand
              affordance (gold-light fill, gold border, chocolate text).
              The near-white circle before this was too easy to miss. */}
          <span className="inline-flex items-center gap-1 rounded-full bg-kaya-gold-light border border-kaya-gold px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-kaya-chocolate">
            {open ? 'Hide' : 'Show'}
            <span className={`inline-block leading-none transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
          </span>
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
