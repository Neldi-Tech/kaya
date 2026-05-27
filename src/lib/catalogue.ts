// Master Catalogue v2 (2026-05-20) — Kaya's global, enriched item library.
//
// The flat directory (pantryDirectory.ts) gives us ~340 English item
// templates. This layer turns each into a CatalogueItem with a per-
// country `locales` map: the local/native name, the brands people
// actually buy, and a typical price — so one global item carries many
// local faces. AI fills gaps for new countries (Phase 2).
//
// Phase 1 ships curated Tanzania (TZ) enrichment for the common shop +
// English-only for the rest. Adding an item to a family resolves their
// country → a normal Staple, pre-filled with the local name + brands +
// price.

import type { Cadence } from './pantry';
import {
  DIRECTORY_STAPLES, DIRECTORY_OUTDOOR, DIRECTORY_DRIVERS, DIRECTORY_UTILITIES, DIRECTORY_HOME,
} from './pantryDirectory';

// ── Types ──────────────────────────────────────────────────────

export type CatalogueSection = 'pantry' | 'other';
export type CatalogueModule = 'pantry' | 'outdoor' | 'drivers' | 'utility' | 'dineOut' | 'home' | 'subscriptions' | 'contributions';

/** Per-country localisation of a catalogue item. */
export interface CatalogueLocale {
  /** Local / native name, e.g. "Mchele" (TZ), "Chawal" (IN). */
  localName?: string;
  /** Brands people actually buy in this country, most-common first. */
  brands?: string[];
  /** 'curated' = human-checked; 'ai' = AI-suggested (lower confidence,
   *  shown with a ✨ chip until a parent confirms). */
  source?: 'curated' | 'ai';
}

export interface CatalogueItem {
  id: string;                 // stable slug — 'rice-white'
  section: CatalogueSection;  // the two top sections
  module: CatalogueModule;
  surface?: 'food' | 'household';
  category: string;
  emoji: string;
  globalName: string;         // canonical English
  defaultQty: number;
  unit: string;
  cadence: Cadence;
  /** USD per-unit baseline → scaled to the family's currency on display. */
  typicalPriceUsd?: number;
  match: string[];            // search aliases (names + brands folded in)
  locales: Record<string, CatalogueLocale>;  // by ISO country code
}

// ── Slug ───────────────────────────────────────────────────────

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Curated enrichment (TZ-first) ──────────────────────────────
// Keyed by the directory `label` (exact). { sw: Swahili name, tz:
// brands sold in Tanzania, usd: per-unit USD baseline }. Add more
// countries by extending the per-item locale map in buildCatalogue.

interface Enrich { sw?: string; tz?: string[]; usd?: number }

