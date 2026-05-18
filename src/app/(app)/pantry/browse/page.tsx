'use client';

// /pantry/browse — Browse Catalogue · Pantry (Foods + Household tabs).
//
// v4-final Step 4 (locked 2026-05-18). Replaces the v3 landing page
// (Pantry + Others tiles) — those are now 3 sibling sidebar entries:
//   /pantry/browse        — this page · Foods + Household tabs
//   /pantry/browse/other  — Other Catalogue · per-module sub-tabs
//   /pantry/suppliers     — Soko · suppliers
//
// Restores the Foods/Household structure that existed in the original
// /pantry/directory (a v3 silent regression — flagged in v4-final
// precision note). Items sourced from the curated DIRECTORY_STAPLES
// catalog tagged with `surface: 'food' | 'household'`.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  DIRECTORY_STAPLES,
  FOOD_CATEGORY_CHIPS, HOUSEHOLD_CATEGORY_CHIPS,
  type Surface,
} from '@/lib/pantryDirectory';
import type { StapleCategory } from '@/lib/pantry';

export default function BrowseCataloguePage() {
  const [surface, setSurface] = useState<Surface>('food');
  const [cat, setCat] = useState<StapleCategory | 'all'>('all');
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  // Active chip set depends on the tab.
  const chips = surface === 'food' ? FOOD_CATEGORY_CHIPS : HOUSEHOLD_CATEGORY_CHIPS;

  // When switching tabs, reset the chip filter to 'all' so the user
  // doesn't end up with a stale chip selection that hides everything.
  const switchSurface = (s: Surface) => {
    setSurface(s);
    setCat('all');
  };

  // Filter the catalog: surface match + chip match + name match.
  const items = useMemo(() => {
    return DIRECTORY_STAPLES.filter((s) => {
      if (s.surface !== surface) return false;
      if (cat !== 'all' && s.category !== cat) return false;
      if (query && !s.label.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [surface, cat, query]);

  // Counts per chip — live, reflects the active tab + search but
  // ignores the chip itself (so users see how many they'd unlock
  // by tapping each chip).
  const chipCounts = useMemo(() => {
    const out = new Map<StapleCategory | 'all', number>();
    out.set('all', 0);
    for (const c of chips) out.set(c.id, 0);
    for (const s of DIRECTORY_STAPLES) {
      if (s.surface !== surface) continue;
      if (query && !s.label.toLowerCase().includes(query)) continue;
      out.set('all', (out.get('all') ?? 0) + 1);
      out.set(s.category, (out.get(s.category) ?? 0) + 1);
    }
    return out;
  }, [surface, query, chips]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      {/* Browse ↔ Staples explainer banner (v4-final §05) — pairs
          with the one on /pantry/staples to make the difference
          unmistakable: Browse is the LIBRARY; Staples is your
          curated subset. */}
      <div className="bg-[#FFF3D9] border border-hive-honey rounded-hive p-3 mb-4 flex items-start gap-3">
        <span className="text-xl leading-none">🧺</span>
        <div className="flex-1 min-w-0">
          <p className="font-nunito font-extrabold text-sm text-hive-honey-dk">The full library to pick from</p>
          <p className="text-[11px] text-hive-ink mt-0.5 leading-relaxed">
            Hundreds of items across Foods + Household. Promote to your
            {' '}
            <Link href="/pantry/staples" className="text-hive-honey-dk font-bold underline">Staples →</Link>
            {' '}so they show up in the next shop request.
          </p>
        </div>
      </div>
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Household · Browse Catalogue
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          Pantry items
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          The full library of pantry items — pick from Foods (fresh, dairy, cooking) or Household
          (cleaning, personal, dry goods).
        </p>
      </div>

      {/* Search — spans both tabs. */}
      <div className="sticky top-0 bg-hive-cream z-10 pt-2 pb-3 -mx-4 px-4 lg:-mx-8 lg:px-8">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-hive-muted text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the catalogue…"
            className="w-full bg-hive-paper border border-hive-line rounded-hive pl-10 pr-9 py-2.5 text-sm font-nunito font-bold placeholder:text-hive-muted placeholder:font-normal focus:outline-none focus:border-pantry-leaf"
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

        {/* Foods vs Household tabs */}
        <div className="flex gap-1 mt-3 border-b border-hive-line">
          <button
            type="button"
            onClick={() => switchSurface('food')}
            className={`px-4 py-2.5 -mb-px font-nunito font-extrabold text-sm border-b-[3px] ${
              surface === 'food'
                ? 'text-pantry-leaf-dk border-pantry-leaf'
                : 'text-hive-muted border-transparent'
            }`}
          >🥗 Foods</button>
          <button
            type="button"
            onClick={() => switchSurface('household')}
            className={`px-4 py-2.5 -mb-px font-nunito font-extrabold text-sm border-b-[3px] ${
              surface === 'household'
                ? 'text-pantry-leaf-dk border-pantry-leaf'
                : 'text-hive-muted border-transparent'
            }`}
          >🧴 Household</button>
        </div>

        {/* Category chips per active tab */}
        <div className="flex gap-1.5 mt-3 overflow-x-auto pb-1 -mx-1 px-1">
          {chips.map((c) => {
            const n = chipCounts.get(c.id) ?? 0;
            const active = cat === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCat(active && c.id !== 'all' ? 'all' : c.id)}
                disabled={n === 0 && c.id !== 'all'}
                className={`flex-shrink-0 text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border whitespace-nowrap disabled:opacity-40 ${
                  active
                    ? 'bg-pantry-leaf text-white border-pantry-leaf-dk'
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
      {items.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mt-3">
          <div className="text-3xl mb-2">🔍</div>
          <h3 className="font-nunito font-black text-lg">No matches</h3>
          <p className="text-hive-muted text-sm mt-1">
            Nothing in <strong>{surface === 'food' ? 'Foods' : 'Household'}</strong> matches your
            filters.
            {q || cat !== 'all' ? (
              <>
                {' '}
                <button onClick={() => { setQ(''); setCat('all'); }} className="text-pantry-leaf-dk font-bold underline">Clear filters</button>.
              </>
            ) : null}
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {items.map((s) => (
            <div key={s.label} className="bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-lg flex-shrink-0">
                {s.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{s.label}</div>
                <div className="text-[11px] text-hive-muted font-bold mt-0.5">
                  {s.defaultQty} {s.unit} · {s.cadence}
                  {s.note && ` · ${s.note}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-hive-muted text-center mt-8 font-bold">
        Want to promote an item into <Link href="/pantry/staples" className="text-pantry-leaf-dk underline">your Staples</Link>? Promote-from-Browse lands in the next iteration.
      </p>
    </div>
  );
}
