'use client';

// /pantry/list/templates — Pre-built lists a parent can pick from
// instead of filling the Smart-start form. Two surfaces:
//
//   ⭐ Popular — 10 hand-curated combos covering the most common
//      household shapes (family of 4 EA, vegan couple, new baby,
//      etc.). Each is just a SmartStartPrefs preset under the hood.
//
//   All templates — every (size × region × diet × cadence)
//      combination, surfaced as a browseable grid filtered by the
//      chip row at the top. Looks like "thousands" without us
//      having to author any of it.
//
// Tapping a template opens a preview drawer (item count, estimated
// total, sample items), and "Use this list" creates the list and
// jumps the user into the active list page.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  generateList, generateListName,
  type SmartStartPrefs, type HouseholdSize, type Lifestyle,
} from '@/lib/listGenerator';
import { createList, thisWeekKey, type GroceryListItem, type Cadence } from '@/lib/pantry';
import type { Region } from '@/lib/pantryDirectory';
import { formatCents } from '@/components/pantry/format';
import { useHive } from '@/contexts/HiveContext';

interface Template {
  id: string;
  emoji: string;
  title: string;
  blurb: string;
  prefs: SmartStartPrefs;
}

// ── Popular curated picks ────────────────────────────────────────

const POPULAR: Template[] = [
  {
    id: 'family-of-4-ea',
    emoji: '👨‍👩‍👧',
    title: 'Family of 4 · East Africa',
    blurb: 'Weekly run — ugali, sukuma, chicken, kid-friendly produce.',
    prefs: { size: 'family', household: 'house', region: 'east-africa',
             lifestyle: 'mixed', special: [], budget: 'standard', cadence: 'weekly' },
  },
  {
    id: 'big-family-ea',
    emoji: '👨‍👩‍👧‍👦',
    title: 'Big family · East Africa',
    blurb: 'Bi-weekly bulk run for 5+. Bigger bags, more variety, baby & cleaning extras.',
    prefs: { size: 'big', household: 'house', region: 'east-africa',
             lifestyle: 'mixed', special: ['baby'], budget: 'standard', cadence: 'biweekly' },
  },
  {
    id: 'vegan-couple-monthly',
    emoji: '🌱',
    title: 'Vegan couple · Monthly bulk',
    blurb: 'Plant-based pantry plus produce. Monthly cadence keeps trips down.',
    prefs: { size: 'solo', household: 'apartment', region: 'global',
             lifestyle: 'vegan', special: [], budget: 'standard', cadence: 'monthly' },
  },
  {
    id: 'indian-family-veg',
    emoji: '🇮🇳',
    title: 'Indian family · Vegetarian',
    blurb: 'Atta, dal, paneer, ghee — South-Asian staples without meat.',
    prefs: { size: 'family', household: 'apartment', region: 'south-asia',
             lifestyle: 'veg', special: [], budget: 'standard', cadence: 'weekly' },
  },
  {
    id: 'new-baby',
    emoji: '👶',
    title: 'New baby essentials',
    blurb: 'Adds diapers, wipes, formula and lotion to the regular family run.',
    prefs: { size: 'family', household: 'apartment', region: 'east-africa',
             lifestyle: 'mixed', special: ['baby'], budget: 'standard', cadence: 'weekly' },
  },
  {
    id: 'halal-family-bi',
    emoji: '☪️',
    title: 'Halal family · Bi-weekly',
    blurb: 'Halal meat sourcing assumed; covers two weeks at a time.',
    prefs: { size: 'family', household: 'house', region: 'east-africa',
             lifestyle: 'halal', special: [], budget: 'standard', cadence: 'biweekly' },
  },
  {
    id: 'single-pro',
    emoji: '🧑‍💻',
    title: 'Single professional · Weekly',
    blurb: 'Lean, apartment-sized. Mostly produce + dairy + a few staples.',
    prefs: { size: 'solo', household: 'apartment', region: 'global',
             lifestyle: 'mixed', special: [], budget: 'lean', cadence: 'weekly' },
  },
  {
    id: 'student-budget',
    emoji: '🎓',
    title: 'Student · Shared house · Lean',
    blurb: 'Cheapest tier, basics only. Pasta, rice, oil, bread, eggs.',
    prefs: { size: 'solo', household: 'shared', region: 'global',
             lifestyle: 'mixed', special: [], budget: 'lean', cadence: 'weekly' },
  },
  {
    id: 'multi-gen-elderly',
    emoji: '👵',
    title: 'Multi-gen home · Elderly care',
    blurb: 'Adds painkillers, plasters, sanitiser to the big-family run.',
    prefs: { size: 'big', household: 'house', region: 'east-africa',
             lifestyle: 'mixed', special: ['elderly'], budget: 'standard', cadence: 'weekly' },
  },
  {
    id: 'pet-household',
    emoji: '🐾',
    title: 'Family with pets',
    blurb: 'Family of 4 plus pet food on the list every run.',
    prefs: { size: 'family', household: 'house', region: 'global',
             lifestyle: 'mixed', special: ['pet'], budget: 'standard', cadence: 'weekly' },
  },
];

