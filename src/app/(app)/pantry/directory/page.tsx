'use client';

// /pantry/directory — Browse-everything catalog. Two surfaces:
//   STAPLES tab: 167 curated household items split Food/Household,
//     filterable by sub-category and region. Tap any card to
//     multi-select; a sticky bar surfaces "Save N to staples".
//   FOODS tab: 91 popular dishes filterable by meal, region, diet.
//     Each card has a "+ Staples" action that bulk-adds the food's
//     ingredient list to the family staples.
//
// Layout is a single column on phones (mobile-first) and a 2-column
// grid for staples at lg+ to mirror the desktop screenshots.

import { useMemo, useState } from 'react';
import BackButton from '@/components/ui/BackButton';
import { useAuth } from '@/contexts/AuthContext';
import { usePantry } from '@/contexts/PantryContext';
import { addStaple } from '@/lib/pantry';
import {
  DIRECTORY_STAPLES, DIRECTORY_FOODS,
  REGIONS, DIETS, MEALS,
  FOOD_CATEGORY_CHIPS, HOUSEHOLD_CATEGORY_CHIPS,
  type Surface, type Region, type Diet, type MealType,
  type DirectoryStaple, type DirectoryFood,
} from '@/lib/pantryDirectory';
import type { StapleCategory } from '@/lib/pantry';

type Tab = 'staples' | 'foods';

const CADENCE_LABELS: Record<string, string> = {
  daily: 'daily',
  weekly: 'weekly',
  biweekly: 'biweekly',
  monthly: 'monthly',
  'as-needed': 'as needed',
};

export default function PantryDirectoryPage() {
  const { profile, isGuest } = useAuth();
  const { staples } = usePantry();

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

  // Already in the family's staples (by lower-cased name) — used to
  // hide the "Add" affordance and skip duplicates on bulk-save.
  const ownedNames = useMemo(
    () => new Set(staples.map((s) => s.name.toLowerCase())),
    [staples],
  );

  const visibleStaples = useMemo(() => {
    const cat = surface === 'food' ? foodCategory : householdCategory;
    const q = search.trim().toLowerCase();
    return DIRECTORY_STAPLES.filter((s) => {
      if (s.surface !== surface) return false;
      if (cat !== 'all' && s.category !== cat) return false;
      if (region !== 'any' && s.region !== region) return false;
      if (q && !s.label.toLowerCase().includes(q) && !s.match.some((m) => m.includes(q))) return false;
      return true;
    });
  }, [surface, foodCategory, householdCategory, region, search]);

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

  const toggleSelect = (label: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
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
    const labels = Array.from(selected);
    for (const label of labels) {
      const item = DIRECTORY_STAPLES.find((s) => s.label === label);
      if (!item) continue;
      if (ownedNames.has(item.label.toLowerCase())) { skipped++; continue; }
      await addStaple(profile.familyId, {
        name: item.label,
        category: item.category,
        defaultQty: item.defaultQty,
        unit: item.unit,
        cadence: item.cadence,
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

  const addFoodIngredients = async (food: DirectoryFood) => {
    if (!profile?.familyId || isGuest) return;
    let added = 0;
    for (const name of food.ingredients) {
      if (ownedNames.has(name.toLowerCase())) continue;
      const item = DIRECTORY_STAPLES.find((s) => s.label === name);
      if (!item) continue;
      await addStaple(profile.familyId, {
        name: item.label,
        category: item.category,
        defaultQty: item.defaultQty,
        unit: item.unit,
        cadence: item.cadence,
      });
      added++;
    }
    flashToast(added === 0 ? `${food.label} ingredients already saved` : `Added ${added} from ${food.label}`);
  };

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
          Tap to multi-select, then save to your staples.
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

          {visibleStaples.length === 0 ? (
            <EmptyState message="No staples match these filters." />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mt-2">
              {visibleStaples.map((s) => (
                <StapleCard
                  key={s.label}
                  staple={s}
                  selected={selected.has(s.label)}
                  owned={ownedNames.has(s.label.toLowerCase())}
                  onTap={() => toggleSelect(s.label)}
                />
              ))}
            </div>
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
  staple, selected, owned, onTap,
}: {
  staple: DirectoryStaple;
  selected: boolean;
  owned: boolean;
  onTap: () => void;
}) {
  return (
    <button
      onClick={onTap}
      className={`w-full text-left bg-hive-paper border rounded-hive p-3 flex items-start gap-3 transition-colors ${
        selected
          ? 'border-pantry-leaf ring-2 ring-pantry-leaf/30 bg-pantry-leaf-soft/40'
          : 'border-hive-line hover:border-pantry-leaf/50'
      }`}
    >
      <div className="w-10 h-10 rounded-[12px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center text-xl shrink-0">
        {staple.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-nunito font-extrabold text-[14px] truncate">
          {staple.label}
          {owned && (
            <span className="ml-1.5 text-[10px] font-nunito font-extrabold text-pantry-leaf-dk uppercase tracking-wider">
              · saved
            </span>
          )}
        </p>
        <p className="text-[11px] text-hive-muted truncate">
          {staple.defaultQty} {staple.unit} · {CADENCE_LABELS[staple.cadence] || staple.cadence}
        </p>
        {staple.note && (
          <p className="text-[11px] text-hive-muted italic mt-0.5 truncate">{staple.note}</p>
        )}
      </div>
      {selected && (
        <span className="text-pantry-leaf-dk text-base font-black shrink-0">✓</span>
      )}
    </button>
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
