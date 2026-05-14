'use client';

// /pantry/directory — Browse-everything catalog. Two surfaces:
//   STAPLES tab: the built-in product catalog (food + household)
//     split by sub-category and region, layered with this family's
//     own edits + additions (see lib/pantryCatalog.ts). Tap a card to
//     multi-select; ✏️ opens a full inline editor; a sticky bar
//     surfaces "Save N to staples".
//   FOODS tab: popular dishes filterable by meal, region, diet. Each
//     card "+ Staples" bulk-adds the dish's ingredient list.
//
// The catalog the staples tab renders is per-family: the built-in
// DIRECTORY_STAPLES seed it, and each family's edits / new items are
// a Firestore overlay merged on top — synced across the family,
// invisible to other families.
//
// Layout is a single column on phones (mobile-first) and a 2-column
// grid for staples at lg+ to mirror the desktop screenshots.

import { useEffect, useMemo, useState } from 'react';
import BackButton from '@/components/ui/BackButton';
import NumberInput from '@/components/ui/NumberInput';
import { useAuth } from '@/contexts/AuthContext';
import { usePantry } from '@/contexts/PantryContext';
import { useHive } from '@/contexts/HiveContext';
import { addStaple, STAPLE_UNITS, type Cadence } from '@/lib/pantry';
import { estimateLineCents } from '@/lib/pricing';
import { formatCents } from '@/components/pantry/format';
import {
  DIRECTORY_STAPLES, DIRECTORY_FOODS,
  REGIONS, DIETS, MEALS,
  FOOD_CATEGORY_CHIPS, HOUSEHOLD_CATEGORY_CHIPS,
  STARTER_PACKS, resolveStarterPack,
  type Surface, type Region, type Diet, type MealType,
  type DirectoryFood, type StarterPack,
} from '@/lib/pantryDirectory';
import type { StapleCategory } from '@/lib/pantry';
import {
  subscribeToCatalog, mergeCatalog, entryToInput,
  saveCatalogOverride, addCustomItem, updateCustomItem, deleteCatalogItem,
  type CatalogItemDoc, type CatalogItemInput, type CatalogEntry,
} from '@/lib/pantryCatalog';

type Tab = 'staples' | 'foods';

const CADENCE_LABELS: Record<string, string> = {
  daily: 'daily',
  weekly: 'weekly',
  biweekly: 'biweekly',
  monthly: 'monthly',
  'as-needed': 'as needed',
};

const CADENCE_OPTIONS: { id: Cadence; label: string }[] = [
  { id: 'daily',     label: 'Daily' },
  { id: 'weekly',    label: 'Weekly' },
  { id: 'biweekly',  label: '2× / week' },
  { id: 'monthly',   label: 'Monthly' },
  { id: 'as-needed', label: 'As needed' },
];

const CATEGORY_OPTIONS: { id: StapleCategory; label: string }[] = [
  { id: 'produce',  label: 'Produce' },
  { id: 'dairy',    label: 'Dairy' },
  { id: 'pantry',   label: 'Pantry' },
  { id: 'cleaning', label: 'Cleaning' },
  { id: 'personal', label: 'Personal' },
  { id: 'other',    label: 'Other' },
];

const SURFACE_OPTIONS: { id: Surface; label: string }[] = [
  { id: 'food',      label: 'Food' },
  { id: 'household', label: 'Household' },
];

// Editor region picker — concrete regions only (the 'any' filter
// option isn't a valid value for a catalog item).
const REGION_OPTIONS = REGIONS.filter(
  (r): r is { id: Region; emoji: string; label: string } => r.id !== 'any',
);