// ── Permutations (the "thousands") ───────────────────────────────

const SIZES: HouseholdSize[]            = ['solo', 'family', 'big'];
const REGIONS: (Region | 'any')[]       = ['east-africa', 'south-asia', 'global'];
const DIETS: Lifestyle[]                = ['mixed', 'veg', 'vegan', 'halal'];
const CADENCES: Cadence[]               = ['weekly', 'biweekly', 'monthly'];

const SIZE_LABEL: Record<HouseholdSize, string> = {
  solo: '1–2 people', family: '3–4 people', big: '5+ people',
};
const REGION_LABEL: Record<Region | 'any', string> = {
  'east-africa': '🇹🇿 East Africa', 'south-asia': '🇮🇳 South Asia',
  'global': '🌐 Global', 'any': '🌐 Global',
};
const DIET_LABEL: Record<Lifestyle, string> = {
  mixed: '🥗 Mixed', veg: '🥬 Veg', vegan: '🌱 Vegan', halal: '☪️ Halal',
};
const CADENCE_LABEL: Record<Cadence, string> = {
  daily: 'Daily', weekly: 'Weekly', biweekly: '2× a week',
  semimonthly: '2× a month', monthly: 'Monthly',
  quarterly: 'Quarterly', yearly: 'Yearly', 'as-needed': 'As needed',
};

function buildPermutations(): Template[] {
  const out: Template[] = [];
  for (const size of SIZES) {
    for (const region of REGIONS) {
      for (const diet of DIETS) {
        for (const cadence of CADENCES) {
          const prefs: SmartStartPrefs = {
            size, household: 'house', region, lifestyle: diet,
            special: [], budget: 'standard', cadence,
          };
          out.push({
            id: `perm-${size}-${region}-${diet}-${cadence}`,
            emoji: diet === 'vegan' ? '🌱' : diet === 'veg' ? '🥬' : diet === 'halal' ? '☪️' : '🍽️',
            title: `${SIZE_LABEL[size]} · ${REGION_LABEL[region].replace(/^\S+\s/,'')}`,
            blurb: `${DIET_LABEL[diet]} · ${CADENCE_LABEL[cadence]} run`,
            prefs,
          });
        }
      }
    }
  }
  return out;
}

const ALL_PERMUTATIONS = buildPermutations();

