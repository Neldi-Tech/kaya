'use client';

// /pantry/list/new — Three doors into a new grocery list:
//
//   ✨ Smart-start    — Tell us about your home → AI-feel rule-based
//                       generator builds the list in one tap
//   📋 Templates      — Browse pre-built lists by region/size/etc.
//   ✏️ Start blank    — For power users who type their own list
//
// Plus a "Use my saved staples instead" pivot for existing users
// with a staples list already curated.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { usePantry } from '@/contexts/PantryContext';
import { createList, thisWeekKey, thisWeekLabel } from '@/lib/pantry';
import {
  generateList, generateListName,
  type SmartStartPrefs, type HouseholdSize, type HouseholdType,
  type Lifestyle, type Budget, type SpecialNeed,
} from '@/lib/listGenerator';
import type { Region } from '@/lib/pantryDirectory';
import type { Cadence } from '@/lib/pantry';

type Door = 'smart' | 'templates' | 'blank';

export default function NewListPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { children: kids } = useFamily();
  const { staples } = usePantry();

  const [door, setDoor] = useState<Door | null>(null);
  const kidCount = kids?.length || 0;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32 lg:pb-12">
      <div className="mb-4">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Pantry · New list
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1 leading-tight">
          Run the week 🛒
        </h1>
        <p className="text-[12px] lg:text-[13px] text-hive-muted mt-1">
          How would you like to start? Pick a door — you can edit before the list is saved.
        </p>
      </div>

      {/* Three doors */}
      <div className="space-y-3 mb-4">
        <DoorCard
          active={door === 'smart'}
          onClick={() => setDoor('smart')}
          emoji="✨"
          title="Smart-start"
          tagline="RECOMMENDED · ~30 seconds"
          blurb="Tell us about your home — we'll pick the right items, quantities and brands. Splits Food + Consumables for you."
        />
        <DoorCard
          active={door === 'templates'}
          onClick={() => setDoor('templates')}
          emoji="📋"
          title="Pick a template"
          tagline="Thousands available"
          blurb="Browse pre-built lists by region, size, lifestyle, cadence. Use as-is or tweak."
        />
        <DoorCard
          active={door === 'blank'}
          onClick={() => setDoor('blank')}
          emoji="✏️"
          title="Start blank"
          tagline="Power user"
          blurb="Open a fresh list and build from scratch. Search the directory as you go."
        />
      </div>

      {/* Pivot to existing staples */}
      {staples.length > 0 && (
        <UseStaplesPivot count={staples.length} />
      )}

      {/* Selected door's body */}
      {door === 'smart' && (
        <SmartStartForm
          familyId={profile?.familyId || ''}
          isGuest={isGuest}
          defaultSize={kidCount === 0 ? 'solo' : kidCount <= 2 ? 'family' : 'big'}
          onCreated={(id) => router.push(`/pantry/list/${id}`)}
        />
      )}
      {door === 'templates' && (
        <div className="mt-4 bg-hive-paper border border-hive-line rounded-hive-lg p-5 text-center">
          <p className="text-3xl mb-1">📋</p>
          <p className="font-nunito font-extrabold text-[14px]">Templates browser</p>
          <p className="text-[12px] text-hive-muted mt-1 mb-3">
            Coming next — under construction. Try Smart-start in the meantime.
          </p>
          <Link
            href="/pantry/list/templates"
            className="inline-block h-10 px-4 rounded-hive-pill bg-pantry-leaf-soft text-pantry-leaf-dk font-nunito font-extrabold text-[12px] no-underline"
          >
            Open templates browser →
          </Link>
        </div>
      )}
      {door === 'blank' && (
        <BlankStartCard
          familyId={profile?.familyId || ''}
          isGuest={isGuest}
          onCreated={(id) => router.push(`/pantry/list/${id}`)}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function DoorCard({
  active, onClick, emoji, title, tagline, blurb,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  title: string;
  tagline: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left bg-hive-paper border-2 rounded-hive-lg p-4 transition-colors ${
        active ? 'border-pantry-leaf bg-pantry-leaf-soft/30' : 'border-hive-line hover:border-pantry-leaf/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-3xl leading-none shrink-0">{emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="font-nunito font-black text-[16px]">{title}</p>
            <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1px] text-pantry-leaf-dk">
              {tagline}
            </p>
          </div>
          <p className="text-[12px] text-hive-muted mt-1 leading-snug">{blurb}</p>
        </div>
      </div>
    </button>
  );
}

function UseStaplesPivot({ count }: { count: number }) {
  return (
    <div className="mb-4 bg-pantry-leaf-soft/40 border border-pantry-leaf/30 rounded-hive p-3 text-center">
      <p className="text-[12px] text-hive-navy">
        💡 Already have <strong>{count} staple{count === 1 ? '' : 's'}</strong> saved?{' '}
        <Link href="/pantry" className="text-pantry-leaf-dk font-bold underline">
          Seed from my staples instead →
        </Link>
      </p>
    </div>
  );
}

// ── Smart-start form ──────────────────────────────────────────────

function SmartStartForm({
  familyId, isGuest, defaultSize, onCreated,
}: {
  familyId: string;
  isGuest: boolean;
  defaultSize: HouseholdSize;
  onCreated: (id: string) => void;
}) {
  const [size, setSize] = useState<HouseholdSize>(defaultSize);
  const [household, setHousehold] = useState<HouseholdType>('apartment');
  const [region, setRegion] = useState<Region | 'any'>('east-africa');
  const [city, setCity] = useState('');
  const [lifestyle, setLifestyle] = useState<Lifestyle>('mixed');
  const [special, setSpecial] = useState<SpecialNeed[]>([]);
  const [budget, setBudget] = useState<Budget>('standard');
  const [cadence, setCadence] = useState<Cadence>('weekly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggleSpecial = (s: SpecialNeed) => {
    setSpecial((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };

  const submit = async () => {
    if (!familyId || isGuest) {
      setError('Sign in first to create a list.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const prefs: SmartStartPrefs = {
        size, household, region, city: city.trim() || undefined,
        lifestyle, special, budget, cadence,
      };
      const items = generateList(prefs);
      if (items.length === 0) {
        setError('No items match those preferences — try widening one filter.');
        setBusy(false);
        return;
      }
      const id = await createList(familyId, {
        name: generateListName(prefs),
        weekOf: thisWeekKey(),
        items,
      }, 'smart-start');
      onCreated(id);
    } catch (e: any) {
      setError(e?.message || 'Could not generate the list.');
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 bg-hive-paper border-2 border-pantry-leaf rounded-hive-lg p-4 space-y-4">
      <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.6px] text-pantry-leaf-dk">
        ✨ Tell us about your home
      </p>

      <FormRow label="Who's eating?">
        <Choice active={size === 'solo'}   onClick={() => setSize('solo')}>1–2 people</Choice>
        <Choice active={size === 'family'} onClick={() => setSize('family')}>3–4</Choice>
        <Choice active={size === 'big'}    onClick={() => setSize('big')}>5+</Choice>
      </FormRow>

      <FormRow label="Household">
        <Choice active={household === 'apartment'} onClick={() => setHousehold('apartment')}>🏢 Apartment</Choice>
        <Choice active={household === 'house'}     onClick={() => setHousehold('house')}>🏡 House</Choice>
        <Choice active={household === 'shared'}    onClick={() => setHousehold('shared')}>👥 Shared</Choice>
      </FormRow>

      <FormRow label="Region">
        <Choice active={region === 'east-africa'} onClick={() => setRegion('east-africa')}>🇹🇿 East Africa</Choice>
        <Choice active={region === 'south-asia'}  onClick={() => setRegion('south-asia')}>🇮🇳 South Asia</Choice>
        <Choice active={region === 'global'}      onClick={() => setRegion('global')}>🌐 Global</Choice>
      </FormRow>

      <div>
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.2px] text-hive-muted mb-1.5">
          City (optional)
        </p>
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="e.g. Nairobi, Mumbai…"
          maxLength={40}
          className="w-full h-10 px-3 rounded-hive bg-hive-cream border border-hive-line text-[13px] focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </div>

      <FormRow label="Diet">
        <Choice active={lifestyle === 'mixed'} onClick={() => setLifestyle('mixed')}>🥗 Mixed</Choice>
        <Choice active={lifestyle === 'veg'}   onClick={() => setLifestyle('veg')}>🥬 Veg</Choice>
        <Choice active={lifestyle === 'vegan'} onClick={() => setLifestyle('vegan')}>🌱 Vegan</Choice>
        <Choice active={lifestyle === 'halal'} onClick={() => setLifestyle('halal')}>☪️ Halal</Choice>
      </FormRow>

      <FormRow label="Special needs (tap any that apply)">
        <Choice active={special.includes('baby')}    onClick={() => toggleSpecial('baby')}>👶 Baby</Choice>
        <Choice active={special.includes('pet')}     onClick={() => toggleSpecial('pet')}>🐾 Pet</Choice>
        <Choice active={special.includes('elderly')} onClick={() => toggleSpecial('elderly')}>👵 Elderly</Choice>
      </FormRow>

      <FormRow label="Budget">
        <Choice active={budget === 'lean'}     onClick={() => setBudget('lean')}>💰 Lean</Choice>
        <Choice active={budget === 'standard'} onClick={() => setBudget('standard')}>💰💰 Standard</Choice>
        <Choice active={budget === 'generous'} onClick={() => setBudget('generous')}>💰💰💰 Generous</Choice>
      </FormRow>

      <FormRow label="Run cadence">
        <Choice active={cadence === 'weekly'}   onClick={() => setCadence('weekly')}>Weekly</Choice>
        <Choice active={cadence === 'biweekly'} onClick={() => setCadence('biweekly')}>Bi-weekly</Choice>
        <Choice active={cadence === 'monthly'}  onClick={() => setCadence('monthly')}>Monthly</Choice>
      </FormRow>

      {error && <p className="text-hive-rose text-[12px] font-bold">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy || isGuest}
        className="w-full h-12 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[14px] disabled:opacity-50 shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)]"
      >
        {busy ? 'Generating your list…' : '✨ Generate my list'}
      </button>

      <p className="text-[10px] text-hive-muted text-center leading-relaxed">
        We'll create the list right away — you can edit any item before sending it to a supplier.
      </p>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.2px] text-hive-muted mb-1.5">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Choice({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-hive-pill text-[12px] font-nunito font-extrabold border whitespace-nowrap transition-colors ${
        active
          ? 'bg-pantry-leaf text-white border-pantry-leaf shadow-sm'
          : 'border-hive-line bg-hive-paper text-hive-muted hover:border-pantry-leaf/50'
      }`}
    >
      {children}
    </button>
  );
}

// ── Blank-start ───────────────────────────────────────────────────

function BlankStartCard({
  familyId, isGuest, onCreated,
}: {
  familyId: string;
  isGuest: boolean;
  onCreated: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    if (!familyId || isGuest) {
      setError('Sign in first to create a list.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const id = await createList(familyId, {
        name: thisWeekLabel(),
        weekOf: thisWeekKey(),
      }, 'blank-start');
      onCreated(id);
    } catch (e: any) {
      setError(e?.message || 'Could not start a blank list.');
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 bg-hive-paper border-2 border-pantry-leaf rounded-hive-lg p-5 text-center">
      <p className="text-3xl mb-1">✏️</p>
      <p className="font-nunito font-extrabold text-[14px]">Start with an empty list</p>
      <p className="text-[12px] text-hive-muted mt-1 mb-4">
        You'll add items one at a time on the list page.
      </p>
      {error && <p className="text-hive-rose text-[12px] font-bold mb-2">{error}</p>}
      <button
        type="button"
        onClick={start}
        disabled={busy || isGuest}
        className="w-full h-12 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[13px] disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Open a blank list →'}
      </button>
    </div>
  );
}
