'use client';

// Sheet shown by /pantry/meals when the parent taps "Suggest week".
// Lets them pick a region + diet then renders a 21-meal preview built
// from FOODS_DIRECTORY. "Apply" writes the whole week in one setDoc.
//
// Existing eatingOut flags survive — applyMealPlanSuggestion does a
// per-day shallow merge.

import { useMemo, useState } from 'react';
import { suggestWeeklyMealPlan, foodsMatching, MealPlanFilters } from '@/lib/pantryDirectory';
import { MEAL_DAYS } from '@/lib/pantry';

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (suggestion: Record<string, { breakfast?: string; lunch?: string; dinner?: string }>) => void;
  applying: boolean;
}

export default function SuggestSheet({ open, onClose, onApply, applying }: Props) {
  const [region, setRegion] = useState<MealPlanFilters['region']>('all');
  const [diet, setDiet]     = useState<MealPlanFilters['diet'] | 'any'>('any');
  const [kidFriendly, setKidFriendly] = useState(false);
  // `gen` is bumped to force a re-roll of the random shuffle.
  const [gen, setGen] = useState(0);

  const filters: MealPlanFilters = useMemo(() => ({
    region,
    diet: diet === 'any' ? undefined : diet,
    kidFriendly,
  }), [region, diet, kidFriendly]);

  const suggestion = useMemo(
    () => suggestWeeklyMealPlan(filters),
    // gen forces a fresh shuffle each time the user taps "Re-roll".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, gen],
  );

  // Coverage hint — surfaces when filters return very few items.
  const coverage = useMemo(() => ({
    breakfast: foodsMatching(filters, 'breakfast').length,
    lunch:     foodsMatching(filters, 'lunch').length,
    dinner:    foodsMatching(filters, 'dinner').length,
  }), [filters]);

  if (!open) return null;

  const minPool = Math.min(coverage.breakfast, coverage.lunch, coverage.dinner);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-2" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-hive-paper rounded-hive-lg w-full max-w-md max-h-[92vh] flex flex-col shadow-2xl"
      >
        <div className="p-4 border-b border-hive-line flex items-baseline justify-between">
          <div>
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-pantry-leaf-dk">
              ✨ Suggest the week
            </p>
            <h2 className="font-nunito font-black text-xl mt-0.5">7 days, picked for you</h2>
          </div>
          <button onClick={onClose} className="text-hive-muted hover:text-hive-navy text-lg">✕</button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {/* Region */}
          <div>
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-1">Region</p>
            <div className="flex flex-wrap gap-1.5">
              <Pill active={region === 'all'} onClick={() => setRegion('all')}>🌍 Any</Pill>
              <Pill active={region === 'east-africa'} onClick={() => setRegion('east-africa')}>🇹🇿 East Africa</Pill>
              <Pill active={region === 'south-asia'} onClick={() => setRegion('south-asia')}>🇮🇳 South Asia</Pill>
              <Pill active={region === 'global'} onClick={() => setRegion('global')}>🌐 Global</Pill>
            </div>
          </div>
          {/* Diet */}
          <div>
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-1">Diet</p>
            <div className="flex flex-wrap gap-1.5">
              <Pill active={diet === 'any'} onClick={() => setDiet('any')}>Any</Pill>
              <Pill active={diet === 'vegetarian'} onClick={() => setDiet('vegetarian')}>🥬 Vegetarian</Pill>
              <Pill active={diet === 'vegan'} onClick={() => setDiet('vegan')}>🌱 Vegan</Pill>
              <Pill active={diet === 'halal'} onClick={() => setDiet('halal')}>☪️ Halal</Pill>
            </div>
          </div>
          <label className="flex items-center gap-2 px-3 py-2 rounded-hive bg-hive-cream/60 cursor-pointer">
            <input
              type="checkbox"
              checked={kidFriendly}
              onChange={(e) => setKidFriendly(e.target.checked)}
              className="w-4 h-4 accent-pantry-leaf"
            />
            <span className="font-nunito font-extrabold text-[12px]">Lean kid-friendly</span>
          </label>

          {minPool < 3 && (
            <p className="text-[11px] text-hive-rose font-bold">
              Heads up: only {minPool} matches for the smallest meal type — meals will repeat. Try widening filters.
            </p>
          )}

          {/* Preview — 7-day grid */}
          <div className="bg-hive-cream/40 rounded-hive p-2">
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Preview</p>
              <button
                onClick={() => setGen((n) => n + 1)}
                className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk hover:underline"
              >
                🔄 Re-roll
              </button>
            </div>
            <div className="space-y-1.5">
              {MEAL_DAYS.map((d) => {
                const e = suggestion[d.id];
                return (
                  <div key={d.id} className="grid grid-cols-[40px_1fr_1fr_1fr] gap-1 items-baseline text-[11px]">
                    <span className="text-pantry-leaf-dk uppercase tracking-[1px] text-[10px] font-nunito font-extrabold">{d.short}</span>
                    <SlotPreview value={e?.breakfast} />
                    <SlotPreview value={e?.lunch} />
                    <SlotPreview value={e?.dinner} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-hive-line flex gap-2">
          <button
            onClick={onClose}
            className="px-4 h-11 rounded-hive-pill border border-hive-line bg-hive-paper text-hive-muted font-nunito font-extrabold text-[12px]"
          >
            Cancel
          </button>
          <button
            onClick={() => onApply(suggestion)}
            disabled={applying}
            className="flex-1 h-11 rounded-hive bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-sm disabled:opacity-50 transition-colors"
          >
            {applying ? 'Applying…' : 'Apply to my week'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 h-7 rounded-hive-pill border text-[11px] font-nunito font-extrabold transition-colors ${
        active
          ? 'bg-pantry-leaf text-white border-transparent'
          : 'bg-hive-paper border-hive-line text-hive-muted hover:border-pantry-leaf/40'
      }`}
    >
      {children}
    </button>
  );
}

function SlotPreview({ value }: { value?: string }) {
  return (
    <span className={`truncate ${value ? 'font-nunito font-extrabold text-hive-navy' : 'text-hive-muted/50 italic'}`}>
      {value || '—'}
    </span>
  );
}
