'use client';

// /pantry/meals — 7-day food timetable. Each day has Breakfast,
// Lunch, Dinner and Snacks slots. A slot can be:
//   - empty: tap to plan
//   - home:  cooking at home — picked from DIRECTORY_FOODS
//   - out:   dining out — optionally with a venue note
//
// "Auto-fill week" populates every empty slot using the region +
// diet preference chips at the top, so a new user can land on a
// proposed week in one tap instead of typing seven days of meals.
//
// Persistence is localStorage today (per family, keyed by the
// current ISO week). When the plan crosses a week boundary the
// loader resets to a fresh empty plan.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  newWeekPlan, loadWeekPlan, saveWeekPlan,
  autoFillWeek, clearWeek, setSlot, markDiningOut, foodsForSlot,
  SLOT_NAMES, type WeekPlan, type SlotName, type Slot,
} from '@/lib/mealPlan';
import { REGIONS, DIETS, type Region, type Diet, type DirectoryFood } from '@/lib/pantryDirectory';

export default function MealsPage() {
  const { profile, isGuest } = useAuth();
  const { children: kids } = useFamily();

  const [plan, setPlan] = useState<WeekPlan>(() => newWeekPlan());
  const [region, setRegion] = useState<Region | 'any'>('any');
  const [diet, setDiet] = useState<Diet | 'any'>('any');
  const [picker, setPicker] = useState<{ dayIdx: number; slot: SlotName } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Hydrate from localStorage on mount (client-only).
  useEffect(() => {
    if (!profile?.familyId) return;
    const existing = loadWeekPlan(profile.familyId);
    if (existing) setPlan(existing);
  }, [profile?.familyId]);

  // Persist on every change.
  useEffect(() => {
    if (!profile?.familyId) return;
    saveWeekPlan(profile.familyId, plan);
  }, [plan, profile?.familyId]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  };

  const onAutoFill = () => {
    setPlan((p) => autoFillWeek(p, region, diet));
    flash('Week filled — tweak any slot you don\'t like');
  };

  const onClear = () => {
    if (!confirm('Clear every slot for this week?')) return;
    setPlan((p) => clearWeek(p));
    flash('Week cleared');
  };

  const onSlotChosen = (food: DirectoryFood) => {
    if (!picker) return;
    setPlan((p) => setSlot(p, picker.dayIdx, picker.slot, {
      kind: 'home', foodLabel: food.label, emoji: food.emoji,
    }));
    setPicker(null);
  };

  const onSlotDiningOut = (venue?: string) => {
    if (!picker) return;
    setPlan((p) => setSlot(p, picker.dayIdx, picker.slot, {
      kind: 'out', venue: venue?.trim() || undefined,
    }));
    setPicker(null);
  };

  const onSlotClear = () => {
    if (!picker) return;
    setPlan((p) => setSlot(p, picker.dayIdx, picker.slot, { kind: 'empty' }));
    setPicker(null);
  };

  const familySize = (kids?.length || 0) + 1;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32 lg:pb-12">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Pantry · Meals
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1 leading-tight">
          {plan.weekLabel} 🍽️
        </h1>
        <p className="text-[12px] lg:text-[13px] text-hive-muted mt-1">
          Plan breakfast, lunch, dinner and snacks. Tap a slot to pick a meal or mark it as dining out.
        </p>
      </div>

      {/* Preference chips drive the auto-fill suggestions. */}
      <div className="bg-pantry-leaf-soft/50 border border-pantry-leaf/40 rounded-hive-lg p-3 lg:p-4 mb-4">
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-pantry-leaf-dk mb-2">
          Preferences · used by auto-fill
        </p>
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2 -mx-1 px-1">
          {REGIONS.map((r) => (
            <Chip key={r.id} active={region === r.id} onClick={() => setRegion(r.id)}>
              {r.emoji} {r.label}
            </Chip>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {DIETS.map((d) => (
            <Chip key={d.id} active={diet === d.id} onClick={() => setDiet(d.id)}>
              {d.emoji} {d.label}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            onClick={onAutoFill}
            disabled={isGuest}
            className="h-11 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[13px] disabled:opacity-50 shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)]"
          >
            ✨ Auto-fill week
          </button>
          <button
            onClick={onClear}
            disabled={isGuest}
            className="h-11 rounded-hive-pill bg-hive-paper border border-hive-line text-hive-muted font-nunito font-extrabold text-[12px] disabled:opacity-50"
          >
            Clear week
          </button>
        </div>
        <p className="text-[10px] text-hive-muted mt-2">
          Cooking for {familySize} {familySize === 1 ? 'person' : 'people'} · suggestions drawn from your selected region + diet.
        </p>
      </div>

      {/* Days grid — single column on mobile, two columns on desktop. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {plan.days.map((day, dayIdx) => {
          const allOut = day.lunch.kind === 'out' && day.dinner.kind === 'out';
          return (
            <div key={day.date} className="bg-hive-paper border border-hive-line rounded-hive-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="font-nunito font-black text-[13px]">
                  {day.dayName} · {day.dateLabel}
                </p>
                {allOut ? (
                  <span className="text-[9px] font-nunito font-extrabold uppercase tracking-[1px] bg-hive-honey-soft text-hive-honey-dk px-2 py-0.5 rounded-hive-pill">
                    Dining out
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      const venue = window.prompt('Venue name (optional)') || undefined;
                      setPlan((p) => markDiningOut(p, dayIdx, venue));
                    }}
                    className="text-[10px] font-nunito font-extrabold text-pantry-leaf-dk hover:underline"
                  >
                    🍽️ Eating out
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {SLOT_NAMES.map((s) => (
                  <SlotCard
                    key={s.id}
                    name={s.label}
                    icon={s.emoji}
                    slot={day[s.id]}
                    onTap={() => setPicker({ dayIdx, slot: s.id })}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Slot picker — bottom sheet on mobile, centered modal on desktop. */}
      {picker && (
        <SlotPicker
          dayLabel={`${plan.days[picker.dayIdx].dayName} · ${plan.days[picker.dayIdx].dateLabel}`}
          slotLabel={SLOT_NAMES.find((s) => s.id === picker.slot)!.label}
          foods={foodsForSlot(picker.slot, region, diet)}
          onPick={onSlotChosen}
          onDiningOut={onSlotDiningOut}
          onClear={onSlotClear}
          onClose={() => setPicker(null)}
        />
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-32 lg:bottom-16 z-50 bg-hive-navy text-white text-[12px] font-nunito font-extrabold px-4 py-2 rounded-hive-pill shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

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

function SlotCard({
  name, icon, slot, onTap,
}: {
  name: string;
  icon: string;
  slot: Slot;
  onTap: () => void;
}) {
  const isOut = slot.kind === 'out';
  const isHome = slot.kind === 'home';
  return (
    <button
      onClick={onTap}
      className={`text-left rounded-hive p-2 border transition-colors ${
        isOut
          ? 'bg-hive-honey-soft border-hive-honey/40 text-hive-honey-dk'
          : isHome
          ? 'bg-pantry-leaf-soft/50 border-pantry-leaf/40 text-hive-navy'
          : 'bg-hive-cream border-dashed border-hive-line text-hive-muted'
      }`}
    >
      <p className="text-[9px] font-nunito font-extrabold uppercase tracking-[1px] opacity-80">
        {icon} {name}
      </p>
      {isHome ? (
        <p className="font-nunito font-extrabold text-[12px] mt-1 truncate">
          {slot.emoji} {slot.foodLabel}
        </p>
      ) : isOut ? (
        <p className="font-nunito font-extrabold text-[12px] mt-1 truncate">
          🍽️ {slot.venue || 'Dining out'}
        </p>
      ) : (
        <p className="text-[12px] italic mt-1">— tap to plan</p>
      )}
    </button>
  );
}

function SlotPicker({
  dayLabel, slotLabel, foods, onPick, onDiningOut, onClear, onClose,
}: {
  dayLabel: string;
  slotLabel: string;
  foods: DirectoryFood[];
  onPick: (food: DirectoryFood) => void;
  onDiningOut: (venue?: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [venue, setVenue] = useState('');
  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-x-0 bottom-0 lg:inset-0 lg:flex lg:items-center lg:justify-center z-50 px-0 lg:px-4 pointer-events-none">
        <div className="pointer-events-auto bg-hive-paper rounded-t-[28px] lg:rounded-hive-lg w-full lg:max-w-lg max-h-[80vh] lg:max-h-[85vh] flex flex-col shadow-2xl">
          <div className="px-4 pt-3 pb-2 border-b border-hive-line">
            <div className="w-10 h-1 rounded-full bg-hive-line mx-auto mb-2 lg:hidden" />
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-hive-muted">
                  {dayLabel}
                </p>
                <p className="font-nunito font-black text-[18px]">Plan {slotLabel}</p>
              </div>
              <button
                onClick={onClose}
                className="text-hive-muted text-2xl leading-none px-2"
                aria-label="Close picker"
              >
                ×
              </button>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-hive-line bg-hive-honey-soft/40">
            <p className="text-[11px] font-nunito font-extrabold text-hive-honey-dk uppercase tracking-wider mb-2">
              🍽️ Dining out
            </p>
            <div className="flex gap-2">
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="Venue (optional) — e.g. Pizza place"
                maxLength={40}
                className="flex-1 h-10 px-3 rounded-hive bg-hive-paper border border-hive-line text-[13px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
              />
              <button
                onClick={() => onDiningOut(venue)}
                className="h-10 px-4 rounded-hive-pill bg-hive-honey text-white font-nunito font-black text-[12px]"
              >
                Mark out
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            {foods.length === 0 ? (
              <p className="text-center text-[12px] text-hive-muted italic py-8">
                No meals match your current region + diet for {slotLabel.toLowerCase()}.
                Loosen the filters or pick "Dining out".
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-1.5">
                {foods.map((f) => (
                  <button
                    key={f.label}
                    onClick={() => onPick(f)}
                    className="flex items-center gap-3 text-left bg-hive-paper border border-hive-line hover:border-pantry-leaf rounded-hive p-2.5 transition-colors"
                  >
                    <span className="text-xl shrink-0">{f.emoji}</span>
                    <div className="min-w-0">
                      <p className="font-nunito font-extrabold text-[13px] truncate">{f.label}</p>
                      <p className="text-[10px] text-hive-muted uppercase tracking-wide">
                        {f.meals.join(' · ')}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-hive-line flex gap-2">
            <button
              onClick={onClear}
              className="flex-1 h-10 rounded-hive-pill bg-hive-paper border border-hive-line text-hive-muted font-nunito font-extrabold text-[12px]"
            >
              Clear slot
            </button>
            <button
              onClick={onClose}
              className="flex-1 h-10 rounded-hive-pill bg-hive-cream text-hive-navy font-nunito font-extrabold text-[12px]"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
