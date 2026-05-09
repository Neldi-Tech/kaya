'use client';

// Compact "next 3 days" preview for the Pantry Home. Shows the dinner
// (or eating-out tag) for today + the next 2 days. Tapping the card
// opens /pantry/meals.

import Link from 'next/link';
import { usePantry } from '@/contexts/PantryContext';
import { MEAL_DAYS, MealDay } from '@/lib/pantry';

const DAY_BY_INDEX: MealDay[] = ['mon','tue','wed','thu','fri','sat','sun'];

export default function MealsPreview() {
  const { mealPlan } = usePantry();
  const today = new Date();
  const todayIdx = today.getDay() === 0 ? 6 : today.getDay() - 1; // Mon=0…Sun=6
  // Pull today + next 2 days, wrapping into the same week (good
  // enough — Phase 2 can carry across weeks).
  const slice: { day: MealDay; label: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const idx = (todayIdx + i) % 7;
    const d = MEAL_DAYS[idx];
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.short;
    slice.push({ day: d.id, label });
  }

  const planned = slice.filter(({ day }) => {
    const e = mealPlan?.days?.[day];
    return e && (e.dinner || e.lunch || e.breakfast || e.eatingOut);
  }).length;

  return (
    <Link
      href="/pantry/meals"
      className="block bg-hive-paper border border-hive-line rounded-hive-lg p-4 mb-3 no-underline text-inherit hover:border-pantry-leaf transition-colors"
    >
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-nunito font-extrabold text-[14px]">Next 3 days · meals</h3>
        <span className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk">
          Open →
        </span>
      </div>
      {planned === 0 ? (
        <p className="text-[12px] text-hive-muted py-2 text-center italic">
          No meals planned. Tap to set up the week.
        </p>
      ) : (
        <div className="space-y-1.5">
          {slice.map(({ day, label }) => {
            const entry = mealPlan?.days?.[day];
            const dinner = entry?.dinner;
            const eatingOut = entry?.eatingOut;
            return (
              <div key={day} className="flex items-baseline gap-2 text-[12px]">
                <span className="text-pantry-leaf-dk uppercase tracking-[1.5px] text-[10px] font-nunito font-extrabold w-16">
                  {label}
                </span>
                {eatingOut ? (
                  <span className="text-pantry-leaf-dk font-bold">
                    🍽️ Eating out{entry?.eatingOutNote ? ` · ${entry.eatingOutNote}` : ''}
                  </span>
                ) : dinner ? (
                  <span className="font-bold truncate">🍝 {dinner}</span>
                ) : (
                  <span className="text-hive-muted italic">— add a meal —</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Link>
  );
}