const ENRICH: Record<string, Enrich> = {
  // ── Food · dry / pantry ──
  'Rice (white)':       { sw: 'Mchele',            tz: ['Pishori', 'Basmati', 'Jasmine'], usd: 1.6 },
  'Rice (brown)':       { sw: 'Mchele wa kahawia', tz: ['Pishori'],                       usd: 2.0 },
  'Wheat flour':        { sw: 'Unga wa ngano',     tz: ['Azania', 'Bakhresa', 'Mo'],      usd: 1.0 },
  'Maize flour (ugali)':{ sw: 'Unga wa sembe',     tz: ['Azania', 'Mo', 'Dola'],          usd: 0.7 },
  'Sugar':              { sw: 'Sukari',            tz: ['Kilombero', 'Bakhresa', 'TPC'],  usd: 1.1 },
  'Salt':               { sw: 'Chumvi',            tz: ['Annapurna', 'Kay Salt'],         usd: 0.5 },
  'Cooking oil':        { sw: 'Mafuta ya kupika',  tz: ['Korie', 'Sunsweet', 'Fresh'],    usd: 2.4 },
  'Tea':                { sw: 'Chai',              tz: ['Africafe', 'Chai Bora', 'Kazi'], usd: 2.0 },
  'Coffee':             { sw: 'Kahawa',            tz: ['Africafe', 'Tanica'],            usd: 4.0 },
  'Beans (dry)':        { sw: 'Maharage',          tz: [],                                usd: 1.4 },
  'Green grams':        { sw: 'Choroko',           tz: [],                                usd: 1.6 },
  'Bread':              { sw: 'Mkate',             tz: ['Azam', 'Bakhresa'],              usd: 0.9 },
  'Pasta':              { sw: 'Tambi',             tz: ['Azania', 'Bakhresa'],            usd: 1.2 },
  'Coconut milk':       { sw: 'Tui la nazi',       tz: ['Dabaga'],                        usd: 1.5 },
  'Pilau masala':       { sw: 'Bizari ya pilau',   tz: ['Bina', 'Tropical Heat'],         usd: 1.0 },
  'Royco mchuzi mix':   { sw: 'Royco',             tz: ['Royco'],                         usd: 0.6 },
  'Mahindi (dry maize)':{ sw: 'Mahindi',           tz: [],                                usd: 0.6 },
  'Stock cubes':        { sw: 'Vibe vya supu',     tz: ['Royco', 'Knorr'],                usd: 0.5 },
  // ── Food · produce ──
  'Tomatoes':           { sw: 'Nyanya',            tz: [], usd: 0.9 },
  'Onions':             { sw: 'Vitunguu',          tz: [], usd: 0.8 },
  'Potatoes':           { sw: 'Viazi',             tz: [], usd: 0.7 },
  'Carrots':            { sw: 'Karoti',            tz: [], usd: 0.9 },
  'Cabbage':            { sw: 'Kabichi',           tz: [], usd: 0.6 },
  'Garlic':             { sw: 'Kitunguu saumu',    tz: [], usd: 2.0 },
  'Ginger':             { sw: 'Tangawizi',         tz: [], usd: 2.0 },
  'Lemons':             { sw: 'Limau',             tz: [], usd: 1.0 },
  'Chillies':           { sw: 'Pilipili',          tz: [], usd: 1.5 },
  'Coriander (dhania)': { sw: 'Dania',             tz: [], usd: 1.0 },
  'Spinach':            { sw: 'Mchicha',           tz: [], usd: 0.6 },
  'Kale (sukuma wiki)': { sw: 'Sukuma wiki',       tz: [], usd: 0.5 },
  'Plantain (matoke)':  { sw: 'Matoke / Ndizi',    tz: [], usd: 0.8 },
  'Cassava (muhogo)':   { sw: 'Muhogo',            tz: [], usd: 0.6 },
  'Bananas':            { sw: 'Ndizi',             tz: [], usd: 0.7 },
  'Mangoes':            { sw: 'Maembe',            tz: [], usd: 0.9 },
  'Oranges':            { sw: 'Machungwa',         tz: [], usd: 0.8 },
  'Avocados':           { sw: 'Maparachichi',      tz: [], usd: 0.6 },
  'Watermelon':         { sw: 'Tikiti maji',       tz: [], usd: 1.5 },
  'Pineapple':          { sw: 'Nanasi',            tz: [], usd: 1.0 },
  'Passion fruit':      { sw: 'Passion / Pasheni', tz: [], usd: 1.5 },
  // ── Food · dairy / protein ──
  'Milk':               { sw: 'Maziwa',            tz: ['Azam', 'Tanga Fresh', 'Asas'], usd: 1.0 },
  'UHT milk':           { sw: 'Maziwa ya ndoo',    tz: ['Azam', 'Asas'],                usd: 1.2 },
  'Yogurt':             { sw: 'Mtindi',            tz: ['Azam', 'Tanga Fresh'],         usd: 1.3 },
  'Butter':             { sw: 'Siagi',             tz: ['Blue Band'],                   usd: 3.0 },
  'Eggs':               { sw: 'Mayai',             tz: [],                              usd: 2.5 },
  'Chicken':            { sw: 'Kuku',              tz: ['Interchick', 'Tanbreed'],      usd: 4.0 },
  'Beef':               { sw: 'Nyama ya ng’ombe', tz: [],                          usd: 4.5 },
  'Goat meat':          { sw: 'Nyama ya mbuzi',    tz: [],                              usd: 5.0 },
  'Fish (tilapia)':     { sw: 'Sato / Samaki',     tz: [],                              usd: 3.5 },
  // ── Household ──
  'Dish soap':          { sw: 'Sabuni ya vyombo',  tz: ['Foma', 'Sunlight'],            usd: 2.5 },
  'Laundry detergent':  { sw: 'Sabuni ya nguo',    tz: ['Omo', 'Foma', 'Toss'],         usd: 3.0 },
  'Bleach':             { sw: 'Jik',               tz: ['Jik'],                         usd: 1.5 },
  'Toilet cleaner':     { sw: 'Dawa ya choo',      tz: ['Harpic'],                      usd: 2.0 },
  'Floor cleaner':      { sw: 'Dawa ya sakafu',    tz: ['Dettol', 'Lifebuoy'],          usd: 2.5 },
  'Toilet paper':       { sw: 'Karatasi ya choo',  tz: ['Hanan', 'Embassy'],            usd: 2.0 },
  'Paper towels':       { sw: 'Tisu',              tz: ['Hanan'],                       usd: 1.5 },
  // ── Outdoor ──
  'Layers mash':        { sw: 'Chakula cha kuku',  tz: ['Pembe', 'Falcon', 'Silverlands'], usd: 22 },
  'Chick starter':      { sw: 'Chakula cha vifaranga', tz: ['Pembe', 'Falcon'],          usd: 24 },
  'Broiler feed':       { sw: 'Chakula cha broiler', tz: ['Pembe', 'Falcon'],           usd: 23 },
  'Manure / compost':   { sw: 'Samadi',            tz: [], usd: 5 },
  'Fertiliser (NPK)':   { sw: 'Mbolea (NPK)',      tz: ['Yara', 'Minjingu'],            usd: 25 },
  'Pool chlorine':      { sw: 'Klorini ya bwawa',  tz: [], usd: 18 },
  // ── Drivers ──
  'Petrol (regular)':   { sw: 'Petroli',           tz: ['Oryx', 'Puma', 'Total', 'Lake Oil'], usd: 1.3 },
  'Diesel':             { sw: 'Dizeli',            tz: ['Oryx', 'Puma', 'Total', 'Lake Oil'], usd: 1.2 },
  'Engine oil':         { sw: 'Oili ya injini',    tz: ['Total', 'Castrol', 'Oryx'],    usd: 12 },
  'Brake fluid':        { sw: 'Maji ya breki',     tz: ['Total', 'Castrol'],            usd: 6 },
  'Coolant / antifreeze':{ sw: 'Maji ya redieta',  tz: ['Total'],                       usd: 8 },
  'Wiper blades':       { sw: 'Wiper',             tz: ['Bosch'],                       usd: 10 },
  // ── Utility (gas refill is common; brand-led) ──
  'Gas refill / LPG':   { sw: 'Gesi',              tz: ['Oryx', 'Taifa Gas', 'Lake Gas', 'Manjis'], usd: 11 },
};

