'use client';

// SET PR3 (M10 · Bonus B) — 🔎 Settings quick-find: a search box + smart
// chips pinned at the top of Settings. Typing filters the chips; tapping one
// sets the #hash, which the CollapsibleSection hash listeners turn into
// "unfold exactly that card and scroll to it". Deep-linkable by design —
// /settings#alerts etc. work from guides, emails and the kids' 🌍 shortcut.

import { useState } from 'react';

export interface QuickFindTarget {
  id: string;      // the #hash / CollapsibleSection id
  icon: string;
  label: string;
  keywords?: string; // extra search terms, lowercase
}

export default function SettingsQuickFind({ targets }: { targets: QuickFindTarget[] }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? targets.filter((t) => `${t.label} ${t.keywords ?? ''}`.toLowerCase().includes(needle))
    : targets;

  const jump = (id: string) => {
    if (typeof window === 'undefined') return;
    if (window.location.hash === `#${id}`) {
      // Same hash again — the browser won't fire hashchange, so nudge it.
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      window.location.hash = id;
    }
  };

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-3 mb-4">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && shown.length > 0) jump(shown[0].id); }}
        placeholder="🔎 Find a setting…"
        aria-label="Find a setting"
        className="w-full rounded-full border border-kaya-warm-dark/70 px-4 py-2 text-[13px] font-semibold placeholder:text-kaya-sand focus:outline-none focus:border-kaya-gold"
      />
      <div className="flex flex-wrap gap-1.5 mt-2">
        {shown.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => jump(t.id)}
            className="px-2.5 py-1 rounded-full text-[11px] font-extrabold border border-kaya-warm-dark/60 bg-white text-kaya-chocolate hover:border-kaya-gold transition"
          >
            {t.icon} {t.label}
          </button>
        ))}
        {shown.length === 0 && (
          <p className="text-[11px] text-kaya-sand font-semibold px-1 py-1">Nothing matches — try another word.</p>
        )}
      </div>
    </div>
  );
}
