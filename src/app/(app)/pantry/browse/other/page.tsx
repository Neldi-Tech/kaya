'use client';

// /pantry/browse/other — Other Catalogue · per-module sub-tabs.
//
// v4-final Step 4 (locked 2026-05-18). Replaces the v3
// /pantry/browse/others tile hub. Four sub-tabs surface the items
// each non-Pantry module knows about, with that module's category
// chips for filtering:
//
//   🌿 Outdoor  → family staples tagged module='outdoor'  · OUTDOOR_CATEGORIES chips
//   ⚡ Utility  → /pantry/utilities bills                · UTILITY_REQUEST_CATEGORIES chips
//   🚗 Drivers  → family staples tagged module='drivers'  · DRIVERS_CATEGORIES chips
//   🤝 Payroll  → category-only preview                   · PAYROLL_CATEGORIES chips
//
// Items shown read-only here — promote / quick-add stays inside each
// module's request flow.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePantry } from '@/contexts/PantryContext';
import { useHive } from '@/contexts/HiveContext';
import {
  OUTDOOR_CATEGORIES, DRIVERS_CATEGORIES, UTILITY_REQUEST_CATEGORIES, PAYROLL_CATEGORIES,
  MODULE_EMOJI, MODULE_LABEL,
  type PurchaseModule,
} from '@/lib/purchase';
import { formatCents } from '@/components/pantry/format';

type OtherModule = Exclude<PurchaseModule, 'pantry'>;
const TABS: OtherModule[] = ['outdoor', 'utility', 'drivers', 'payroll'];