// ── Currency scaling for the "≈" price guidance ────────────────
// USD baseline × factor → local "feels right" figure (purchasing-power
// scaled, not 1× FX). Mirrors the budget starter-pack scaling.
function currencyScale(currency: string): number {
  switch (currency) {
    case 'TZS': return 2500;
    case 'KES': return 130;
    case 'NGN': return 1500;
    case 'UGX': return 3700;
    case 'AED': return 4;
    case 'INR': return 85;
    case 'ZAR': return 19;
    case 'EUR': case 'GBP': return 1;
    default:    return 1;
  }
}

/** USD per-unit baseline → cents in the family's display currency. */
export function localizePriceCents(usd: number | undefined, currency: string): number | undefined {
  if (usd == null || usd <= 0) return undefined;
  return Math.round(usd * currencyScale(currency) * 100);
}

// ── Country → curated locale ───────────────────────────────────
// Phase 1 ships TZ enrichment. Other countries get English-only until
// the AI engine (Phase 2) fills them. We expose the TZ data under 'TZ'
// so the locale resolver + the Phase-2 cache share one shape.

function curatedLocales(label: string): Record<string, CatalogueLocale> {
  const e = ENRICH[label];
  if (!e) return {};
  const tz: CatalogueLocale = { source: 'curated' };
  if (e.sw) tz.localName = e.sw;
  if (e.tz && e.tz.length) tz.brands = e.tz;
  return (tz.localName || tz.brands) ? { TZ: tz } : {};
}

// ── Builder ────────────────────────────────────────────────────

let _cache: CatalogueItem[] | null = null;

/** Build the full enriched catalogue from all four directories +
 *  the curated enrichment overlay. Memoised — the directory is static. */
