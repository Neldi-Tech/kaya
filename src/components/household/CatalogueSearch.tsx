'use client';

// Combobox: search input + dropdown of catalogue matches + "Create new"
// tail option. Used by the Subscriptions Add form (catalogue_subs);
// contribs use is parallel and ships in a follow-up.
//
// On select: parent receives the catalogue entry's id + defaults so the
// form can pre-fill category/sub-cat/currency.
// On create-new: parent receives null id + the typed name; the form
// records the new catalogue entry in recordSubCatalogueUse on submit.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogueSubItem } from '@/lib/householdCatalogue';

export interface CatalogueSelection {
  id: string | null;       // null when user picked "Create new"
  name: string;
  category?: string;
  subCategory?: string;
  defaultCurrency?: string;
}

export function CatalogueSearch({
  items,
  value,
  onChange,
  label = 'Name',
  placeholder = 'e.g. Netflix · Spotify · Holy Family Parish',
}: {
  items: CatalogueSubItem[];
  value: CatalogueSelection;
  onChange: (sel: CatalogueSelection) => void;
  label?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Debounced filter
  const [filterTerm, setFilterTerm] = useState(value.name);
  useEffect(() => {
    const t = setTimeout(() => setFilterTerm(value.name), 200);
    return () => clearTimeout(t);
  }, [value.name]);

  const matches = useMemo(() => {
    const q = filterTerm.trim().toLowerCase();
    if (!q) return items.slice(0, 6);
    return items
      .filter((it) => it.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [filterTerm, items]);

  const exactMatch = items.find((it) => it.name.toLowerCase() === value.name.trim().toLowerCase());
  const showCreateOption = !!value.name.trim() && !exactMatch;

  return (
    <div className="space-y-1" ref={wrapRef}>
      <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          value={value.name}
          onChange={(e) => {
            onChange({ ...value, id: null, name: e.target.value });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
          autoComplete="off"
        />

        {open && (matches.length > 0 || showCreateOption) && (
          <div className="absolute z-20 mt-1 w-full rounded-kaya-sm bg-white border border-pulse-navy/15 shadow-lg max-h-64 overflow-y-auto">
            {matches.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => {
                  onChange({
                    id: it.id,
                    name: it.name,
                    category: it.category,
                    subCategory: it.subCategory,
                    defaultCurrency: it.defaultCurrency,
                  });
                  setOpen(false);
                }}
                className="block w-full text-left px-3 py-2 hover:bg-pulse-cream"
              >
                <div className="font-semibold text-pulse-navy">{it.name}</div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55">
                  {it.category}{it.subCategory ? ` · ${it.subCategory}` : ''}
                </div>
              </button>
            ))}
            {showCreateOption && (
              <button
                type="button"
                onClick={() => {
                  onChange({ ...value, id: null });
                  setOpen(false);
                }}
                className={`block w-full text-left px-3 py-2 hover:bg-pulse-cream ${matches.length ? 'border-t border-pulse-navy/8' : ''}`}
              >
                <span className="font-bold text-pulse-gold">+ Create</span>{' '}
                <span className="font-semibold text-pulse-navy">&ldquo;{value.name}&rdquo;</span>
                <div className="text-[11px] font-semibold text-pulse-navy/55">Adds it to your catalogue.</div>
              </button>
            )}
          </div>
        )}
      </div>

      {value.id && (
        <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-gold">
          ✓ From catalogue · pre-filled defaults
        </div>
      )}
    </div>
  );
}
