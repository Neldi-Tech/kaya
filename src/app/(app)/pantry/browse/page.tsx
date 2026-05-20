'use client';

// /pantry/browse — Master Catalogue v2 (2026-05-20). Kaya's global,
// enriched item library, in ONE hub with two sections:
//   🥗 Pantry Items   — food + household
//   🗂 Other Catalogue — outdoor · drivers · utilities
//
// Each card shows the global name + the family's local/native name,
// the brands people buy, and a typical price (FX-scaled). Search is
// brand-aware. Adding carries the local name + brands + price onto the
// family's Staple. Locale is driven by the family's country
// (location.country); a switcher previews other countries (Phase 2),
// and AI fills gaps for un-curated countries via /api/catalogue-suggest.

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { usePantry } from '@/contexts/PantryContext';
import {
  buildCatalogue, searchCatalogue, resolveLocale, catalogueItemToStaplePayload,
  localizePriceCents, type CatalogueItem, type CatalogueSection, type CatalogueModule,
} from '@/lib/catalogue';
import { suggestCatalogueLocales, COUNTRY_PICKS, countryLabel } from '@/lib/catalogueSuggest';
import { addStaple, type Staple } from '@/lib/pantry';
import { formatCents } from '@/components/pantry/format';
import { FOOD_CATEGORY_CHIPS, HOUSEHOLD_CATEGORY_CHIPS } from '@/lib/pantryDirectory';

const OTHER_TABS: { id: CatalogueModule; emoji: string; label: string }[] = [
  { id: 'outdoor', emoji: '🌿', label: 'Outdoor' },
  { id: 'drivers', emoji: '🚗', label: 'Drivers' },
  { id: 'utility', emoji: '⚡', label: 'Utilities' },
];

