'use client';

// /pantry/staples — Master list of recurring household items. Phase 1A
// is full CRUD: add, edit (inline), delete. Items are filtered by
// category chips and grouped under their category in the list.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { usePantry } from '@/contexts/PantryContext';
import { useHive } from '@/contexts/HiveContext';
import {
  STAPLE_CATEGORIES, StapleCategory, Cadence,
  STAPLE_UNITS, MAX_PREFERRED_BRANDS,
  addStaple, updateStaple, deleteStaple,
  Staple,
} from '@/lib/pantry';
import { suggestStaples } from '@/lib/pantryStapleSuggestions';
import { formatCents } from '@/components/pantry/format';
import SupplierBadge from '@/components/pantry/SupplierBadge';
import NumberInput from '@/components/ui/NumberInput';
import BackButton from '@/components/ui/BackButton';

type Filter = 'all' | StapleCategory;

const CADENCES: { id: Cadence; label: string }[] = [
  { id: 'daily',     label: 'Daily' },
  { id: 'weekly',    label: 'Weekly' },
  { id: 'biweekly',  label: '2x / wk' },
  { id: 'monthly',   label: 'Monthly' },
  { id: 'as-needed', label: 'As needed' },
];

export default function StaplesPage() {
  const { profile, isGuest } = useAuth();
  const { staples, sokoSuppliers } = usePantry();
  const { config } = useHive();
  const currency = config.currency;

  const [filter, setFilter] = useState<Filter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const visible = useMemo(
    () => filter === 'all' ? staples : staples.filter((s) => s.category === filter),
    [staples, filter],
  );

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">Pantry · Staples</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">What we always need 📦</h1>
        </div>
        {!isGuest && (
          <button
            onClick={() => { setAdding((v) => !v); setEditingId(null); }}
            className="h-10 px-4 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-extrabold text-[12px] shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)]"
          >
            {adding ? 'Close' : '+ Add'}
          </button>
        )}
      </div>

      {/* Quick-add helpers — AI starter + browse Directory */}
      {!isGuest && (
        <div className="flex gap-2 mb-3">
          <Link
            href="/pantry/onboard"
            className="flex-1 h-10 px-3 rounded-hive border border-pantry-leaf bg-pantry-leaf-soft/40 text-pantry-leaf-dk font-nunito font-extrabold text-[12px] flex items-center justify-center gap-1 no-underline hover:bg-pantry-leaf-soft transition-colors"
          >
            ✨ AI starter
          </Link>
          <Link
            href="/pantry/directory"
            className="flex-1 h-10 px-3 rounded-hive border border-hive-line bg-hive-paper text-hive-muted font-nunito font-extrabold text-[12px] flex items-center justify-center gap-1 no-underline hover:border-pantry-leaf transition-colors"
          >
            🧺 Browse Directory
          </Link>
        </div>
      )}

      {/* Filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
        {STAPLE_CATEGORIES.map((c) => (
          <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
            {c.emoji} {c.label}
          </Chip>
        ))}
      </div>

      {/* Add form (collapsible) */}
      {adding && (
        <StapleForm
          familyId={profile?.familyId || ''}
          suppliers={sokoSuppliers}
          currency={currency}
          onDone={() => setAdding(false)}
        />
      )}

      {/* List */}
      {visible.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-6 text-center">
          <div className="text-4xl mb-2">📦</div>
          <p className="font-nunito font-extrabold text-[14px]">No staples here yet</p>
          <p className="text-[12px] text-hive-muted mt-1">
            {filter === 'all'
              ? 'Try the AI starter to seed your list in 30 seconds, or browse the Directory.'
              : 'No staples in this category. Tap + Add or browse the Directory.'}
          </p>
          {filter === 'all' && !isGuest && (
            <div className="flex gap-2 mt-4 justify-center">
              <Link
                href="/pantry/onboard"
                className="px-4 h-10 rounded-hive bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-extrabold text-[12px] no-underline flex items-center"
              >
                ✨ AI starter
              </Link>
              <Link
                href="/pantry/directory"
                className="px-4 h-10 rounded-hive border border-hive-line bg-hive-paper text-hive-muted font-nunito font-extrabold text-[12px] no-underline flex items-center hover:border-pantry-leaf"
              >
                Browse Directory
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((s) => (
            <StapleRow
              key={s.id}
              staple={s}
              suppliers={sokoSuppliers}
              currency={currency}
              editing={editingId === s.id}
              onEditToggle={() => setEditingId((id) => (id === s.id ? null : s.id))}
              familyId={profile?.familyId || ''}
              isGuest={isGuest}
            />
          ))}
        </div>
      )}

      <p className="text-center text-[11px] text-hive-muted mt-6 leading-relaxed">
        Staples seed every weekly list with default qty + last-bought price.{' '}
        <Link href="/pantry" className="text-pantry-leaf-dk font-bold hover:underline">← Back to Pantry</Link>
      </p>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-hive-pill text-[11px] font-nunito font-extrabold border whitespace-nowrap transition-colors ${
        active
          ? 'bg-pantry-leaf text-white border-transparent'
          : 'border-hive-line bg-hive-paper text-hive-muted hover:border-pantry-leaf/50'
      }`}
    >
      {children}
    </button>
  );
}

function StapleRow({
  staple, suppliers, currency, editing, onEditToggle, familyId, isGuest,
}: {
  staple: Staple;
  suppliers: import('@/lib/pantry').Supplier[];
  currency: string;
  editing: boolean;
  onEditToggle: () => void;
  familyId: string;
  isGuest: boolean;
}) {
  const supplier = staple.preferredSupplierId
    ? suppliers.find((s) => s.id === staple.preferredSupplierId)
    : undefined;
  const cat = STAPLE_CATEGORIES.find((c) => c.id === staple.category);
  const cadence = CADENCES.find((c) => c.id === staple.cadence);

  if (editing) {
    return (
      <StapleForm
        familyId={familyId}
        suppliers={suppliers}
        currency={currency}
        existing={staple}
        onDone={onEditToggle}
        onDelete={async () => {
          if (isGuest) return;
          if (!confirm(`Delete "${staple.name}" from staples?`)) return;
          await deleteStaple(familyId, staple.id);
          onEditToggle();
        }}
      />
    );
  }

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-[12px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center text-xl shrink-0">
        {cat?.emoji || '✨'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-nunito font-extrabold text-[14px] truncate">
          {staple.name}
          {staple.preferredBrands && staple.preferredBrands.length > 0 && (
            <span className="ml-1.5 text-[11px] font-bold text-pantry-leaf-dk">
              · {staple.preferredBrands.slice(0, 2).join(' · ')}
              {staple.preferredBrands.length > 2 && ` · +${staple.preferredBrands.length - 2}`}
            </span>
          )}
        </p>
        <p className="text-[11px] text-hive-muted truncate">
          {staple.defaultQty}{staple.unit ? ` ${staple.unit}` : ''} · {cadence?.label || staple.cadence}
          {typeof staple.lastBoughtCents === 'number' && (
            <> · <strong className="text-pantry-leaf-dk">{formatCents(staple.lastBoughtCents, currency)}</strong></>
          )}
        </p>
        {supplier && (
          <div className="mt-1"><SupplierBadge supplier={supplier} /></div>
        )}
      </div>
      {!isGuest && (
        <button
          onClick={onEditToggle}
          className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk hover:underline shrink-0"
        >
          Edit
        </button>
      )}
    </div>
  );
}

function StapleForm({
  familyId, suppliers, currency, existing, onDone, onDelete,
}: {
  familyId: string;
  suppliers: import('@/lib/pantry').Supplier[];
  currency: string;
  existing?: Staple;
  onDone: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [category, setCategory] = useState<StapleCategory>(existing?.category || 'pantry');
  const [defaultQty, setDefaultQty] = useState<number>(existing?.defaultQty || 1);
  // The unit is a dropdown choice; if the existing value isn't in the
  // catalog we drop it into a free-text "Other" field.
  const knownUnitIds = STAPLE_UNITS.map((u) => u.id as string);
  const startingUnit = existing?.unit || '';
  const [unitMode, setUnitMode] = useState<'dropdown' | 'other'>(
    startingUnit && !knownUnitIds.includes(startingUnit) ? 'other' : 'dropdown',
  );
  const [unit, setUnit] = useState(startingUnit);
  const [unitOther, setUnitOther] = useState(unitMode === 'other' ? startingUnit : '');
  const [cadence, setCadence] = useState<Cadence>(existing?.cadence || 'weekly');
  const [lastBoughtMajor, setLastBoughtMajor] = useState<number>(
    existing?.lastBoughtCents ? existing.lastBoughtCents / 100 : 0,
  );
  const [supplierId, setSupplierId] = useState<string>(existing?.preferredSupplierId || '');
  // Up to MAX_PREFERRED_BRANDS slots, indexed by preference (1st, 2nd, 3rd).
  const [brands, setBrands] = useState<string[]>(() => {
    const arr: string[] = [];
    for (let i = 0; i < MAX_PREFERRED_BRANDS; i++) {
      arr.push(existing?.preferredBrands?.[i] || '');
    }
    return arr;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Typeahead suggestions from the COMMON_STAPLES dictionary. Only
  // surfaces while typing a new staple (we hide them once the user is
  // editing an existing row to avoid noise).
  const suggestions = useMemo(
    () => existing ? [] : suggestStaples(name, 4),
    [name, existing],
  );
  const applySuggestion = (s: ReturnType<typeof suggestStaples>[number]) => {
    setName(s.label);
    setCategory(s.category);
    setDefaultQty(s.defaultQty);
    if (knownUnitIds.includes(s.unit)) {
      setUnitMode('dropdown');
      setUnit(s.unit);
      setUnitOther('');
    } else {
      setUnitMode('other');
      setUnit(s.unit);
      setUnitOther(s.unit);
    }
    setCadence(s.cadence);
  };

  const submit = async () => {
    setError('');
    if (!name.trim()) { setError('Pick a name.'); return; }
    if (defaultQty <= 0) { setError('Default quantity must be at least 1.'); return; }
    setSaving(true);
    try {
      const finalUnit = unitMode === 'other' ? unitOther.trim() : unit;
      const cleanedBrands = brands.map((b) => b.trim()).filter((b) => b.length > 0);
      const payload = {
        name: name.trim(),
        category,
        defaultQty: Math.round(defaultQty),
        unit: finalUnit,
        cadence,
        lastBoughtCents: lastBoughtMajor > 0 ? Math.round(lastBoughtMajor * 100) : undefined,
        preferredSupplierId: supplierId || undefined,
        preferredBrands: cleanedBrands.length > 0 ? cleanedBrands : undefined,
        active: true,
      };
      if (existing) {
        await updateStaple(familyId, existing.id, payload);
      } else {
        await addStaple(familyId, payload);
      }
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    }
    setSaving(false);
  };

  return (
    <div className="bg-hive-paper border-2 border-pantry-leaf rounded-hive-lg p-4 mb-3 space-y-3">
      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Item name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Start typing — e.g. ri… → Rice"
          maxLength={60}
          autoFocus
          className="w-full mt-1 h-11 px-3 bg-hive-cream rounded-[12px] text-[15px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
        {suggestions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => applySuggestion(s)}
                className="px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border border-pantry-leaf/40 bg-pantry-leaf-soft text-pantry-leaf-dk hover:brightness-105"
              >
                {s.emoji} {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted block mb-1.5">Category</label>
        <div className="flex flex-wrap gap-1.5">
          {STAPLE_CATEGORIES.map((c) => {
            const sel = category === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={`px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border transition-colors ${
                  sel ? 'bg-pantry-leaf text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                }`}
              >
                {c.emoji} {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1">
          <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Qty</label>
          <NumberInput
            value={defaultQty}
            onChange={setDefaultQty}
            min={1}
            ariaLabel="Default quantity"
            className="w-full mt-1 h-10 px-3 bg-hive-cream rounded-[12px] text-center font-nunito font-black text-base border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Unit</label>
          {unitMode === 'dropdown' ? (
            <select
              value={unit}
              onChange={(e) => {
                if (e.target.value === '__other__') {
                  setUnitMode('other');
                  setUnitOther('');
                  setUnit('');
                } else {
                  setUnit(e.target.value);
                }
              }}
              className="w-full mt-1 h-10 px-2 bg-hive-cream rounded-[12px] font-nunito font-extrabold text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
            >
              <option value="">— pick a unit —</option>
              {STAPLE_UNITS.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
              <option value="__other__">Other (custom)…</option>
            </select>
          ) : (
            <div className="flex gap-1.5">
              <input
                value={unitOther}
                onChange={(e) => { setUnitOther(e.target.value); setUnit(e.target.value); }}
                placeholder="Custom unit"
                maxLength={20}
                autoFocus
                className="flex-1 mt-1 h-10 px-3 bg-hive-cream rounded-[12px] text-[13px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
              />
              <button
                type="button"
                onClick={() => { setUnitMode('dropdown'); setUnit(''); setUnitOther(''); }}
                className="mt-1 h-10 px-3 rounded-hive-pill bg-hive-line text-hive-muted font-nunito font-extrabold text-[11px]"
              >
                ↩
              </button>
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted block mb-1.5">Cadence</label>
        <div className="flex flex-wrap gap-1.5">
          {CADENCES.map((c) => {
            const sel = cadence === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCadence(c.id)}
                className={`px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border transition-colors ${
                  sel ? 'bg-pantry-leaf text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Last-bought price (optional)</label>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="font-nunito font-black text-base text-hive-muted">{currency === 'USD' ? '$' : currency}</span>
          <NumberInput
            value={lastBoughtMajor}
            onChange={setLastBoughtMajor}
            allowDecimal
            min={0}
            ariaLabel="Last-bought price"
            placeholder="0"
            className="flex-1 h-10 px-3 bg-hive-cream rounded-[12px] font-nunito font-black text-base border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
          Preferred brands (optional · up to {MAX_PREFERRED_BRANDS})
        </label>
        <p className="text-[10px] text-hive-muted mt-1">
          Listed on the active list and in the WhatsApp message —
          &quot;Rice (Pishori or Daawat) — 2kg&quot;.
        </p>
        <div className="mt-2 space-y-1.5">
          {brands.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-[8px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center text-[11px] font-nunito font-black shrink-0">
                {i + 1}
              </span>
              <input
                value={b}
                onChange={(e) => {
                  const next = [...brands];
                  next[i] = e.target.value;
                  setBrands(next);
                }}
                placeholder={i === 0 ? '1st choice — e.g. Pishori' : i === 1 ? '2nd choice (optional)' : '3rd choice (optional)'}
                maxLength={40}
                className="flex-1 h-9 px-3 bg-hive-cream rounded-[10px] text-[13px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Preferred supplier (optional)</label>
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="w-full mt-1 h-10 px-2 bg-hive-cream rounded-[12px] font-nunito font-extrabold text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        >
          <option value="">— none —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {suppliers.length === 0 && (
          <p className="mt-1 text-[10px] text-hive-muted">
            <Link href="/pantry/suppliers" className="text-pantry-leaf-dk font-bold hover:underline">Add a supplier</Link> first to tag staples.
          </p>
        )}
      </div>

      {error && <p className="text-hive-rose text-[12px] font-bold">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={submit}
          disabled={saving}
          className="flex-1 h-11 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[13px] disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Add staple'}
        </button>
        <button
          onClick={onDone}
          disabled={saving}
          className="h-11 px-4 rounded-hive-pill bg-hive-line text-hive-muted font-nunito font-extrabold text-[12px]"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={saving}
            className="h-11 px-3 rounded-hive-pill bg-[#FCEAEA] text-hive-rose font-nunito font-extrabold text-[11px]"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
