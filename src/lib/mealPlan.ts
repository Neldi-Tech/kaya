// Lightweight meal-plan store for /pantry/meals. Persists a single
// weekly plan per family in localStorage — keyed by family + ISO
// week so each family can keep their own plan and we can migrate
// to Firestore later without changing the API surface.
//
// Why localStorage and not Firestore yet:
//   - The plan is per-device today (no need for cross-device sync).
//   - Each parent/family can still iterate on the timetable freely
//     and we can ship the UX without a schema migration.
//   - When Firestore is wired in, only this module changes — the
//     page already calls saveWeekPlan / loadWeekPlan.

import { DIRECTORY_FOODS, findVenue, type DirectoryFood, type DiningVenueId, type MealType, type Region, type Diet } from './pantryDirectory';

export type SlotKind = 'empty' | 'home' | 'out';
export type SlotName = 'breakfast' | 'lunch' | 'dinner' | 'snack';
/** Who's eating? `family` = everyone, `parents` = adults only
 *  (date-night style). Defaults to `family` when not set. */
export type Audience = 'family' | 'parents';

export interface Slot {
  kind: SlotKind;
  /** When kind === 'home': the food's label (matches DirectoryFood.label). */
  foodLabel?: string;
  /** Mirror of the food's emoji so we don't need to re-resolve. */
  emoji?: string;
  /** When kind === 'out': venue id from DINING_VENUES (Yellow Pages
   *  catalog). For free-text overrides see `venue`. */
  venueId?: DiningVenueId;
  /** When kind === 'out': free-text venue note ("Aunt Sarah's", etc.)
   *  used either alongside or in place of `venueId`. */
  venue?: string;
  /** Who's eating. Defaults to `family` if unspecified. */
  audience?: Audience;
}

export interface DayPlan {
  /** ISO date e.g. "2026-05-11". */
  date: string;
  /** Short day name e.g. "MON". */
  dayName: string;
  /** Display label e.g. "MAY 11". */
  dateLabel: string;
  breakfast: Slot;
  lunch: Slot;
  dinner: Slot;
  snack: Slot;
}

export interface WeekPlan {
  /** ISO week key e.g. "2026-W19". */
  weekKey: string;
  /** Display label for the week. */
  weekLabel: string;
  days: DayPlan[];
  updatedAt: number;
}