// ── Page ─────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { config } = useHive();
  const currency = config.currency;

  const [size, setSize] = useState<HouseholdSize | 'all'>('all');
  const [region, setRegion] = useState<Region | 'any' | 'all'>('all');
  const [diet, setDiet] = useState<Lifestyle | 'all'>('all');
  const [cadence, setCadence] = useState<Cadence | 'all'>('all');
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ALL_PERMUTATIONS.filter((t) => {
      if (size !== 'all' && t.prefs.size !== size) return false;
      if (region !== 'all' && t.prefs.region !== region) return false;
      if (diet !== 'all' && t.prefs.lifestyle !== diet) return false;
      if (cadence !== 'all' && t.prefs.cadence !== cadence) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.blurb.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [size, region, diet, cadence, search]);

  const useTemplate = async (t: Template) => {
    if (!profile?.familyId || isGuest) return;
    setBusy(true);
    try {
      const items = generateList(t.prefs, currency);
      const id = await createList(profile.familyId, {
        name: t.title,
        weekOf: thisWeekKey(),
        items,
      }, 'template');
      router.push(`/pantry/list/${id}`);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32 lg:pb-12">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Pantry · Templates
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">
          Pick a template 📋
        </h1>
        <p className="text-[12px] lg:text-[13px] text-hive-muted mt-1">
          Pre-built lists by region, size, lifestyle, cadence. Tap one to preview.
        </p>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder='🔎  Search "vegan", "baby", "Nairobi"…'
        className="w-full h-11 px-4 mb-3 rounded-hive-pill bg-hive-paper border border-hive-line text-[13px] focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
      />

      {/* Filter chip rows */}
      <ChipRow label="Size">
        <Chip active={size === 'all'} onClick={() => setSize('all')}>All</Chip>
        {SIZES.map((s) => (
          <Chip key={s} active={size === s} onClick={() => setSize(s)}>{SIZE_LABEL[s]}</Chip>
        ))}
      </ChipRow>
      <ChipRow label="Region">
        <Chip active={region === 'all'} onClick={() => setRegion('all')}>All</Chip>
        {REGIONS.map((r) => (
          <Chip key={r} active={region === r} onClick={() => setRegion(r)}>{REGION_LABEL[r]}</Chip>
        ))}
      </ChipRow>
      <ChipRow label="Diet">
        <Chip active={diet === 'all'} onClick={() => setDiet('all')}>All</Chip>
        {DIETS.map((d) => (
          <Chip key={d} active={diet === d} onClick={() => setDiet(d)}>{DIET_LABEL[d]}</Chip>
        ))}
      </ChipRow>
      <ChipRow label="Cadence">
        <Chip active={cadence === 'all'} onClick={() => setCadence('all')}>All</Chip>
        {CADENCES.map((c) => (
          <Chip key={c} active={cadence === c} onClick={() => setCadence(c)}>{CADENCE_LABEL[c]}</Chip>
        ))}
      </ChipRow>

      {/* ⭐ Popular row — always visible regardless of filters */}
      <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-hive-honey-dk mt-4 mb-2">
        ⭐ Popular picks
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-4">
        {POPULAR.map((t) => (
          <TemplateCard key={t.id} template={t} onTap={() => setPreview(t)} />
        ))}
      </div>

      {/* All matching templates */}
      <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-hive-muted mt-2 mb-2">
        All templates · {visible.length} matching
      </p>
      {visible.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <p className="text-3xl mb-1">🧺</p>
          <p className="text-[12px] text-hive-muted">No templates match these filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {visible.slice(0, 60).map((t) => (
            <TemplateCard key={t.id} template={t} onTap={() => setPreview(t)} />
          ))}
          {visible.length > 60 && (
            <p className="text-center text-[11px] text-hive-muted py-3 lg:col-span-2">
              + {visible.length - 60} more · narrow your filters to see them
            </p>
          )}
        </div>
      )}

      {/* Preview drawer */}
      {preview && (
        <TemplatePreview
          template={preview}
          currency={currency}
          busy={busy}
          onUse={() => useTemplate(preview)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function TemplateCard({ template, onTap }: { template: Template; onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      className="w-full text-left bg-hive-paper border border-hive-line hover:border-pantry-leaf rounded-hive p-3 transition-colors"
    >
      <div className="flex items-start gap-2.5">
        <span className="text-2xl leading-none shrink-0">{template.emoji}</span>
        <div className="min-w-0">
          <p className="font-nunito font-extrabold text-[13px] truncate">{template.title}</p>
          <p className="text-[11px] text-hive-muted leading-snug mt-0.5">{template.blurb}</p>
        </div>
      </div>
    </button>
  );
}

function TemplatePreview({
  template, currency, busy, onUse, onClose,
}: {
  template: Template;
  currency: string;
  busy: boolean;
  onUse: () => void;
  onClose: () => void;
}) {
  const items = useMemo(() => generateList(template.prefs, currency), [template, currency]);
  const total = items.reduce((sum, i) => sum + (i.estimatedCents || 0), 0);
  const foodItems = items.filter((i) => i.category && ['produce','dairy','pantry'].includes(i.category));
  const consItems = items.filter((i) => i.category && ['cleaning','personal','other'].includes(i.category));
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-0 lg:inset-0 lg:flex lg:items-center lg:justify-center z-50 px-0 lg:px-4 pointer-events-none">
        <div className="pointer-events-auto bg-hive-paper rounded-t-[28px] lg:rounded-hive-lg w-full lg:max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
          <div className="px-4 pt-3 pb-2 border-b border-hive-line">
            <div className="w-10 h-1 rounded-full bg-hive-line mx-auto mb-2 lg:hidden" />
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-hive-muted">
                  Template preview
                </p>
                <p className="font-nunito font-black text-[18px]">{template.emoji} {template.title}</p>
              </div>
              <button onClick={onClose} className="text-hive-muted text-2xl leading-none px-2" aria-label="Close">×</button>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <Stat label="Items" value={`${items.length}`} />
              <Stat label="Food" value={`${foodItems.length}`} />
              <Stat label="Consumables" value={`${consItems.length}`} />
            </div>
            <p className="text-center font-nunito font-black text-[15px] text-pantry-leaf-dk mt-2">
              ~ {formatCents(total, currency)}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            <SamplePreview title="🍽️ Food" rows={foodItems.slice(0, 8)} more={Math.max(0, foodItems.length - 8)} />
            <SamplePreview title="🧴 Consumables" rows={consItems.slice(0, 6)} more={Math.max(0, consItems.length - 6)} />
          </div>
          <div className="px-4 py-3 border-t border-hive-line flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 h-11 rounded-hive-pill bg-hive-cream text-hive-navy font-nunito font-extrabold text-[12px]"
            >
              Close
            </button>
            <button
              onClick={onUse}
              disabled={busy}
              className="flex-1 h-11 rounded-hive-pill bg-pantry-leaf text-white font-nunito font-black text-[13px] disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Use this list →'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center bg-hive-cream rounded-hive p-2">
      <p className="text-[10px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">{label}</p>
      <p className="font-nunito font-black text-[16px] text-hive-navy">{value}</p>
    </div>
  );
}

function SamplePreview({ title, rows, more }: { title: string; rows: GroceryListItem[]; more: number }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-pantry-leaf-dk mb-1.5">
        {title}
      </p>
      <ul className="text-[12px] text-hive-navy space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline justify-between gap-2">
            <span className="truncate">{r.name}</span>
            <span className="text-hive-muted shrink-0">{r.qty}{r.unit ? ` ${r.unit}` : ''}</span>
          </li>
        ))}
        {more > 0 && <li className="text-hive-muted italic">+ {more} more…</li>}
      </ul>
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.2px] text-hive-muted mb-1">
        {label}
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">{children}</div>
    </div>
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