export default function BrowseCataloguePage() {
  const { profile, isGuest } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const { staples } = usePantry();
  const currency = config.currency;

  const [section, setSection] = useState<CatalogueSection>('pantry');
  const [surface, setSurface] = useState<'food' | 'household'>('food');
  const [otherModule, setOtherModule] = useState<CatalogueModule>('outdoor');
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Locale country — defaults to the family's, with a switcher (Phase 2
  // preview). AI gap-fill writes into this country's locale map.
  const familyCountry = family?.location?.country || 'TZ';
  const [country, setCountry] = useState<string>(familyCountry);
  const [showCountry, setShowCountry] = useState(false);
  useEffect(() => { setCountry(familyCountry); }, [familyCountry]);

  const catalogue = useMemo(() => buildCatalogue(), []);

  // AI gap-fill (Phase 2): for the items visible in the current view
  // that lack a locale for the chosen country, ask the AI once + merge
  // the result into the in-memory catalogue. Tagged source:'ai'.
  const [aiFilled, setAiFilled] = useState(0); // bump to re-render after merge
  useEffect(() => {
    if (isGuest) return;
    const lang = (family?.localLanguage || '').trim();
    const candidates = catalogue
      .filter((it) => (section === 'pantry' ? it.section === 'pantry' : it.section === 'other'))
      .filter((it) => !it.locales[country] || (!it.locales[country].localName && !it.locales[country].brands))
      .slice(0, 40);
    if (candidates.length === 0) return;
    let cancelled = false;
    (async () => {
      const filled = await suggestCatalogueLocales(
        candidates.map((it) => ({ id: it.id, globalName: it.globalName })),
        country, lang,
      );
      if (cancelled || !filled) return;
      let changed = false;
      for (const it of catalogue) {
        const f = filled[it.id];
        if (f && (f.localName || (f.brands && f.brands.length))) {
          it.locales[country] = { ...f, source: 'ai' };
          changed = true;
        }
      }
      if (changed) setAiFilled((n) => n + 1);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, section, catalogue, isGuest, family?.localLanguage]);

  // Already-added (by global name) → show ✓ Added.
  const addedNames = useMemo(
    () => new Set(staples.map((s) => s.name.toLowerCase())),
    [staples],
  );

  const chips = section === 'pantry'
    ? (surface === 'food' ? FOOD_CATEGORY_CHIPS : HOUSEHOLD_CATEGORY_CHIPS)
    : [];

  const items = useMemo(() => {
    return searchCatalogue(catalogue, {
      section,
      module: section === 'pantry' ? 'pantry' : otherModule,
      category: section === 'pantry' ? cat : 'all',
      country,
      query: q,
    }).filter((it) => (section === 'pantry' ? it.surface === surface : true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, section, surface, otherModule, cat, country, q, aiFilled]);

  const handleAdd = async (item: CatalogueItem) => {
    if (!profile?.familyId || isGuest) return;
    setBusyId(item.id);
    try {
      const payload = catalogueItemToStaplePayload(item, country, currency);
      await addStaple(profile.familyId, {
        ...payload,
        category: payload.category as Staple['category'],
        active: true,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[browse] add failed:', e);
    } finally {
      setBusyId(null);
    }
  };

  const switchSection = (s: CatalogueSection) => { setSection(s); setCat('all'); setQ(''); };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Household · Browse Catalogue
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          Kaya's global library 🌍
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          Pick from the master catalogue — local names, the brands people buy, and a typical price, tuned to your country. Adding pre-fills your Staples.
        </p>
        {/* Country chip — locale this view is tuned to. */}
        <div className="mt-2 relative inline-block">
          <button
            type="button"
            onClick={() => setShowCountry((v) => !v)}
            className="inline-flex items-center gap-1.5 bg-[#E5EFF8] border border-[#B5CFE5] rounded-full px-3 py-1.5 text-[11px] font-nunito font-extrabold text-[#264B6E]"
          >
            {countryLabel(country)}{family?.localLanguage ? ` · ${family.localLanguage}` : ''} ▾
          </button>
          {showCountry && (
            <div className="absolute z-20 mt-1 bg-white border border-hive-line rounded-hive shadow-lg p-1 w-48">
              {COUNTRY_PICKS.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => { setCountry(c.code); setShowCountry(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[12px] font-nunito font-bold ${
                    country === c.code ? 'bg-pantry-leaf-soft text-pantry-leaf-dk' : 'text-hive-ink hover:bg-hive-cream'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section toggle */}
      <div className="flex bg-hive-paper border border-hive-line rounded-hive p-1 mb-3">
        <button
          type="button"
          onClick={() => switchSection('pantry')}
          className={`flex-1 py-2.5 rounded-lg font-nunito font-extrabold text-sm ${
            section === 'pantry' ? 'bg-pantry-leaf text-white' : 'text-hive-muted'
          }`}
        >🥗 Pantry Items</button>
        <button
          type="button"
          onClick={() => switchSection('other')}
          className={`flex-1 py-2.5 rounded-lg font-nunito font-extrabold text-sm ${
            section === 'other' ? 'bg-hive-honey text-white' : 'text-hive-muted'
          }`}
        >🗂 Other Catalogue</button>
      </div>

      {/* Search (brand-aware) */}
      <div className="relative mb-3">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-hive-muted text-sm pointer-events-none">🔍</span>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or brand…"
          className="w-full bg-hive-paper border border-hive-line rounded-hive pl-10 pr-9 py-2.5 text-sm font-nunito font-bold placeholder:text-hive-muted placeholder:font-normal focus:outline-none focus:border-pantry-leaf"
        />
        {q && (
          <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-hive-line text-hive-muted text-sm font-black" aria-label="Clear">×</button>
        )}
      </div>

      {/* Sub-tabs: surface for Pantry, module for Other */}
      {section === 'pantry' ? (
        <div className="flex gap-1.5 mb-3">
          {(['food', 'household'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setSurface(s); setCat('all'); }}
              className={`flex-1 py-2 rounded-lg font-nunito font-extrabold text-xs border ${
                surface === s ? 'bg-pantry-leaf-soft border-pantry-leaf text-pantry-leaf-dk' : 'bg-hive-paper border-hive-line text-hive-muted'
              }`}
            >{s === 'food' ? '🥗 Foods' : '🧴 Household'}</button>
          ))}
        </div>
      ) : (
        <div className="flex gap-1.5 mb-3 overflow-x-auto">
          {OTHER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setOtherModule(t.id)}
              className={`flex-shrink-0 px-3 py-2 rounded-full font-nunito font-extrabold text-xs border ${
                otherModule === t.id ? 'bg-[#FFF3D9] border-hive-honey text-hive-honey-dk' : 'bg-hive-paper border-hive-line text-hive-muted'
              }`}
            >{t.emoji} {t.label}</button>
          ))}
        </div>
      )}

      {/* Pantry category chips */}
      {section === 'pantry' && (
        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCat(cat === c.id ? 'all' : c.id)}
              className={`flex-shrink-0 text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border whitespace-nowrap ${
                cat === c.id ? 'bg-pantry-leaf text-white border-pantry-leaf-dk' : 'bg-hive-paper border-hive-line text-hive-muted'
              }`}
            >{c.emoji} {c.label}</button>
          ))}
        </div>
      )}

      {/* Utilities: dedicated rich setup lives elsewhere — bridge note. */}
      {section === 'other' && otherModule === 'utility' && (
        <div className="bg-[#FFF3D9] border border-hive-honey rounded-hive p-3 mb-3 text-[12px] text-hive-ink">
          ⚡ Utilities are set up as <strong>recurring bills + regular top-ups</strong> (with suppliers, estimated amounts + reminders) in{' '}
          <Link href="/pantry/utility/setup" className="text-hive-honey-dk font-bold underline">Utilities setup →</Link>.
          The reference items below show what Kaya knows.
        </div>
      )}

      {/* Cards */}
      {items.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mt-3">
          <div className="text-3xl mb-2">🔍</div>
          <h3 className="font-nunito font-black text-lg">No matches</h3>
          <p className="text-hive-muted text-sm mt-1">
            Nothing matches your filters.
            {(q || cat !== 'all') && (
              <> <button onClick={() => { setQ(''); setCat('all'); }} className="text-pantry-leaf-dk font-bold underline">Clear</button>.</>
            )}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <CatalogueCard
              key={it.id}
              item={it}
              country={country}
              currency={currency}
              added={addedNames.has(it.globalName.toLowerCase())}
              busy={busyId === it.id}
              canAdd={section === 'pantry' || otherModule !== 'utility'}
              onAdd={() => handleAdd(it)}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] text-hive-muted text-center mt-6 font-bold">
        Added items land in your <Link href="/pantry/staples" className="text-pantry-leaf-dk underline">Staples</Link> with the local name + brands + price pre-filled.
      </p>
    </div>
  );
}

function CatalogueCard({
  item, country, currency, added, busy, canAdd, onAdd,
}: {
  item: CatalogueItem;
  country: string;
  currency: string;
  added: boolean;
  busy: boolean;
  canAdd: boolean;
  onAdd: () => void;
}) {
  const loc = resolveLocale(item, country);
  const priceCents = localizePriceCents(item.typicalPriceUsd, currency);
  const tint = item.section === 'pantry' ? 'bg-pantry-leaf-soft'
    : item.module === 'drivers' ? 'bg-[#E5EFF8]'
    : item.module === 'utility' ? 'bg-[#FFF3D9]' : 'bg-[#E6F2EC]';
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl ${tint} flex items-center justify-center text-lg flex-shrink-0`}>
          {item.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{item.globalName}</div>
          {loc.localName && (
            <div className="text-[11px] text-hive-muted font-bold italic truncate">
              {loc.localName}{loc.source === 'ai' ? ' ✨' : ''}
            </div>
          )}
          <div className="text-[11px] text-hive-muted font-bold mt-0.5">
            {item.defaultQty} {item.unit} · {item.cadence}
            {priceCents != null && (
              <> · <span className="text-pantry-leaf-dk font-black">≈ {formatCents(priceCents, currency)}</span></>
            )}
          </div>
        </div>
        {canAdd && (
          added ? (
            <span className="flex-shrink-0 bg-pantry-leaf-soft text-pantry-leaf-dk rounded-lg font-nunito font-black text-[11px] px-3 py-2">✓ Added</span>
          ) : (
            <button
              type="button"
              onClick={onAdd}
              disabled={busy}
              className="flex-shrink-0 bg-pantry-leaf text-white rounded-lg font-nunito font-black text-[11px] px-3 py-2 disabled:opacity-60"
            >{busy ? '…' : '＋ Add'}</button>
          )
        )}
      </div>
      {loc.brands && loc.brands.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 pl-[52px]">
          {loc.brands.map((b) => (
            <span
              key={b}
              className={`text-[9.5px] font-nunito font-extrabold rounded px-1.5 py-0.5 border ${
                loc.source === 'ai'
                  ? 'bg-[#F4EFFB] text-[#5E4A8F] border-[#C9B8E5]'
                  : 'bg-[#FFF3D9] text-hive-honey-dk border-hive-honey-soft'
              }`}
            >{loc.source === 'ai' ? '✨ ' : ''}{b}</span>
          ))}
        </div>
      )}
    </div>
  );
}
