'use client';

// /pantry/meals — 7-day food timetable. Phase 1A is free-text per slot
// (Breakfast / Lunch / Dinner) plus an "Eating out" toggle per day.
// Phase 2 will add a recipe library + ingredient → list flow.
//
// Inline tap-to-edit: each slot opens a small input. Saves on blur.
// All writes are setDoc-merge so two parents editing different slots
// can't clobber each other's work.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { usePantry } from '@/contexts/PantryContext';
import {
  MEAL_DAYS, MEAL_SLOTS, MealDay, MealSlot,
  setMealSlot, setEatingOut, MealEntry,
} from '@/lib/pantry';
import BackButton from '@/components/ui/BackButton';

export default function MealsPage() {
  const { profile, isGuest } = useAuth();
  const { mealPlan, weekKey } = usePantry();

  const days = mealPlan?.days || {};

  // Localise the week label: "Week of May 12 → 18".
  const weekLabel = (() => {
    const monday = new Date(weekKey + 'T00:00:00');
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(monday)} → ${fmt(sunday)}`;
  })();

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Pantry · Meals · {weekLabel}
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">This week 🍽️</h1>
      </div>

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
        Phase 2: tap a meal to surface its ingredients straight into the shopping list.{' '}
        <Link href="/pantry" className="text-pantry-leaf-dk font-bold hover:underline">← Back to Pantry</Link>
      </p>
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
  label, emoji, value, onSave, disabled,
}: {
  label: string;
  emoji: string;
  value?: string;
  onSave: (v: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  // Re-sync if the upstream value changes externally (other parent edits).
  useEffect(() => { setDraft(value || ''); }, [value]);

  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value || '')) onSave(trimmed);
  };

  if (editing && !disabled) {
    return (
      <div className="bg-hive-cream border-2 border-pantry-leaf rounded-[10px] p-2">
        <p className="text-[8px] uppercase tracking-[1.5px] font-bold text-hive-muted">{label}</p>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); }
          }}
          autoFocus
          maxLength={60}
          placeholder={`${emoji} What's for ${label.toLowerCase()}?`}
          className="w-full mt-0.5 bg-transparent text-[11px] font-nunito font-extrabold focus:outline-none placeholder:text-hive-muted/40"
        />
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
