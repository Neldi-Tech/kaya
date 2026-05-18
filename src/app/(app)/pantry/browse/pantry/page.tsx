'use client';

// /pantry/browse/pantry — Pantry catalogue, grouped by category.
//
// Per v3 design (Decision A): each module's catalogue groups items by
// category for fast scanning. Pantry uses StapleCategory (produce /
// dairy / pantry-staples / cleaning / personal / other). Sticky search
// at the top, category-header sections below. Search filters within
// the grouped layout — when the user types, sections with no matches
// collapse away.
//
// This is the new home for Pantry catalogue browsing — the old
// /pantry/directory still works but the More sheet now points here.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { usePantry } from '@/contexts/PantryContext';
import {
  STAPLE_CATEGORIES, type StapleCategory, type Staple,
} from '@/lib/pantry';
import { formatCents } from '@/components/pantry/format';

export default function PantryCataloguePage() {
  const { staples } = usePantry();
  const { config } = useHive();
  const { profile } = useAuth();
  const currency = config.currency;
  const isParent = profile?.role === 'parent';

  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  // Pantry-scoped staples only — Outdoor / Drivers items have their
  // own catalogue routes (or will, when those tiles get full pages).
  // Skip `pending_promote` items — those wait in the catalogue
  // promotion queue until a parent reviews them.
  const pantryStaples = useMemo(
    () => staples.filter(
      (s) => (s.module ?? 'pantry') === 'pantry' && s.status !== 'pending_promote',
    ),
    [staples],
  );
  const matches = useMemo(
    () => query ? pantryStaples.filter((s) => s.name.toLowerCase().includes(query)) : pantryStaples,
    [pantryStaples, query],
  );

  // Group by category. Empty groups are hidden when the user searches
  // (avoids "Dairy (0)" noise during a query); shown when idle so the
  // user can see all categories exist.
  const groups = useMemo(() => {
    const byCat = new Map<StapleCategory, Staple[]>();
    for (const cat of STAPLE_CATEGORIES) byCat.set(cat.id, []);
    for (const s of matches) {
      const cat = (s.category ?? 'other') as StapleCategory;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(s);
    }
    return STAPLE_CATEGORIES
      .map((c) => ({ ...c, items: byCat.get(c.id) ?? [] }))
      .filter((g) => query === '' || g.items.length > 0);
  }, [matches, query]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Browse · Pantry
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          Pantry catalogue
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          {pantryStaples.length} item{pantryStaples.length === 1 ? '' : 's'} · grouped by category.
          {isParent && (
            <>
              {' '}
              Add new staples from <Link href="/pantry/staples" className="text-pantry-leaf-dk font-bold underline">Staples</Link>.
            </>
          )}
        </p>
        <Link href="/pantry/browse" className="text-[12px] text-pantry-leaf-dk font-bold no-underline hover:underline mt-2 inline-block">
          ← Back to Browse
        </Link>
      </div>

      {/* Sticky search */}
      <div className="sticky top-0 bg-hive-cream z-10 pt-2 pb-3 -mx-4 px-4 lg:-mx-8 lg:px-8">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-hive-muted text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${pantryStaples.length} pantry item${pantryStaples.length === 1 ? '' : 's'}…`}
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
      </div>

      {/* Empty states */}
      {pantryStaples.length === 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mt-3">
          <div className="text-3xl mb-2">🛒</div>
          <h3 className="font-nunito font-black text-lg">No pantry items yet</h3>
          <p className="text-hive-muted text-sm mt-1">
            {isParent
              ? 'Head to Staples and add your family\'s usual groceries to start the catalogue.'
              : 'A parent needs to add staples before this catalogue fills up.'}
          </p>
        </div>
      )}
      {pantryStaples.length > 0 && matches.length === 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mt-3">
          <div className="text-3xl mb-2">🔍</div>
          <h3 className="font-nunito font-black text-lg">No matches</h3>
          <p className="text-hive-muted text-sm mt-1">
            No pantry items match "<span className="font-bold">{q}</span>". Clear the search or add the item to your Staples.
          </p>
        </div>
      )}

      {/* Grouped list */}
      {groups.map((g) => (
        g.items.length === 0 ? (
          <div key={g.id} className="mt-5 opacity-50">
            <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted flex items-center gap-2 mb-2">
              <span>{g.emoji} {g.label}</span>
              <span className="bg-hive-paper border border-hive-line rounded-full px-2 py-0.5 text-[10px]">0</span>
            </div>
            <p className="text-[11px] text-hive-muted italic">No items in this category yet.</p>
          </div>
        ) : (
          <div key={g.id} className="mt-5">
            <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-pantry-leaf-dk flex items-center gap-2 mb-2">
              <span>{g.emoji} {g.label}</span>
              <span className="bg-hive-paper border border-hive-line rounded-full px-2 py-0.5 text-[10px] text-hive-muted">{g.items.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {g.items.map((s) => (
                <div key={s.id} className="bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-base flex-shrink-0">
                    {g.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{s.name}</div>
                    <div className="text-[11px] text-hive-muted font-bold mt-0.5">
                      {s.defaultQty} {s.unit}
                      {s.lastBoughtCents != null && ` · last ${formatCents(s.lastBoughtCents, currency)}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ))}
    </div>
  );
}