export default function OtherCataloguePage() {
  const { staples, utilities } = usePantry();
  const { config } = useHive();
  const currency = config.currency;
  const [tab, setTab] = useState<OtherModule>('outdoor');
  const [cat, setCat] = useState<string | 'all'>('all');
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  // Switch tabs → reset chip filter so a stale selection doesn't
  // collapse the new tab's content.
  const switchTab = (t: OtherModule) => { setTab(t); setCat('all'); };

  // Which chip set applies to the active tab.
  const chips = useMemo(() => {
    if (tab === 'outdoor') return OUTDOOR_CATEGORIES;
    if (tab === 'drivers') return DRIVERS_CATEGORIES;
    if (tab === 'utility') return UTILITY_REQUEST_CATEGORIES;
    return PAYROLL_CATEGORIES;
  }, [tab]);

  // Item shape varies per tab — render adapters keep the UI uniform.
  const rows = useMemo(() => {
    if (tab === 'outdoor' || tab === 'drivers') {
      return staples
        .filter((s) => s.module === tab && s.status !== 'pending_promote')
        .filter((s) => cat === 'all' || s.category === cat)
        .filter((s) => !query || s.name.toLowerCase().includes(query))
        .map((s) => ({
          key: s.id,
          emoji: tab === 'outdoor' ? '🌿' : '🚗',
          name: s.name,
          meta: `${s.defaultQty} ${s.unit}`,
          right: s.lastBoughtCents != null ? formatCents(s.lastBoughtCents, currency) : '',
        }));
    }
    if (tab === 'utility') {
      return utilities
        .filter((u) => u.category !== 'salary' && u.active)
        .filter((u) => cat === 'all' || u.category === cat)
        .filter((u) => !query || u.name.toLowerCase().includes(query))
        .map((u) => ({
          key: u.id,
          emoji: '⚡',
          name: u.name,
          meta: `${u.cadence} · ${u.category}`,
          right: u.amountCents ? formatCents(u.amountCents, currency) : '',
        }));
    }
    // Payroll: show the categories as cards (the "items" are the
    // request types Payroll supports). Helpers see their own pay on
    // /pantry/payroll; this surface is just the catalogue preview.
    return PAYROLL_CATEGORIES
      .filter((c) => cat === 'all' || c.id === cat)
      .filter((c) => !query || c.label.toLowerCase().includes(query))
      .map((c) => ({
        key: c.id,
        emoji: c.emoji,
        name: c.label,
        meta: 'Pay-related request type',
        right: '',
      }));
  }, [tab, cat, query, staples, utilities, currency]);

  // Per-chip counts (live, ignoring the chip itself).
  const chipCounts = useMemo(() => {
    const out = new Map<string, number>();
    out.set('all', 0);
    for (const c of chips) out.set(c.id, 0);
    const source: { category?: string; name?: string; label?: string }[] = (() => {
      if (tab === 'outdoor' || tab === 'drivers') {
        return staples
          .filter((s) => s.module === tab && s.status !== 'pending_promote')
          .map((s) => ({ category: s.category, name: s.name }));
      }
      if (tab === 'utility') {
        return utilities
          .filter((u) => u.category !== 'salary' && u.active)
          .map((u) => ({ category: u.category, name: u.name }));
      }
      return PAYROLL_CATEGORIES.map((c) => ({ category: c.id, label: c.label }));
    })();
    for (const s of source) {
      if (query) {
        const text = (s.name ?? s.label ?? '').toLowerCase();
        if (!text.includes(query)) continue;
      }
      out.set('all', (out.get('all') ?? 0) + 1);
      if (s.category) out.set(s.category, (out.get(s.category) ?? 0) + 1);
    }
    return out;
  }, [tab, query, staples, utilities, chips]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">
          Household · Other Catalogue
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          Pick a module
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          Items each non-Pantry module knows about. Tap a tab to switch; chips filter within each.
        </p>
      </div>

      <div className="sticky top-0 bg-hive-cream z-10 pt-2 pb-3 -mx-4 px-4 lg:-mx-8 lg:px-8">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-hive-muted text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this module…"
            className="w-full bg-hive-paper border border-hive-line rounded-hive pl-10 pr-9 py-2.5 text-sm font-nunito font-bold placeholder:text-hive-muted placeholder:font-normal focus:outline-none focus:border-hive-honey"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-hive-line text-hive-muted text-sm font-black"
              aria-label="Clear search"
            >×</button>
          )}
        </div>

        {/* Module sub-tabs */}
        <div className="flex gap-1 mt-3 border-b border-hive-line overflow-x-auto">
          {TABS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchTab(m)}
              className={`flex-shrink-0 px-3 py-2.5 -mb-px font-nunito font-extrabold text-sm border-b-[3px] whitespace-nowrap ${
                tab === m
                  ? 'text-hive-honey-dk border-hive-honey'
                  : 'text-hive-muted border-transparent'
              }`}
            >
              {MODULE_EMOJI[m]} {MODULE_LABEL[m]}
            </button>
          ))}
        </div>

        {/* Module-specific chips */}
        <div className="flex gap-1.5 mt-3 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            onClick={() => setCat('all')}
            className={`flex-shrink-0 text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border whitespace-nowrap ${
              cat === 'all'
                ? 'bg-hive-honey text-white border-hive-honey-dk'
                : 'bg-hive-paper border-hive-line text-hive-muted'
            }`}
          >
            All <span className="opacity-70">· {chipCounts.get('all') ?? 0}</span>
          </button>
          {chips.map((c) => {
            const n = chipCounts.get(c.id) ?? 0;
            const active = cat === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCat(active ? 'all' : c.id)}
                disabled={n === 0}
                className={`flex-shrink-0 text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border whitespace-nowrap disabled:opacity-40 ${
                  active
                    ? 'bg-hive-honey text-white border-hive-honey-dk'
                    : 'bg-hive-paper border-hive-line text-hive-muted'
                }`}
              >
                {c.emoji} {c.label} <span className="opacity-70">· {n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Item list */}
      {rows.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mt-3">
          <div className="text-3xl mb-2">{MODULE_EMOJI[tab]}</div>
          <h3 className="font-nunito font-black text-lg">Nothing yet in {MODULE_LABEL[tab]}</h3>
          <p className="text-hive-muted text-sm mt-1">
            {tab === 'utility'
              ? <>Add bills in <Link href="/pantry/utilities" className="text-hive-honey-dk underline">/pantry/utilities</Link>.</>
              : tab === 'payroll'
                ? <>Payroll is request-driven — see <Link href="/pantry/payroll" className="text-pantry-leaf-dk underline">/pantry/payroll</Link>.</>
                : <>Items appear here when helpers quick-add them in the {MODULE_LABEL[tab]} request flow.</>}
            {(q || cat !== 'all') && (
              <>
                {' '}
                <button onClick={() => { setQ(''); setCat('all'); }} className="text-pantry-leaf-dk font-bold underline">Clear filters</button>.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.key} className="bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FFF3D9] flex items-center justify-center text-lg flex-shrink-0">
                {r.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{r.name}</div>
                <div className="text-[11px] text-hive-muted font-bold mt-0.5">{r.meta}</div>
              </div>
              {r.right && <div className="font-nunito font-black text-sm text-hive-navy flex-shrink-0">{r.right}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
