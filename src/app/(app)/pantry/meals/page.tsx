'use client';

// /pantry/meals — 7-day food timetable. Phase 1B: free-text per slot
// (Breakfast / Lunch / Dinner) + an "Eating out" toggle per day, plus
// a one-tap "Suggest week" sheet that builds a 21-meal plan filtered
// by region + diet, and a quick-pick dropdown per slot pulling from
// FOODS_DIRECTORY.
//
// All writes are setDoc-merge with nested object literals — dot-
// notation does NOT work with setDoc-merge in Firestore. Two parents
// editing different slots won't clobber each other's work.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { usePantry } from '@/contexts/PantryContext';
import {
  MEAL_DAYS, MEAL_SLOTS, MealDay, MealSlot,
  setMealSlot, setEatingOut, applyMealPlanSuggestion, MealEntry,
} from '@/lib/pantry';
import { foodsMatching, MealPlanFilters } from '@/lib/pantryDirectory';
import BackButton from '@/components/ui/BackButton';
import SuggestSheet from '@/components/pantry/SuggestSheet';

export default function MealsPage() {
  const { profile, isGuest } = useAuth();
  const { mealPlan, weekKey } = usePantry();

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  const days = mealPlan?.days || {};

  // Localise the week label: "Week of May 12 → 18".
  const weekLabel = (() => {
    const monday = new Date(weekKey + 'T00:00:00');
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(monday)} → ${fmt(sunday)}`;
  })();

  const apply = async (suggestion: Record<string, { breakfast?: string; lunch?: string; dinner?: string }>) => {
    if (!profile?.familyId || isGuest) return;
    setError('');
    setApplying(true);
    try {
      await applyMealPlanSuggestion(profile.familyId, weekKey, suggestion as any, profile.uid);
      setSuggestOpen(false);
    } catch (e: any) {
      setError(e?.message || 'Could not apply the plan.');
    }
    setApplying(false);
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
            Pantry · Meals · {weekLabel}
          </p>
          <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">This week 🍽️</h1>
        </div>
        {!isGuest && (
          <button
            onClick={() => setSuggestOpen(true)}
            className="shrink-0 h-10 px-3 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-extrabold text-[12px] shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)]"
          >
            ✨ Suggest week
          </button>
        )}
      </div>

      {error && <p className="text-hive-rose text-sm font-bold text-center mb-3">{error}</p>}

      <div className="space-y-3">
        {MEAL_DAYS.map((d, i) => {
          const entry: MealEntry = days[d.id] || {};
          const monday = new Date(weekKey + 'T00:00:00');
          const dayDate = new Date(monday); dayDate.setDate(monday.getDate() + i);
          const dateLabel = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          return (
            <DayCard
              key={d.id}
              dayId={d.id}
              dayShort={d.short}
              dateLabel={dateLabel}
              entry={entry}
              familyId={profile?.familyId || ''}
              weekKey={weekKey}
              uid={profile?.uid || ''}
              isGuest={isGuest}
            />
          );
        })}
      </div>

      <p className="text-center text-[11px] text-hive-muted mt-6 leading-relaxed">
        Tap a meal to type your own, or use{' '}
        <button
          onClick={() => !isGuest && setSuggestOpen(true)}
          className="text-pantry-leaf-dk font-bold hover:underline"
        >
          ✨ Suggest week
        </button>{' '}
        to fill 7 days at once. Phase 2: tap a meal to surface its ingredients straight into the shopping list.{' '}
        <Link href="/pantry" className="text-pantry-leaf-dk font-bold hover:underline">← Back to Pantry</Link>
      </p>

      <SuggestSheet
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        onApply={apply}
        applying={applying}
      />
    </div>
  );
}

function DayCard({
  dayId, dayShort, dateLabel, entry, familyId, weekKey, uid, isGuest,
}: {
  dayId: MealDay;
  dayShort: string;
  dateLabel: string;
  entry: MealEntry;
  familyId: string;
  weekKey: string;
  uid: string;
  isGuest: boolean;
}) {
  return (
    <div className={`rounded-hive border ${entry.eatingOut ? 'border-pantry-leaf bg-pantry-leaf-soft/30' : 'border-hive-line bg-hive-paper'} p-3`}>
      <div className="flex items-baseline justify-between mb-2">
        <p className="font-nunito font-extrabold text-[13px]">
          <span className="text-pantry-leaf-dk uppercase tracking-[1.5px] text-[10px]">{dayShort}</span>{' '}
          <span className="text-hive-muted font-bold ml-1.5 text-[10px]">· {dateLabel}</span>
        </p>
        <button
          onClick={() => {
            if (!familyId || isGuest) return;
            setEatingOut(familyId, weekKey, dayId, !entry.eatingOut, entry.eatingOutNote, uid);
          }}
          disabled={isGuest}
          className={`px-2.5 py-1 rounded-hive-pill text-[10px] font-nunito font-extrabold transition-colors ${
            entry.eatingOut
              ? 'bg-pantry-leaf text-white'
              : 'bg-hive-paper border border-hive-line text-hive-muted hover:border-pantry-leaf/50'
          }`}
        >
          {entry.eatingOut ? '✓ Eating out' : '+ Eating out?'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {MEAL_SLOTS.map((s) => (
          <MealSlotCell
            key={s.id}
            label={s.label}
            emoji={s.emoji}
            slotId={s.id}
            value={entry[s.id]}
            onSave={(v) => {
              if (!familyId || isGuest) return;
              setMealSlot(familyId, weekKey, dayId, s.id, v, uid);
            }}
            disabled={isGuest}
          />
        ))}
      </div>

      {entry.eatingOut && (
        <input
          value={entry.eatingOutNote || ''}
          onChange={(e) => {
            if (!familyId || isGuest) return;
            setEatingOut(familyId, weekKey, dayId, true, e.target.value, uid);
          }}
          placeholder="Where? (e.g. Pizza place, with Grandma…)"
          maxLength={80}
          disabled={isGuest}
          className="mt-2 w-full h-9 px-3 bg-hive-paper rounded-[10px] text-[12px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      )}
    </div>
  );
}

function MealSlotCell({
  label, emoji, slotId, value, onSave, disabled,
}: {
  label: string;
  emoji: string;
  slotId: MealSlot;
  value?: string;
  onSave: (v: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [showPicker, setShowPicker] = useState(false);

  // Re-sync if the upstream value changes externally (other parent edits).
  useEffect(() => { setDraft(value || ''); }, [value]);

  const save = (override?: string) => {
    setEditing(false);
    setShowPicker(false);
    const next = (override ?? draft).trim();
    if (next !== (value || '')) onSave(next);
    if (override !== undefined) setDraft(override);
  };

  // Top picks for this slot — region-agnostic, just first ~12 from the
  // directory matching the slot's meal type.
  const picks = foodsMatching({ region: 'all' } as MealPlanFilters, slotId).slice(0, 12);

  if (editing && !disabled) {
    return (
      <div className="bg-hive-cream border-2 border-pantry-leaf rounded-[10px] p-2 relative">
        <div className="flex items-baseline justify-between">
          <p className="text-[8px] uppercase tracking-[1.5px] font-bold text-hive-muted">{label}</p>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); setShowPicker((v) => !v); }}
            className="text-[9px] font-nunito font-extrabold text-pantry-leaf-dk hover:underline"
          >
            {showPicker ? 'Type' : 'Pick ▾'}
          </button>
        </div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (!showPicker) save(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); setShowPicker(false); }
          }}
          autoFocus
          maxLength={60}
          placeholder={`${emoji} What's for ${label.toLowerCase()}?`}
          className="w-full mt-0.5 bg-transparent text-[11px] font-nunito font-extrabold focus:outline-none placeholder:text-hive-muted/40"
        />
        {showPicker && picks.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-hive-paper border border-hive-line rounded-hive shadow-lg max-h-56 overflow-y-auto">
            {picks.map((p) => (
              <button
                key={p.label}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); save(p.label); }}
                className="w-full text-left px-3 py-2 text-[12px] font-nunito font-extrabold hover:bg-pantry-leaf-soft/40 flex items-center gap-2"
              >
                <span>{p.emoji}</span>
                <span className="flex-1 truncate">{p.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => !disabled && setEditing(true)}
      disabled={disabled}
      className={`text-left bg-hive-cream rounded-[10px] p-2 hover:bg-pantry-leaf-soft/50 transition-colors ${disabled ? 'cursor-default' : ''}`}
    >
      <p className="text-[8px] uppercase tracking-[1.5px] font-bold text-hive-muted">{label}</p>
      <p className={`text-[11px] mt-0.5 font-nunito font-extrabold ${value ? '' : 'text-hive-muted/60 italic font-bold'}`}>
        {value ? `${emoji} ${value}` : '— add —'}
      </p>
    </button>
  );
}