export default function PantryDirectoryPage() {
  const { profile, isGuest } = useAuth();
  const { staples } = usePantry();
  const { config } = useHive();
  const currency = config.currency;
  const canEdit = !isGuest; // parents + helpers edit; guests read-only

  const [tab, setTab] = useState<Tab>('staples');
  const [surface, setSurface] = useState<Surface>('food');
  const [foodCategory, setFoodCategory] = useState<StapleCategory | 'all'>('all');
  const [householdCategory, setHouseholdCategory] = useState<StapleCategory | 'all'>('all');
  const [region, setRegion] = useState<Region | 'any'>('any');
  const [meal, setMeal] = useState<MealType | 'all'>('all');
  const [diet, setDiet] = useState<Diet | 'any'>('any');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [packsOpen, setPacksOpen] = useState(true);
  const [packBusy, setPackBusy] = useState<string | null>(null);

  // Per-family catalog overlay (Firestore). `catalogDocs` is the raw
  // overlay; `catalog` is it merged onto the built-in DIRECTORY_STAPLES.
  const [catalogDocs, setCatalogDocs] = useState<CatalogItemDoc[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [itemBusy, setItemBusy] = useState(false);

  useEffect(() => {
    if (!profile?.familyId || isGuest) return;
    return subscribeToCatalog(profile.familyId, setCatalogDocs);
  }, [profile?.familyId, isGuest]);

  const catalog = useMemo(() => mergeCatalog(catalogDocs), [catalogDocs]);

  // Already in the family's staples (by lower-cased name) — used to
  // flag duplicates and skip them on bulk-save.
  const ownedNames = useMemo(
    () => new Set(staples.map((s) => s.name.toLowerCase())),
    [staples],
  );

  const visibleStaples = useMemo(() => {
    const cat = surface === 'food' ? foodCategory : householdCategory;
    const q = search.trim().toLowerCase();
    return catalog.filter((s) => {
      if (s.surface !== surface) return false;
      if (cat !== 'all' && s.category !== cat) return false;
      if (region !== 'any' && s.region !== region) return false;
      if (q && !s.label.toLowerCase().includes(q) && !s.match.some((m) => m.includes(q))) return false;
      return true;
    });
  }, [catalog, surface, foodCategory, householdCategory, region, search]);

  const visibleFoods = useMemo(() => {
    const q = search.trim().toLowerCase();
    return DIRECTORY_FOODS.filter((f) => {
      if (meal !== 'all' && !f.meals.includes(meal)) return false;
      if (region !== 'any' && f.region !== region) return false;
      if (diet !== 'any' && !f.diets.includes(diet)) return false;
      if (q && !f.label.toLowerCase().includes(q) && !f.match.some((m) => m.includes(q))) return false;
      return true;
    });
  }, [meal, region, diet, search]);

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2500);
  };

  const saveSelected = async () => {
    if (!profile?.familyId || isGuest || selected.size === 0) return;
    setSaving(true);
    let added = 0;
    let skipped = 0;
    for (const key of Array.from(selected)) {
      const entry = catalog.find((e) => e.key === key);
      if (!entry) continue;
      if (ownedNames.has(entry.label.toLowerCase())) { skipped++; continue; }
      await addStaple(profile.familyId, {
        name: entry.label,
        category: entry.category,
        defaultQty: entry.defaultQty,
        unit: entry.unit,
        cadence: entry.cadence,
        lastBoughtCents: entry.priceCents ?? estimateLineCents(entry, entry.defaultQty, currency),
      });
      added++;
    }
    setSelected(new Set());
    setSaving(false);
    flashToast(
      added === 0
        ? 'Already in your staples'
        : `Added ${added} staple${added === 1 ? '' : 's'}${skipped > 0 ? ` · ${skipped} already had` : ''}`,
    );
  };

  const addStarterPack = async (pack: StarterPack) => {
    if (!profile?.familyId || isGuest) return;
    setPackBusy(pack.id);
    const resolved = resolveStarterPack(pack);
    let added = 0;
    let skipped = 0;
    for (const { staple, qty } of resolved) {
      if (ownedNames.has(staple.label.toLowerCase())) { skipped++; continue; }
      await addStaple(profile.familyId, {
        name: staple.label,
        category: staple.category,
        defaultQty: qty,
        unit: staple.unit,
        cadence: staple.cadence,
        lastBoughtCents: estimateLineCents(staple, qty, currency),
      });
      added++;
    }
    setPackBusy(null);
    flashToast(
      added === 0
        ? `Your pantry already has ${pack.label.toLowerCase()} staples`
        : `Added ${added} from ${pack.label}${skipped > 0 ? ` · skipped ${skipped} you already had` : ''}`,
    );
  };

  const addFoodIngredients = async (food: DirectoryFood) => {
    if (!profile?.familyId || isGuest) return;
    let added = 0;
    for (const name of food.ingredients) {
      if (ownedNames.has(name.toLowerCase())) continue;
      // Resolve through the family catalog so an edited built-in
      // (renamed / re-priced) is what actually gets added.
      const entry = catalog.find((e) => e.baseLabel === name);
      if (!entry || ownedNames.has(entry.label.toLowerCase())) continue;
      await addStaple(profile.familyId, {
        name: entry.label,
        category: entry.category,
        defaultQty: entry.defaultQty,
        unit: entry.unit,
        cadence: entry.cadence,
        lastBoughtCents: entry.priceCents ?? estimateLineCents(entry, entry.defaultQty, currency),
      });
      added++;
    }
    flashToast(added === 0 ? `${food.label} ingredients already saved` : `Added ${added} from ${food.label}`);
  };

  // ── Catalog editing ───────────────────────────────────────────
  const handleSaveEntry = async (entry: CatalogEntry, input: CatalogItemInput) => {
    if (!profile?.familyId || isGuest) return;
    setItemBusy(true);
    if (entry.isCustom && entry.docId) {
      await updateCustomItem(profile.familyId, entry.docId, input);
    } else if (entry.baseLabel) {
      await saveCatalogOverride(profile.familyId, entry.baseLabel, input, entry.docId, profile.uid);
    }
    setItemBusy(false);
    setEditingKey(null);
    flashToast(`Saved ${input.label.trim()}`);
  };

  const handleRemoveEntry = async (entry: CatalogEntry) => {
    if (!profile?.familyId || isGuest || !entry.docId) return;
    setItemBusy(true);
    await deleteCatalogItem(profile.familyId, entry.docId);
    setItemBusy(false);
    setEditingKey(null);
    // A deleted custom item's row disappears — drop it from selection.
    if (entry.isCustom) {
      setSelected((prev) => {
        if (!prev.has(entry.key)) return prev;
        const next = new Set(prev);
        next.delete(entry.key);
        return next;
      });
    }
    flashToast(entry.isCustom ? `Removed ${entry.label}` : `Reset ${entry.label} to default`);
  };

  const handleAddItem = async (input: CatalogItemInput) => {
    if (!profile?.familyId || isGuest) return;
    setItemBusy(true);
    await addCustomItem(profile.familyId, input, profile.uid);
    setItemBusy(false);
    setAddingItem(false);
    flashToast(`Added ${input.label.trim()} to your catalog`);
  };

  // Sensible defaults for a brand-new item — seeded from the tab +
  // region the parent is currently looking at.
  const blankInput = (): CatalogItemInput => ({
    label: '',
    emoji: '📦',
    surface,
    category: surface === 'food' ? 'pantry' : 'cleaning',
    region: region === 'any' ? 'global' : region,
    defaultQty: 1,
    unit: 'kg',
    cadence: 'weekly',
  });

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32 lg:pb-12">
      <div className="lg:hidden"><BackButton /></div>

      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Pantry · Directory
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">
          Browse everything 🧺
        </h1>
        <p className="text-[12px] lg:text-[13px] text-hive-muted mt-1">
          Tap to multi-select · ✏️ to edit details or add your own.
        </p>
      </div>

      {/* Top tabs */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <TopTab active={tab === 'staples'} onClick={() => { setTab('staples'); setSelected(new Set()); }}>
          🧺 Staples · {DIRECTORY_STAPLES.length}
        </TopTab>
        <TopTab active={tab === 'foods'} onClick={() => { setTab('foods'); setSelected(new Set()); }}>
          🍱 Foods · {DIRECTORY_FOODS.length}
        </TopTab>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === 'staples' ? '🔎  Search rice, omo, eggs…' : '🔎  Search ugali, biryani, mango…'}
          className="w-full h-12 px-4 rounded-hive-pill bg-hive-paper border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </div>

      {tab === 'staples' ? (
        <>
          {/* Starter packs — one-tap bulk-add by household size. */}
          <div className="mb-4 bg-pantry-leaf-soft/50 border border-pantry-leaf/40 rounded-hive-lg p-3 lg:p-4">
            <button
              type="button"
              onClick={() => setPacksOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 text-left"
            >
              <div className="min-w-0">
                <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-pantry-leaf-dk">
                  Quick start · by household size
                </p>
                <p className="font-nunito font-extrabold text-[14px] lg:text-[15px] mt-0.5 truncate">
                  Pick a pack — we'll seed your staples in one tap ✨
                </p>
              </div>
              <span className="text-pantry-leaf-dk font-black text-base shrink-0">{packsOpen ? '−' : '+'}</span>
            </button>

            {packsOpen && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mt-3">
                {STARTER_PACKS.map((pack) => {
                  const itemCount = pack.items.length;
                  const busy = packBusy === pack.id;
                  return (
                    <button
                      key={pack.id}
                      type="button"
                      onClick={() => addStarterPack(pack)}
                      disabled={isGuest || busy || packBusy !== null}
                      className="text-left bg-hive-paper border border-hive-line rounded-hive p-3 hover:border-pantry-leaf transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-2xl leading-none shrink-0">{pack.emoji}</span>
                        <div className="min-w-0">
                          <p className="font-nunito font-extrabold text-[13px] truncate">{pack.label}</p>
                          <p className="text-[10px] text-hive-muted">{pack.sizeRange}</p>
                        </div>
                      </div>
                      <p className="text-[11px] text-hive-muted mt-2 leading-snug">{pack.description}</p>
                      <p className="mt-2 text-[11px] font-nunito font-extrabold text-pantry-leaf-dk">
                        {busy ? 'Adding…' : `+ Add ${itemCount} staples →`}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <SubTab active={surface === 'food'} onClick={() => { setSurface('food'); setSelected(new Set()); }}>
              🍱 Food
            </SubTab>
            <SubTab active={surface === 'household'} onClick={() => { setSurface('household'); setSelected(new Set()); }}>
              🧺 Household
            </SubTab>
          </div>

          {/* Sub-category + region chip rows */}
          <ChipRow>
            {(surface === 'food' ? FOOD_CATEGORY_CHIPS : HOUSEHOLD_CATEGORY_CHIPS).map((c) => (
              <Chip
                key={c.id}
                active={(surface === 'food' ? foodCategory : householdCategory) === c.id}
                onClick={() => surface === 'food' ? setFoodCategory(c.id) : setHouseholdCategory(c.id)}
              >
                {c.emoji} {c.label}
              </Chip>
            ))}
          </ChipRow>

          <ChipRow>
            {REGIONS.map((r) => (
              <Chip key={r.id} active={region === r.id} onClick={() => setRegion(r.id)}>
                {r.emoji} {r.label}
              </Chip>
            ))}
          </ChipRow>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mt-2 items-start">
            {/* Add-your-own-item — opens a full inline editor. */}
            {canEdit && (
              addingItem ? (
                <div className="bg-hive-paper border-2 border-pantry-leaf rounded-hive p-3">
                  <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.4px] text-pantry-leaf-dk mb-2">
                    New catalog item
                  </p>
                  <CatalogItemEditor
                    initial={blankInput()}
                    mode="add"
                    currency={currency}
                    busy={itemBusy}
                    onSave={handleAddItem}
                    onCancel={() => setAddingItem(false)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setAddingItem(true); setEditingKey(null); }}
                  className="min-h-[68px] border-2 border-dashed border-hive-line rounded-hive p-3 flex items-center justify-center gap-1.5 text-pantry-leaf-dk font-nunito font-extrabold text-[13px] hover:border-pantry-leaf hover:bg-pantry-leaf-soft/30 transition-colors"
                >
                  ＋ Add your own item
                </button>
              )
            )}

            {visibleStaples.map((s) => (
              <StapleCard
                key={s.key}
                entry={s}
                selected={selected.has(s.key)}
                owned={ownedNames.has(s.label.toLowerCase())}
                currency={currency}
                canEdit={canEdit}
                editing={editingKey === s.key}
                busy={itemBusy && editingKey === s.key}
                onTap={() => toggleSelect(s.key)}
                onEdit={() => { setEditingKey(s.key); setAddingItem(false); }}
                onCancelEdit={() => setEditingKey(null)}
                onSave={(input) => handleSaveEntry(s, input)}
                onRemove={s.docId ? () => handleRemoveEntry(s) : undefined}
              />
            ))}
          </div>

          {visibleStaples.length === 0 && (
            <p className="text-[12px] text-hive-muted text-center mt-3">
              No catalog items match these filters.
            </p>
          )}
        </>
      ) : (
        <>
          <ChipRow>
            {MEALS.map((m) => (
              <Chip key={m.id} active={meal === m.id} onClick={() => setMeal(m.id)}>
                {m.emoji} {m.label}
              </Chip>
            ))}
          </ChipRow>

          <ChipRow>
            {REGIONS.map((r) => (
              <Chip key={r.id} active={region === r.id} onClick={() => setRegion(r.id)}>
                {r.emoji} {r.label}
              </Chip>
            ))}
          </ChipRow>

          <ChipRow>
            {DIETS.map((d) => (
              <Chip key={d.id} active={diet === d.id} onClick={() => setDiet(d.id)}>
                {d.emoji} {d.label}
              </Chip>
            ))}
          </ChipRow>

          {visibleFoods.length === 0 ? (
            <EmptyState message="No dishes match these filters." />
          ) : (
            <div className="space-y-2 mt-2">
              {visibleFoods.map((f) => (
                <FoodCard key={f.label} food={f} disabled={isGuest} onAdd={() => addFoodIngredients(f)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Sticky save bar (Staples tab + selection) */}
      {tab === 'staples' && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[88px] lg:bottom-6 z-40 px-4 lg:left-[260px] pointer-events-none">
          <div className="mx-auto max-w-md lg:max-w-3xl pointer-events-auto">
            <div className="bg-pantry-leaf text-white rounded-hive-lg shadow-[0_18px_40px_-12px_rgba(91,168,140,0.6)] p-3 flex items-center gap-3">
              <span className="font-nunito font-black text-[14px]">{selected.size} selected</span>
              <button
                onClick={() => setSelected(new Set())}
                className="ml-auto text-[12px] font-nunito font-extrabold underline opacity-90"
              >
                Clear
              </button>
              <button
                onClick={saveSelected}
                disabled={saving || isGuest}
                className="h-10 px-4 rounded-hive-pill bg-white text-pantry-leaf-dk font-nunito font-black text-[12px] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save to staples'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-36 lg:bottom-16 z-50 bg-hive-navy text-white text-[12px] font-nunito font-extrabold px-4 py-2 rounded-hive-pill shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function TopTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-12 rounded-hive-pill font-nunito font-extrabold text-[13px] transition-colors ${
        active
          ? 'bg-pantry-leaf text-white shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)]'
          : 'bg-transparent text-hive-muted'
      }`}
    >
      {children}
    </button>
  );
}

function SubTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-11 rounded-hive-pill font-nunito font-extrabold text-[13px] transition-colors ${
        active
          ? 'bg-pantry-leaf text-white shadow-[0_6px_16px_-8px_rgba(91,168,140,0.5)]'
          : 'bg-transparent text-hive-muted'
      }`}
    >
      {children}
    </button>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2 -mx-1 px-1">{children}</div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border whitespace-nowrap transition-colors ${
        active
          ? 'bg-pantry-leaf-soft text-pantry-leaf-dk border-pantry-leaf'
          : 'border-hive-line bg-hive-paper text-hive-muted hover:border-pantry-leaf/50'
      }`}
    >
      {children}
    </button>
  );
}

function StapleCard({
  entry, selected, owned, currency, canEdit, editing, busy,
  onTap, onEdit, onCancelEdit, onSave, onRemove,
}: {
  entry: CatalogEntry;
  selected: boolean;
  owned: boolean;
  currency: string;
  canEdit: boolean;
  editing: boolean;
  busy: boolean;
  onTap: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (input: CatalogItemInput) => void;
  onRemove?: () => void;
}) {
  // Editing mode — the whole card becomes the editor.
  if (editing) {
    return (
      <div className="bg-hive-paper border-2 border-pantry-leaf rounded-hive p-3">
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.4px] text-pantry-leaf-dk mb-2">
          {entry.isCustom ? 'Edit your item' : 'Edit catalog item'}
        </p>
        <CatalogItemEditor
          initial={entryToInput(entry)}
          mode={entry.isCustom ? 'edit-custom' : 'edit-builtin'}
          currency={currency}
          busy={busy}
          onSave={onSave}
          onCancel={onCancelEdit}
          onRemove={onRemove}
        />
      </div>
    );
  }

  const estimated = entry.priceCents == null;
  const price = entry.priceCents ?? estimateLineCents(entry, entry.defaultQty, currency);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className={`bg-hive-paper border rounded-hive p-3 transition-colors ${
        selected
          ? 'border-pantry-leaf ring-2 ring-pantry-leaf/30 bg-pantry-leaf-soft/40'
          : 'border-hive-line hover:border-pantry-leaf/50'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Emoji + text = the select toggle. A div (not a button) so
            the price shortcut can nest inside it. The keydown guard
            ignores events bubbling up from the nested controls. */}
        <div
          role="button"
          tabIndex={0}
          onClick={onTap}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); }
          }}
          className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer text-left"
        >
          <div className="w-10 h-10 rounded-[12px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center text-xl shrink-0">
            {entry.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-nunito font-extrabold text-[14px] truncate">
              {entry.label}
              {owned && (
                <span className="ml-1.5 text-[10px] font-nunito font-extrabold text-pantry-leaf-dk uppercase tracking-wider">
                  · saved
                </span>
              )}
              {entry.isCustom && (
                <span className="ml-1.5 text-[10px] font-nunito font-extrabold text-pantry-leaf-dk uppercase tracking-wider">
                  · yours
                </span>
              )}
              {entry.isEdited && (
                <span className="ml-1.5 text-[10px] font-nunito font-extrabold text-hive-honey-dk uppercase tracking-wider">
                  · edited
                </span>
              )}
            </p>
            <div className="text-[11px] text-hive-muted mt-0.5 truncate">
              {entry.defaultQty} {entry.unit} · {CADENCE_LABELS[entry.cadence] || entry.cadence}
              {' · '}
              <button
                type="button"
                onClick={(e) => { stop(e); if (canEdit) onEdit(); }}
                disabled={!canEdit}
                className="text-pantry-leaf-dk font-nunito font-extrabold underline underline-offset-2 decoration-dotted disabled:no-underline disabled:cursor-default"
              >
                {estimated ? '~ ' : ''}{formatCents(price, currency)}
              </button>
            </div>
            {entry.note && (
              <p className="text-[11px] text-hive-muted italic mt-0.5 truncate">{entry.note}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {selected && <span className="text-pantry-leaf-dk text-base font-black leading-none">✓</span>}
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${entry.label}`}
              className="text-[13px] leading-none px-1.5 py-1 rounded-hive-sm hover:bg-hive-cream"
            >
              ✏️
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Full inline editor for one catalog item — used for editing a
// built-in (an override), editing a custom item, and adding a new
// one. Holds its own draft so a single Save is one Firestore write.
function CatalogItemEditor({
  initial, mode, currency, busy, onSave, onCancel, onRemove,
}: {
  initial: CatalogItemInput;
  mode: 'add' | 'edit-builtin' | 'edit-custom';
  currency: string;
  busy: boolean;
  onSave: (input: CatalogItemInput) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState<CatalogItemInput>(initial);
  const set = <K extends keyof CatalogItemInput>(k: K, v: CatalogItemInput[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // Surface is structural for a built-in (which tab it lives under) —
  // only editable when adding or for a family's own item.
  const surfaceEditable = mode !== 'edit-builtin';
  const canSave = draft.label.trim().length > 0 && !busy;

  const fieldCls =
    'w-full h-9 px-2.5 bg-hive-cream rounded-[8px] text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40';
  const labelCls =
    'text-[9px] font-nunito font-extrabold uppercase tracking-[1.2px] text-hive-muted block mb-1';

  return (
    <div className="space-y-2">
      <div>
        <label className={labelCls}>Name</label>
        <input
          value={draft.label}
          onChange={(e) => set('label', e.target.value)}
          maxLength={60}
          placeholder="e.g. Pishori rice"
          className={`${fieldCls} font-bold`}
        />
      </div>

      <div className="grid grid-cols-[64px_1fr] gap-2">
        <div>
          <label className={labelCls}>Icon</label>
          <input
            value={draft.emoji}
            onChange={(e) => set('emoji', e.target.value)}
            maxLength={4}
            className={`${fieldCls} text-center`}
          />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <select
            value={draft.category}
            onChange={(e) => set('category', e.target.value as StapleCategory)}
            className={`${fieldCls} font-nunito font-extrabold`}
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={surfaceEditable ? 'grid grid-cols-2 gap-2' : ''}>
        {surfaceEditable && (
          <div>
            <label className={labelCls}>Catalog tab</label>
            <select
              value={draft.surface}
              onChange={(e) => set('surface', e.target.value as Surface)}
              className={`${fieldCls} font-nunito font-extrabold`}
            >
              {SURFACE_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className={labelCls}>Region</label>
          <select
            value={draft.region}
            onChange={(e) => set('region', e.target.value as Region)}
            className={`${fieldCls} font-nunito font-extrabold`}
          >
            {REGION_OPTIONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Default qty</label>
          <NumberInput
            value={draft.defaultQty}
            onChange={(n) => set('defaultQty', Math.max(1, n))}
            min={1}
            ariaLabel="Default quantity"
            className={`${fieldCls} text-center font-nunito font-black`}
          />
        </div>
        <div>
          <label className={labelCls}>Unit</label>
          <select
            value={draft.unit}
            onChange={(e) => set('unit', e.target.value)}
            className={`${fieldCls} font-nunito font-extrabold`}
          >
            {STAPLE_UNITS.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
            {!STAPLE_UNITS.some((u) => u.id === draft.unit) && (
              <option value={draft.unit}>{draft.unit}</option>
            )}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Cadence</label>
          <select
            value={draft.cadence}
            onChange={(e) => set('cadence', e.target.value as Cadence)}
            className={`${fieldCls} font-nunito font-extrabold`}
          >
            {CADENCE_OPTIONS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Price {currency} · 0 = estimate</label>
          <NumberInput
            value={draft.priceCents ? draft.priceCents / 100 : 0}
            onChange={(n) => set('priceCents', n > 0 ? Math.round(n * 100) : undefined)}
            allowDecimal
            min={0}
            ariaLabel="Price"
            placeholder="0"
            className={`${fieldCls} font-nunito font-black`}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>Note (optional)</label>
        <input
          value={draft.note || ''}
          onChange={(e) => set('note', e.target.value)}
          maxLength={80}
          placeholder="Brand hint, where to buy…"
          className={fieldCls}
        />
      </div>

      <div className="flex gap-2 pt-1">
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="h-9 px-3 rounded-hive-pill bg-hive-cream border border-hive-line text-hive-muted font-nunito font-extrabold text-[11px] disabled:opacity-50"
          >
            {mode === 'edit-custom' ? 'Delete' : 'Reset'}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-9 px-3 rounded-hive-pill bg-hive-cream border border-hive-line text-hive-muted font-nunito font-extrabold text-[11px] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={!canSave}
          className="flex-1 h-9 rounded-hive-pill bg-pantry-leaf text-white font-nunito font-black text-[12px] disabled:opacity-50"
        >
          {busy ? 'Saving…' : mode === 'add' ? 'Add to catalog' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function FoodCard({
  food, disabled, onAdd,
}: {
  food: DirectoryFood;
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3 flex items-start gap-3">
      <div className="w-10 h-10 rounded-[12px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center text-xl shrink-0">
        {food.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-nunito font-extrabold text-[14px] truncate">{food.label}</p>
        <p className="text-[10px] uppercase tracking-[1.5px] text-hive-muted font-nunito font-extrabold mt-0.5">
          {food.meals.join(' · ')}
        </p>
        <div className="flex flex-wrap gap-1 mt-2">
          {food.ingredients.map((ing) => (
            <span
              key={ing}
              className="text-[10px] font-nunito font-extrabold text-pantry-leaf-dk bg-pantry-leaf-soft px-2 py-0.5 rounded-hive-pill"
            >
              {ing}
            </span>
          ))}
        </div>
      </div>
      <button
        onClick={onAdd}
        disabled={disabled}
        className="shrink-0 text-[11px] font-nunito font-extrabold text-pantry-leaf-dk hover:underline disabled:opacity-40 disabled:no-underline whitespace-nowrap"
      >
        + Staples
      </button>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center mt-2">
      <div className="text-3xl mb-2">🧺</div>
      <p className="text-[12px] text-hive-muted">{message}</p>
    </div>
  );
}
