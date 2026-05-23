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

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  newWeekPlan, loadWeekPlan, saveWeekPlan,
  autoFillWeek, clearWeek, setSlot, foodsForSlot, slotVenueLabel,
  SLOT_NAMES, type WeekPlan, type SlotName, type Slot, type Audience,
} from '@/lib/mealPlan';
import {
  REGIONS, DIETS, DINING_VENUES, DINING_CATEGORIES, findVenue,
  type Region, type Diet, type DirectoryFood,
  type DiningVenue, type DiningCategory,
} from '@/lib/pantryDirectory';
import { subscribeToVenues, type Venue } from '@/lib/dineOutVenues';
import VenueSheet from '@/components/pantry/VenueSheet';
import { formatCents } from '@/components/pantry/format';

export default function MealsPage() {
  const { profile, isGuest } = useAuth();
  const { children: kids } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const confirmAction = useConfirm();
  const isParent = profile?.role === 'parent';

  const [plan, setPlan] = useState<WeekPlan>(() => newWeekPlan());
  const [region, setRegion] = useState<Region | 'any'>('any');
  const [diet, setDiet] = useState<Diet | 'any'>('any');
  const [picker, setPicker] = useState<{ dayIdx: number; slot: SlotName } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Family "Places to go" venues (Dine Out) — powers the analysis panel
  // below + the "your places" shortcut in the dining-out picker. Parent
  // data (carries spend), so only loaded for parents.
  const [venues, setVenues] = useState<Venue[]>([]);
  const [sheetVenue, setSheetVenue] = useState<Venue | null>(null);
  const [placesSort, setPlacesSort] = useState<'rating' | 'diamond' | 'visits' | 'spend' | 'cuisine'>('rating');
  // Top-level view toggle (parents): plan the week vs browse Places to Go.
  const [view, setView] = useState<'plan' | 'places'>('plan');
  useEffect(() => {
    if (!profile?.familyId || !isParent) { setVenues([]); return; }
    return subscribeToVenues(profile.familyId, setVenues);
  }, [profile?.familyId, isParent]);

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

  const onClear = async () => {
    const ok = await confirmAction({
      title: 'Clear every slot for this week?',
      confirmLabel: 'Clear',
      tone: 'danger',
    });
    if (!ok) return;
    setPlan((p) => clearWeek(p));
    flash('Week cleared');
  };

  const onSlotChosen = (food: DirectoryFood, audience: Audience) => {
    if (!picker) return;
    setPlan((p) => setSlot(p, picker.dayIdx, picker.slot, {
      kind: 'home', foodLabel: food.label, emoji: food.emoji, audience,
    }));
    setPicker(null);
  };

  const onSlotDiningOut = (opts: { venueId?: string; venue?: string; audience: Audience }) => {
    if (!picker) return;
    setPlan((p) => setSlot(p, picker.dayIdx, picker.slot, {
      kind: 'out',
      venueId: opts.venueId,
      venue: opts.venue?.trim() || undefined,
      audience: opts.audience,
    }));
    setPicker(null);
  };

  const onSlotClear = () => {
    if (!picker) return;
    setPlan((p) => setSlot(p, picker.dayIdx, picker.slot, { kind: 'empty' }));
    setPicker(null);
  };

  const familySize = (kids?.length || 0) + 1;

  // Places to Go — sorted/filtered for the analysis panel.
  const sortedVenues = useMemo(() => {
    const list = placesSort === 'diamond' ? venues.filter((v) => v.diamond) : [...venues];
    const cmp: Record<typeof placesSort, (a: Venue, b: Venue) => number> = {
      rating: (a, b) => b.avgStars - a.avgStars || b.count - a.count,
      diamond: (a, b) => b.avgStars - a.avgStars || b.count - a.count,
      visits: (a, b) => b.count - a.count,
      spend: (a, b) => b.totalSpentCents - a.totalSpentCents,
      cuisine: (a, b) => (a.subTag || '~').localeCompare(b.subTag || '~') || b.avgStars - a.avgStars,
    };
    return list.sort(cmp[placesSort]);
  }, [venues, placesSort]);
  const placesSummary = useMemo(() => {
    const rated = venues.filter((v) => v.avgStars > 0);
    const avg = rated.length ? Math.round((rated.reduce((s, v) => s + v.avgStars, 0) / rated.length) * 10) / 10 : 0;
    return {
      count: venues.length,
      diamond: venues.filter((v) => v.diamond).length,
      avg,
      totalSpent: venues.reduce((s, v) => s + v.totalSpentCents, 0),
      maxSpent: venues.reduce((m, v) => Math.max(m, v.totalSpentCents), 0),
    };
  }, [venues]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32 lg:pb-12">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Pantry · Meal Planner
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1 leading-tight">
          {plan.weekLabel} 🍽️
        </h1>
        <p className="text-[12px] lg:text-[13px] text-hive-muted mt-1">
          Plan breakfast, lunch, dinner and snacks. Tap a slot to pick a meal or mark it as dining out.
        </p>
      </div>

      {/* Top-level view toggle — keeps "Places to Go" one tap from the top
          instead of buried below the week (parents only; helpers just plan). */}
      {isParent && (
        <div className="flex bg-hive-paper border border-hive-line rounded-hive p-1 mb-4">
          <button
            type="button" onClick={() => setView('plan')}
            className={`flex-1 py-2.5 rounded-lg font-nunito font-extrabold text-sm transition-colors ${view === 'plan' ? 'bg-pantry-leaf text-white' : 'text-hive-muted'}`}
          >📅 Meal Plan</button>
          <button
            type="button" onClick={() => setView('places')}
            className={`flex-1 py-2.5 rounded-lg font-nunito font-extrabold text-sm transition-colors ${view === 'places' ? 'text-white' : 'text-hive-muted'}`}
            style={view === 'places' ? { background: '#C2562E' } : undefined}
          >📍 Places to Go{venues.length > 0 ? ` · ${venues.length}` : ''}</button>
        </div>
      )}

      {(!isParent || view === 'plan') && (
        <>
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

      {/* Days grid — single column on mobile, two columns on desktop.
          The per-day "Eating out" shortcut was removed because it
          forced both lunch + dinner to dining-out. Dining-out is
          now per-slot via the picker, so users can dine out for
          just dinner (or just lunch, or only Sunday brunch). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {plan.days.map((day, dayIdx) => {
          const outCount = SLOT_NAMES.filter((s) => day[s.id].kind === 'out').length;
          return (
            <div key={day.date} className="bg-hive-paper border border-hive-line rounded-hive-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="font-nunito font-black text-[13px]">
                  {day.dayName} · {day.dateLabel}
                </p>
                {outCount > 0 && (
                  <span className="text-[9px] font-nunito font-extrabold uppercase tracking-[1px] bg-hive-honey-soft text-hive-honey-dk px-2 py-0.5 rounded-hive-pill">
                    🍽️ Out {outCount}×
                  </span>
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
        </>
      )}

      {/* ── Places to Go (analysis) — its own view now (top toggle) ─── */}
      {isParent && view === 'places' && (
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-2 px-0.5">
            <h2 className="font-nunito font-black text-[16px]">📍 Places to Go</h2>
            <span className="text-[11px] text-hive-muted">from your Dine Out logs</span>
          </div>
          {venues.length === 0 ? (
            <div className="bg-hive-paper border border-dashed border-hive-line rounded-hive-lg p-5 text-center">
              <div className="text-2xl mb-1">📍</div>
              <p className="text-[13px] text-hive-muted font-bold">
                Log a meal out (with a venue name) and your rated places land here — sortable by rating, Diamond, visits and spend.
              </p>
            </div>
          ) : (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-3 lg:p-4">
              <div className="flex gap-4 flex-wrap mb-3">
                <Stat n={String(placesSummary.count)} label="places" />
                <Stat n={`${placesSummary.diamond} 💎`} label="Diamond" />
                <Stat n={placesSummary.avg ? `★${placesSummary.avg}` : '—'} label="avg rating" />
                <Stat n={formatCents(placesSummary.totalSpent, currency)} label="total spent" />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2 -mx-1 px-1">
                {[
                  { id: 'rating', label: 'Top rated' },
                  { id: 'diamond', label: '💎 Diamond' },
                  { id: 'visits', label: 'Most visits' },
                  { id: 'spend', label: 'Biggest spend' },
                  { id: 'cuisine', label: 'By cuisine' },
                ].map((c) => (
                  <button
                    key={c.id} onClick={() => setPlacesSort(c.id as typeof placesSort)}
                    className={`shrink-0 px-3 py-1.5 rounded-hive-pill text-[11px] font-nunito font-extrabold border whitespace-nowrap transition-colors ${
                      placesSort === c.id ? 'bg-[#C2562E] text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                    }`}
                  >{c.label}</button>
                ))}
              </div>
              {sortedVenues.length === 0 ? (
                <p className="text-[12px] text-hive-muted italic text-center py-3">No places match this filter.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {sortedVenues.map((v) => (
                    <button
                      key={v.id} onClick={() => setSheetVenue(v)}
                      className="text-left bg-hive-paper border border-hive-line hover:border-[#C2562E] rounded-hive p-2.5 transition-colors w-full"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl shrink-0">{v.emoji || '🍽️'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-nunito font-extrabold text-[13px] truncate flex items-center gap-1.5">
                            {v.name}{v.diamond && <span title="Family Diamond">💎</span>}
                          </div>
                          <div className="text-[11px] text-hive-muted truncate">
                            {v.avgStars > 0 && <span className="font-bold" style={{ color: '#B8860B' }}>★ {v.avgStars}</span>}
                            {v.avgStars > 0 && ' · '}{v.count} visit{v.count === 1 ? '' : 's'}
                            {v.totalSpentCents > 0 && ` · ${formatCents(v.totalSpentCents, currency)}`}
                            {v.highlights.length > 0 && ` · ${v.highlights.slice(0, 2).join(', ')}`}
                          </div>
                        </div>
                        <span className="text-[11px] font-nunito font-extrabold shrink-0" style={{ color: '#C2562E' }}>Open →</span>
                      </div>
                      {placesSummary.maxSpent > 0 && v.totalSpentCents > 0 && (
                        <div className="mt-1.5 h-1.5 bg-[#EFE7DB] rounded-full overflow-hidden">
                          <div className="h-full" style={{ width: `${Math.round((v.totalSpentCents / placesSummary.maxSpent) * 100)}%`, background: '#C2562E' }} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Slot picker — bottom sheet on mobile, centered modal on desktop. */}
      {picker && (
        <SlotPicker
          dayLabel={`${plan.days[picker.dayIdx].dayName} · ${plan.days[picker.dayIdx].dateLabel}`}
          slotLabel={SLOT_NAMES.find((s) => s.id === picker.slot)!.label}
          foods={foodsForSlot(picker.slot, region, diet)}
          myVenues={isParent ? venues : []}
          onPick={onSlotChosen}
          onDiningOut={onSlotDiningOut}
          onClear={onSlotClear}
          onClose={() => setPicker(null)}
        />
      )}

      {/* Venue history sheet (shared with the Dine Out page) */}
      {sheetVenue && (
        <VenueSheet venue={sheetVenue} currency={currency} familyId={profile?.familyId} onClose={() => setSheetVenue(null)} />
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
  const venue = isOut ? findVenue(slot.venueId) : undefined;
  const venueLabel = isOut ? slotVenueLabel(slot) : '';
  const audienceTag = (isHome || isOut) && slot.audience === 'parents' ? '👨‍❤️‍👨 Parents' : null;
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
          {venue?.emoji || '🍽️'} {venueLabel}
        </p>
      ) : (
        <p className="text-[12px] italic mt-1">— tap to plan</p>
      )}
      {audienceTag && (
        <p className="text-[9px] font-nunito font-extrabold opacity-70 mt-0.5 truncate">
          {audienceTag}
        </p>
      )}
    </button>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div className="font-nunito font-black text-[16px] text-hive-navy leading-tight">{n}</div>
      <div className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">{label}</div>
    </div>
  );
}

function SlotPicker({
  dayLabel, slotLabel, foods, myVenues, onPick, onDiningOut, onClear, onClose,
}: {
  dayLabel: string;
  slotLabel: string;
  foods: DirectoryFood[];
  myVenues: Venue[];
  onPick: (food: DirectoryFood, audience: Audience) => void;
  onDiningOut: (opts: { venueId?: string; venue?: string; audience: Audience }) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  // Tabs inside the picker: pick a home meal vs pick a dining-out
  // venue. Defaults to "cook at home" since that's the more common
  // path; flips to "out" the moment the user touches a venue.
  const [tab, setTab] = useState<'home' | 'out'>('home');
  const [audience, setAudience] = useState<Audience>('family');
  const [venueCategory, setVenueCategory] = useState<DiningCategory | 'all'>('all');
  const [customVenue, setCustomVenue] = useState('');

  // Filter the venues by audience + category. Parents-only hides
  // non-kid-friendly spots so the wine bar disappears for "family"
  // and the family diner can still appear for either audience.
  const venues = DINING_VENUES.filter((v) => {
    if (audience === 'family' && v.kidFriendly === false) return false;
    if (venueCategory !== 'all' && v.category !== venueCategory) return false;
    return true;
  });
  const recommended = venues.filter((v) => v.recommended);
  const others = venues.filter((v) => !v.recommended);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-x-0 bottom-0 lg:inset-0 lg:flex lg:items-center lg:justify-center z-50 px-0 lg:px-4 pointer-events-none">
        <div className="pointer-events-auto bg-hive-paper rounded-t-[28px] lg:rounded-hive-lg w-full lg:max-w-lg max-h-[85vh] lg:max-h-[88vh] flex flex-col shadow-2xl">
          {/* Header */}
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

          {/* Audience (family vs parents-only) — applies to whichever
              path the user takes. */}
          <div className="px-4 py-3 border-b border-hive-line">
            <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-hive-muted mb-2">
              Who's eating?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <AudienceChoice
                active={audience === 'family'}
                onClick={() => setAudience('family')}
                emoji="👪"
                label="Whole family"
                blurb="Everyone joins"
              />
              <AudienceChoice
                active={audience === 'parents'}
                onClick={() => setAudience('parents')}
                emoji="👨‍❤️‍👨"
                label="Parents only"
                blurb="Date night"
              />
            </div>
          </div>

          {/* Home / Out tab toggle */}
          <div className="px-4 pt-3 pb-2 border-b border-hive-line">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTab('home')}
                className={`h-10 rounded-hive-pill font-nunito font-extrabold text-[12px] transition-colors ${
                  tab === 'home' ? 'bg-pantry-leaf text-white' : 'bg-hive-cream text-hive-muted'
                }`}
              >
                🍳 Cooking at home
              </button>
              <button
                onClick={() => setTab('out')}
                className={`h-10 rounded-hive-pill font-nunito font-extrabold text-[12px] transition-colors ${
                  tab === 'out' ? 'bg-hive-honey text-white' : 'bg-hive-cream text-hive-muted'
                }`}
              >
                🍽️ Dining out
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {tab === 'home' ? (
              foods.length === 0 ? (
                <p className="text-center text-[12px] text-hive-muted italic py-8">
                  No meals match your current region + diet for {slotLabel.toLowerCase()}.
                  Loosen the filters or switch to "Dining out".
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-1.5">
                  {foods.map((f) => (
                    <button
                      key={f.label}
                      onClick={() => onPick(f, audience)}
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
              )
            ) : (
              <>
                {/* Your real rated places (Dine Out "Places to go") first. */}
                {myVenues.length > 0 && (
                  <>
                    <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-[#C2562E] px-2 mt-1 mb-2">
                      📍 Your places
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 mb-3">
                      {myVenues.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => onDiningOut({ venueId: v.id, venue: v.name, audience })}
                          className="flex items-center gap-3 text-left bg-hive-paper border border-hive-line hover:border-[#C2562E] rounded-hive p-2.5 transition-colors"
                        >
                          <span className="text-xl shrink-0">{v.emoji || '🍽️'}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-nunito font-extrabold text-[13px] truncate flex items-center gap-1.5">
                              {v.name}{v.diamond && <span title="Family Diamond">💎</span>}
                            </div>
                            <div className="text-[11px] text-hive-muted truncate">
                              {v.avgStars > 0 && `★ ${v.avgStars} · `}{v.count} visit{v.count === 1 ? '' : 's'}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {/* Directory category chips. Tagged "from Directory"
                    so users know where the catalog lives once that
                    module ships in full. */}
                <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-hive-muted px-2 mt-1 mb-2">
                  Venues · from Directory
                </p>
                <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 px-2">
                  {DINING_CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setVenueCategory(c.id)}
                      className={`shrink-0 px-3 py-1.5 rounded-hive-pill text-[11px] font-nunito font-extrabold border whitespace-nowrap transition-colors ${
                        venueCategory === c.id
                          ? 'bg-hive-honey-soft text-hive-honey-dk border-hive-honey'
                          : 'border-hive-line bg-hive-paper text-hive-muted'
                      }`}
                    >
                      {c.emoji} {c.label}
                    </button>
                  ))}
                </div>

                {/* Recommended (stars) come first */}
                {recommended.length > 0 && (
                  <>
                    <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-hive-honey-dk px-2 mb-1.5">
                      ⭐ Recommended
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 mb-3">
                      {recommended.map((v) => (
                        <VenueRow key={v.id} venue={v} onPick={() => onDiningOut({ venueId: v.id, audience })} />
                      ))}
                    </div>
                  </>
                )}
                {others.length > 0 && (
                  <>
                    <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-hive-muted px-2 mb-1.5">
                      More venues
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 mb-3">
                      {others.map((v) => (
                        <VenueRow key={v.id} venue={v} onPick={() => onDiningOut({ venueId: v.id, audience })} />
                      ))}
                    </div>
                  </>
                )}
                {/* Free-text override for venues not in the Yellow
                    Pages catalog yet. */}
                <div className="px-2 pb-2">
                  <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-hive-muted mb-1.5">
                    Or type a custom venue
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={customVenue}
                      onChange={(e) => setCustomVenue(e.target.value)}
                      placeholder="e.g. Aunt Sarah's place"
                      maxLength={40}
                      className="flex-1 h-10 px-3 rounded-hive bg-hive-paper border border-hive-line text-[13px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
                    />
                    <button
                      onClick={() => onDiningOut({ venue: customVenue, audience })}
                      disabled={!customVenue.trim()}
                      className="h-10 px-4 rounded-hive-pill bg-hive-honey text-white font-nunito font-black text-[12px] disabled:opacity-50"
                    >
                      Use
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer · Clear is its own dedicated button now */}
          <div className="px-4 py-3 border-t border-hive-line flex gap-2">
            <button
              onClick={onClear}
              className="flex-1 h-10 rounded-hive-pill bg-hive-rose/10 border border-hive-rose/40 text-hive-rose font-nunito font-extrabold text-[12px]"
            >
              🗑 Clear slot
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

function AudienceChoice({
  active, onClick, emoji, label, blurb,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  label: string;
  blurb: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-hive border text-left transition-colors ${
        active
          ? 'bg-pantry-leaf-soft border-pantry-leaf text-hive-navy'
          : 'bg-hive-paper border-hive-line text-hive-muted hover:border-pantry-leaf/50'
      }`}
    >
      <span className="text-xl leading-none shrink-0">{emoji}</span>
      <div className="min-w-0">
        <p className="font-nunito font-extrabold text-[12px] truncate">{label}</p>
        <p className="text-[10px] opacity-80 truncate">{blurb}</p>
      </div>
    </button>
  );
}

function VenueRow({ venue, onPick }: { venue: DiningVenue; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="flex items-center gap-3 text-left bg-hive-paper border border-hive-line hover:border-hive-honey rounded-hive p-2.5 transition-colors"
    >
      <span className="text-xl shrink-0">{venue.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="font-nunito font-extrabold text-[13px] truncate">{venue.name}</p>
          <span className="text-[10px] font-nunito font-extrabold text-hive-muted shrink-0">{venue.tier}</span>
        </div>
        {venue.blurb && (
          <p className="text-[11px] text-hive-muted truncate">{venue.blurb}</p>
        )}
      </div>
      {!venue.kidFriendly && (
        <span className="text-[9px] font-nunito font-extrabold uppercase tracking-wider bg-hive-honey-soft text-hive-honey-dk px-1.5 py-0.5 rounded-full shrink-0">
          21+
        </span>
      )}
    </button>
  );
}