export const SLOT_NAMES: { id: SlotName; label: string; emoji: string }[] = [
  { id: 'breakfast', label: 'Breakfast', emoji: '🥣' },
  { id: 'lunch',     label: 'Lunch',     emoji: '🍱' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🍛' },
  { id: 'snack',     label: 'Snacks',    emoji: '🍪' },
];

const EMPTY_SLOT: Slot = { kind: 'empty' };

// ── Date helpers ─────────────────────────────────────────────────

const DAY_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Monday-anchored week start for any given date. */
export function weekStart(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay(); // 0 (Sun) .. 6 (Sat)
  const diff = (day === 0 ? -6 : 1 - day);
  out.setDate(out.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** ISO week key — "2026-W19". Matches the existing Pantry weekKey
 *  convention so two surfaces talk the same calendar. */
export function isoWeekKey(d: Date): string {
  // Thursday-anchored ISO 8601 week.
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDateLabel(d: Date) {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function weekLabel(start: Date, end: Date) {
  if (start.getMonth() === end.getMonth()) {
    return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${end.getDate()}`;
  }
  return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}`;
}

/** Build a brand-new empty week plan starting Monday of the given date. */
export function newWeekPlan(anchor: Date = new Date()): WeekPlan {
  const start = weekStart(anchor);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const days: DayPlan[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push({
      date: fmtDate(d),
      dayName: DAY_NAMES[d.getDay()],
      dateLabel: fmtDateLabel(d),
      breakfast: { ...EMPTY_SLOT },
      lunch:     { ...EMPTY_SLOT },
      dinner:    { ...EMPTY_SLOT },
      snack:     { ...EMPTY_SLOT },
    });
  }
  return {
    weekKey: isoWeekKey(start),
    weekLabel: weekLabel(start, end),
    days,
    updatedAt: Date.now(),
  };
}

// ── localStorage persistence ─────────────────────────────────────

const storageKey = (familyId: string) => `kaya:mealPlan:${familyId}`;

export function loadWeekPlan(familyId: string): WeekPlan | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(familyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WeekPlan;
    const currentKey = isoWeekKey(new Date());
    if (parsed.weekKey !== currentKey) {
      // Roll the previous week's plan forward — keep all the slot
      // picks (food / dining-out / audience) and only refresh the
      // dates + week key. Parents asked for the last plan to be
      // the default for the new week unless they explicitly tap
      // "Clear week", since most weeks repeat closely.
      return rollForward(parsed);
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Carry an existing plan into the current week. Same slot contents
 *  per weekday (Mon-stays-Mon by index), but day.date / dateLabel /
 *  weekKey / weekLabel all refreshed. Snack and dining-out picks
 *  travel along too. */
export function rollForward(plan: WeekPlan): WeekPlan {
  const fresh = newWeekPlan();
  const days = fresh.days.map((day, i) => {
    const prev = plan.days[i];
    if (!prev) return day;
    return {
      ...day,
      breakfast: { ...prev.breakfast },
      lunch:     { ...prev.lunch },
      dinner:    { ...prev.dinner },
      snack:     { ...prev.snack },
    };
  });
  return { ...fresh, days, updatedAt: Date.now() };
}

export function saveWeekPlan(familyId: string, plan: WeekPlan): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(familyId), JSON.stringify({ ...plan, updatedAt: Date.now() }));
  } catch {
    // Quota exceeded etc. — swallow silently; plan stays in-memory.
  }
}

// ── Templates / auto-fill ────────────────────────────────────────

/** Map a meal slot to which `MealType` filters to pull from the
 *  catalog. Snacks accept both 'snack' and 'fruit' (fruits eaten
 *  fresh are catalogued as fruit-meals). */
const slotMealTypes: Record<SlotName, MealType[]> = {
  breakfast: ['breakfast'],
  lunch:     ['lunch'],
  dinner:    ['dinner'],
  snack:     ['snack', 'fruit'],
};

function pickFoods(slot: SlotName, region: Region | 'any', diet: Diet | 'any'): DirectoryFood[] {
  const types = slotMealTypes[slot];
  return DIRECTORY_FOODS.filter((f) => {
    if (!types.some((t) => f.meals.includes(t))) return false;
    if (region !== 'any' && f.region !== region) return false;
    if (diet !== 'any' && !f.diets.includes(diet)) return false;
    return true;
  });
}

/** Resolve a food label back to its emoji (used when picking from
 *  the bottom sheet). */
export function foodEmoji(label: string): string {
  return DIRECTORY_FOODS.find((f) => f.label === label)?.emoji || '🍽️';
}

/** Foods that match the slot + preferences, for the picker UI. */
export function foodsForSlot(slot: SlotName, region: Region | 'any', diet: Diet | 'any'): DirectoryFood[] {
  return pickFoods(slot, region, diet);
}

/** Populate every empty slot in the plan with a rotating selection
 *  of foods matching the given preferences. Existing slots (already
 *  picked or marked dining-out) are preserved.
 *
 *  Variety strategy: walk each slot's candidate pool round-robin
 *  starting from a random offset so two weeks aren't identical, and
 *  avoid repeating the same dish on consecutive days where possible. */
export function autoFillWeek(plan: WeekPlan, region: Region | 'any', diet: Diet | 'any'): WeekPlan {
  const next: WeekPlan = { ...plan, days: plan.days.map((d) => ({ ...d })), updatedAt: Date.now() };
  const slotNames: SlotName[] = ['breakfast','lunch','dinner','snack'];

  for (const name of slotNames) {
    const pool = pickFoods(name, region, diet);
    if (pool.length === 0) continue;
    const offset = Math.floor(Math.random() * pool.length);
    let cursor = offset;
    let lastLabel = '';
    for (const day of next.days) {
      const slot = day[name];
      if (slot.kind !== 'empty') continue;
      // Skip same-as-previous-day when we have alternatives.
      let pick = pool[cursor % pool.length];
      if (pick.label === lastLabel && pool.length > 1) {
        cursor++;
        pick = pool[cursor % pool.length];
      }
      day[name] = { kind: 'home', foodLabel: pick.label, emoji: pick.emoji };
      lastLabel = pick.label;
      cursor++;
    }
  }
  return next;
}

/** Reset every slot to empty (used by "Clear week"). */
export function clearWeek(plan: WeekPlan): WeekPlan {
  return {
    ...plan,
    updatedAt: Date.now(),
    days: plan.days.map((d) => ({
      ...d,
      breakfast: { ...EMPTY_SLOT },
      lunch: { ...EMPTY_SLOT },
      dinner: { ...EMPTY_SLOT },
      snack: { ...EMPTY_SLOT },
    })),
  };
}

/** Set one slot. Returns a new plan object so React state updates cleanly. */
export function setSlot(plan: WeekPlan, dayIdx: number, slotName: SlotName, slot: Slot): WeekPlan {
  const days = plan.days.map((d, i) => i === dayIdx ? { ...d, [slotName]: slot } : d);
  return { ...plan, days, updatedAt: Date.now() };
}

/** Resolve a slot's display venue name. Prefers free-text override
 *  when present, then the Yellow Pages venue name, then a generic
 *  fallback. */
export function slotVenueLabel(slot: Slot): string {
  if (slot.venue?.trim()) return slot.venue.trim();
  const v = findVenue(slot.venueId);
  if (v) return v.name;
  return 'Dining out';
}
