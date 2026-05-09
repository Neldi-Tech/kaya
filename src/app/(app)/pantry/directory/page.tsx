'use client';

// /pantry/directory — browseable catalog of common household items + a
// foods directory (Breakfast → Dinner + Fruits + Snacks). The intent is
// "I'm here, I want everyone's favorites" — tap-to-multi-select then
// "Add N to staples". Foods use a separate tab and, when tapped, offer
// to seed *their* component staples into the master list.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { usePantry } from '@/contexts/PantryContext';
import {
  STAPLES_DIRECTORY, FOODS_DIRECTORY, FOOD_MEAL_TYPES,
  FoodMealType, StapleDirectoryItem,
} from '@/lib/pantryDirectory';
import { addStaplesBulk, STAPLE_CATEGORIES, StapleCategory } from '@/lib/pantry';
import BackButton from '@/components/ui/BackButton';

type Tab = 'staples' | 'foods';
type CatFilter = 'all' | StapleCategory;
type RegionFilter = 'all' | 'east-africa' | 'south-asia' | 'global';

export default function DirectoryPage() {
  const { profile, isGuest } = useAuth();
  const { staples } = usePantry();

  const [tab, setTab] = useState<Tab>('staples');
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<CatFilter>('all');
  const [region, setRegion] = useState<RegionFilter>('all');
  const [foodMeal, setFoodMeal] = useState<FoodMealType | 'all'>('all');

  // Multi-select keyed by item label (works for both staples & foods'
  // resolved staples — labels are unique within each catalog).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState('');

  const haveSet = useMemo(
    () => new Set(staples.map((s) => s.name.trim().toLowerCase())),
    [staples],
  );

  // ── Filtering ─────────────────────────────────────────────────
  const visibleStaples = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STAPLES_DIRECTORY
      .filter((s) => catFilter === 'all' || s.category === catFilter)
      .filter((s) => region === 'all' || s.tags.includes(region))
      .filter((s) =>
        q.length < 2 ||
        s.label.toLowerCase().includes(q) ||
        s.match.some((m) => m.includes(q)),
      )
      .sort((a, b) => b.weight - a.weight);
  }, [query, catFilter, region]);

  const visibleFoods = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FOODS_DIRECTORY
      .filter((f) => foodMeal === 'all' || f.mealTypes.includes(foodMeal))
      .filter((f) =>
        q.length < 2 ||
        f.label.toLowerCase().includes(q) ||
        f.match.some((m) => m.includes(q)),
      );
  }, [query, foodMeal]);

  // ── Multi-select ──────────────────────────────────────────────
  const toggle = (label: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  /** Foods → resolve to their component staple labels and toggle each
   *  not-already-in-staples one on. */
  const addFoodStaplesToPick = (foodLabel: string) => {
    const food = FOODS_DIRECTORY.find((f) => f.label === foodLabel);
    if (!food?.staples) return;
    setPicked((prev) => {
      const next = new Set(prev);
      for (const staple of food.staples!) {
        if (!haveSet.has(staple.toLowerCase())) next.add(staple);
      }
      return next;
    });
    setToast(`Added ${food.staples.length} item${food.staples.length === 1 ? '' : 's'} to selection`);
    setTimeout(() => setToast(null), 1600);
  };

  const submit = async () => {
    if (!profile?.familyId || isGuest) {
      setError('Sign in to add items.');
      return;
    }
    if (picked.size === 0) return;
    setError('');
    setSaving(true);
    try {
      const rows = Array.from(picked)
        .map((label) => STAPLES_DIRECTORY.find((s) => s.label === label))
        .filter((x): x is StapleDirectoryItem => !!x)
        .map((s) => ({
          name: s.label,
          category: s.category,
          defaultQty: s.defaultQty,
          unit: s.unit,
          cadence: s.cadence,
        }));
      const written = await addStaplesBulk(profile.familyId, rows, staples);
      setToast(`✓ Added ${written} to staples`);
      setPicked(new Set());
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setError(e?.message || 'Could not add items.');
    }
    setSaving(false);
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-24">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">Pantry · Directory</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1 leading-tight">Browse everything 🧺</h1>
        <p className="text-[12px] text-hive-muted mt-1">Tap to multi-select, then save to your staples.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-hive-cream rounded-hive-pill p-1 mb-3">
        <TabBtn active={tab === 'staples'} onClick={() => setTab('staples')}>
          🧺 Staples · {STAPLES_DIRECTORY.length}
        </TabBtn>
        <TabBtn active={tab === 'foods'} onClick={() => setTab('foods')}>
          🍽️ Foods · {FOODS_DIRECTORY.length}
        </TabBtn>
      </div>

      {/* Search */}
      <div className="bg-hive-paper border border-hive-line rounded-hive-pill px-3 mb-3 flex items-center gap-2">
        <span className="text-hive-muted">🔎</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === 'staples' ? 'Search rice, omo, eggs…' : 'Search ugali, biryani, mango…'}
          className="flex-1 h-10 bg-transparent text-[13px] focus:outline-none"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-hive-muted text-sm">✕</button>
        )}
      </div>

      {/* Filters · staples tab */}
      {tab === 'staples' && (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2">
            <Chip active={catFilter === 'all'} onClick={() => setCatFilter('all')}>All</Chip>
            {STAPLE_CATEGORIES.map((c) => (
              <Chip key={c.id} active={catFilter === c.id} onClick={() => setCatFilter(c.id)}>
                {c.emoji} {c.label}
              </Chip>
            ))}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
            <SmallChip active={region === 'all'} onClick={() => setRegion('all')}>🌍 Any region</SmallChip>
            <SmallChip active={region === 'east-africa'} onClick={() => setRegion('east-africa')}>🇹🇿 East Africa</SmallChip>
            <SmallChip active={region === 'south-asia'} onClick={() => setRegion('south-asia')}>🇮🇳 South Asia</SmallChip>
            <SmallChip active={region === 'global'} onClick={() => setRegion('global')}>🌐 Global</SmallChip>
          </div>
        </>
      )}

      {/* Filters · foods tab */}
      {tab === 'foods' && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
          <Chip active={foodMeal === 'all'} onClick={() => setFoodMeal('all')}>All meals</Chip>
          {FOOD_MEAL_TYPES.map((m) => (
            <Chip key={m.id} active={foodMeal === m.id} onClick={() => setFoodMeal(m.id)}>
              {m.emoji} {m.label}
            </Chip>
          ))}
        </div>
      )}

      {error && <p className="text-hive-rose text-sm font-bold text-center mb-3">{error}</p>}

      {/* Lists */}
      {tab === 'staples' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {visibleStaples.map((s) => {
            const have = haveSet.has(s.label.toLowerCase());
            const on = picked.has(s.label);
            return (
              <button
                key={s.label}
                onClick={() => !have && toggle(s.label)}
                disabled={have}
                className={`text-left rounded-hive border p-3 transition-colors ${
                  have
                    ? 'bg-hive-cream/50 border-hive-line opacity-60 cursor-default'
                    : on
                      ? 'bg-pantry-leaf-soft border-pantry-leaf'
                      : 'bg-hive-paper border-hive-line hover:border-pantry-leaf'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">{s.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-nunito font-extrabold text-[13px] truncate">{s.label}</p>
                    <p className="text-[10px] text-hive-muted">
                      {s.defaultQty} {s.unit} · {s.cadence}
                    </p>
                  </div>
                  {have ? (
                    <span className="text-[10px] font-nunito font-extrabold text-hive-muted">✓ Saved</span>
                  ) : on ? (
                    <span className="text-pantry-leaf-dk text-lg">✓</span>
                  ) : null}
                </div>
                {s.hint && (
                  <p className="text-[10px] text-hive-muted mt-1 italic truncate">{s.hint}</p>
                )}
              </button>
            );
          })}
          {visibleStaples.length === 0 && (
            <p className="col-span-full text-center text-hive-muted text-[12px] italic py-6">
              No matches. Try clearing filters or searching differently.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleFoods.map((f) => (
            <div
              key={f.label}
              className="bg-hive-paper border border-hive-line rounded-hive p-3"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{f.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-nunito font-extrabold text-[14px] truncate">{f.label}</p>
                  <p className="text-[10px] text-hive-muted uppercase tracking-wider font-bold">
                    {f.mealTypes.join(' · ')}
                  </p>
                </div>
                {f.staples && f.staples.length > 0 && (
                  <button
                    onClick={() => addFoodStaplesToPick(f.label)}
                    className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk hover:underline"
                  >
                    + Staples
                  </button>
                )}
              </div>
              {f.hint && (
                <p className="text-[11px] text-hive-muted italic mt-1">{f.hint}</p>
              )}
              {f.staples && f.staples.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {f.staples.map((label) => {
                    const have = haveSet.has(label.toLowerCase());
                    return (
                      <span
                        key={label}
                        className={`text-[10px] font-nunito font-extrabold px-2 py-0.5 rounded-hive-pill ${
                          have
                            ? 'bg-hive-cream text-hive-muted line-through'
                            : 'bg-pantry-leaf-soft text-pantry-leaf-dk'
                        }`}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {visibleFoods.length === 0 && (
            <p className="text-center text-hive-muted text-[12px] italic py-6">
              No matches. Try a different meal or search.
            </p>
          )}
          <p className="text-[11px] text-hive-muted text-center mt-2">
            Tap <strong className="text-pantry-leaf-dk">+ Staples</strong> on a food to queue its ingredients for adding.
          </p>
        </div>
      )}

      {/* Floating action — visible whenever picks > 0 */}
      {picked.size > 0 && (
        <div className="sticky bottom-2 mt-4 bg-hive-paper/95 backdrop-blur border border-hive-line rounded-hive p-3 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.15)]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPicked(new Set())}
              className="px-4 h-12 rounded-hive-pill border border-hive-line bg-hive-paper text-[12px] font-nunito font-extrabold text-hive-muted"
            >
              Clear
            </button>
            <button
              onClick={submit}
              disabled={saving || isGuest}
              className="flex-1 h-12 rounded-hive bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-sm disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : `Add ${picked.size} to staples`}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-pantry-leaf-dk text-white text-[12px] font-nunito font-extrabold px-4 py-2 rounded-hive-pill shadow-lg z-50">
          {toast}
        </div>
      )}

      <p className="text-center text-[11px] text-hive-muted mt-6">
        New here? <Link href="/pantry/onboard" className="text-pantry-leaf-dk font-bold hover:underline">Try the AI quick-start →</Link>
      </p>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 h-10 rounded-hive-pill text-[12px] font-nunito font-extrabold transition-colors ${
        active ? 'bg-pantry-leaf text-white shadow-sm' : 'text-hive-muted hover:text-hive-navy'
      }`}
    >
      {children}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 h-8 rounded-hive-pill border text-[12px] font-nunito font-extrabold transition-colors ${
        active
          ? 'bg-pantry-leaf text-white border-transparent'
          : 'bg-hive-paper border-hive-line text-hive-muted hover:border-pantry-leaf/40'
      }`}
    >
      {children}
    </button>
  );
}

function SmallChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-2.5 h-7 rounded-hive-pill border text-[11px] font-nunito font-extrabold transition-colors ${
        active
          ? 'bg-hive-honey-soft border-hive-honey text-hive-honey-dk'
          : 'bg-hive-paper border-hive-line text-hive-muted hover:border-hive-honey/40'
      }`}
    >
      {children}
    </button>
  );
}