export function buildCatalogue(): CatalogueItem[] {
  if (_cache) return _cache;
  const out: CatalogueItem[] = [];

  for (const s of DIRECTORY_STAPLES) {
    const e = ENRICH[s.label];
    out.push({
      id: slugify(s.label),
      section: 'pantry',
      module: 'pantry',
      surface: s.surface,
      category: s.category,
      emoji: s.emoji,
      globalName: s.label,
      defaultQty: s.defaultQty,
      unit: s.unit,
      cadence: s.cadence,
      typicalPriceUsd: e?.usd,
      match: dedupeMatch(s.match, s.label, e),
      locales: curatedLocales(s.label),
    });
  }
  for (const o of DIRECTORY_OUTDOOR) {
    const e = ENRICH[o.label];
    out.push({
      id: slugify(o.label), section: 'other', module: 'outdoor',
      category: o.category, emoji: o.emoji, globalName: o.label,
      defaultQty: o.defaultQty, unit: o.unit, cadence: o.cadence,
      typicalPriceUsd: e?.usd, match: dedupeMatch(o.match, o.label, e),
      locales: curatedLocales(o.label),
    });
  }
  for (const d of DIRECTORY_DRIVERS) {
    const e = ENRICH[d.label];
    out.push({
      id: slugify(d.label), section: 'other', module: 'drivers',
      category: d.category, emoji: d.emoji, globalName: d.label,
      defaultQty: d.defaultQty, unit: d.unit, cadence: d.cadence,
      typicalPriceUsd: e?.usd, match: dedupeMatch(d.match, d.label, e),
      locales: curatedLocales(d.label),
    });
  }
  for (const u of DIRECTORY_UTILITIES) {
    const e = ENRICH[u.label];
    out.push({
      id: slugify(u.label), section: 'other', module: 'utility',
      category: u.category, emoji: u.emoji, globalName: u.label,
      defaultQty: (u as { defaultQty?: number }).defaultQty ?? 1,
      unit: (u as { unit?: string }).unit ?? 'x',
      cadence: (u as { cadence?: Cadence }).cadence ?? 'monthly',
      typicalPriceUsd: e?.usd, match: dedupeMatch(u.match, u.label, e),
      locales: curatedLocales(u.label),
    });
  }
  for (const h of DIRECTORY_HOME) {
    const e = ENRICH[h.label];
    out.push({
      id: slugify(h.label), section: 'other', module: 'home',
      category: h.category, emoji: h.emoji, globalName: h.label,
      defaultQty: h.defaultQty, unit: h.unit, cadence: h.cadence,
      typicalPriceUsd: e?.usd, match: dedupeMatch(h.match, h.label, e),
      locales: curatedLocales(h.label),
    });
  }
  _cache = out;
  return out;
}

/** Fold the local name + brands into the search aliases so a brand or
 *  native-name query hits the item. */
function dedupeMatch(base: string[], label: string, e?: Enrich): string[] {
  const set = new Set<string>(base.map((m) => m.toLowerCase()));
  set.add(label.toLowerCase());
  if (e?.sw) set.add(e.sw.toLowerCase());
  for (const b of e?.tz ?? []) set.add(b.toLowerCase());
  return Array.from(set);
}

// ── Locale resolver ────────────────────────────────────────────

/** Resolve the best locale for a family's country. Falls back to {}
 *  (English-only) when nothing curated/cached exists yet. AI gap-fill
 *  (Phase 2) merges into the same `locales` map keyed by country. */
export function resolveLocale(item: CatalogueItem, country: string | undefined): CatalogueLocale {
  if (!country) return {};
  return item.locales[country] ?? {};
}

// ── Search (brand-aware) ───────────────────────────────────────

/** Filter by section + module + category + a brand-aware query (name +
 *  local name + brands + aliases). */
export function searchCatalogue(
  items: CatalogueItem[],
  opts: { section?: CatalogueSection; module?: CatalogueModule; category?: string; country?: string; query?: string },
): CatalogueItem[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  return items.filter((it) => {
    if (opts.section && it.section !== opts.section) return false;
    if (opts.module && it.module !== opts.module) return false;
    if (opts.category && opts.category !== 'all' && it.category !== opts.category) return false;
    if (!q) return true;
    if (it.globalName.toLowerCase().includes(q)) return true;
    if (it.match.some((m) => m.includes(q))) return true;
    // Search the resolved-country brands + local name explicitly too.
    const loc = resolveLocale(it, opts.country);
    if (loc.localName && loc.localName.toLowerCase().includes(q)) return true;
    if (loc.brands?.some((b) => b.toLowerCase().includes(q))) return true;
    return false;
  });
}

// ── Add-to-family payload ──────────────────────────────────────

/** Resolve a catalogue item + the family's country/currency into the
 *  fields a Staple needs. The caller adds module + active + status. */
export function catalogueItemToStaplePayload(
  item: CatalogueItem,
  country: string | undefined,
  currency: string,
): {
  name: string; name2?: string; category: string; defaultQty: number;
  unit: string; cadence: Cadence; preferredBrands?: string[];
  defaultPriceCents?: number; module: CatalogueModule;
} {
  const loc = resolveLocale(item, country);
  return {
    name: item.globalName,
    name2: loc.localName,
    category: item.category,
    defaultQty: item.defaultQty,
    unit: item.unit,
    cadence: item.cadence,
    preferredBrands: loc.brands && loc.brands.length ? loc.brands.slice(0, 3) : undefined,
    defaultPriceCents: localizePriceCents(item.typicalPriceUsd, currency),
    module: item.module,
  };
}
