'use client';

// /pantry/utilities — Recurring household bills + helper salaries.
// Power, water, internet, TV, security, rent… plus a row per helper
// salary. Full CRUD: add, edit (inline), delete. Each row carries an
// amount, a cadence, an optional due-day, account reference and a
// preferred supplier. The monthly roll-up here is the figure that —
// alongside staples — feeds the unified Budget surface.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { usePantry } from '@/contexts/PantryContext';
import { useHive } from '@/contexts/HiveContext';
import {
  UTILITY_CATEGORIES, UtilityCategory, Cadence,
  addUtility, updateUtility, deleteUtility,
  monthlyEquivalentCents, sumMonthlyUtilities,
  Utility, Supplier,
} from '@/lib/pantry';
import { formatCents } from '@/components/pantry/format';
import SupplierBadge from '@/components/pantry/SupplierBadge';
import NumberInput from '@/components/ui/NumberInput';
import BackButton from '@/components/ui/BackButton';

type Filter = 'all' | UtilityCategory;

const CADENCES: { id: Cadence; label: string }[] = [
  { id: 'monthly',   label: 'Monthly' },
  { id: 'weekly',    label: 'Weekly' },
  { id: 'biweekly',  label: '2x / wk' },
  { id: 'daily',     label: 'Daily' },
  { id: 'as-needed', label: 'As needed' },
];

export default function UtilitiesPage() {
  const { profile, isGuest } = useAuth();
  const { utilities, suppliers } = usePantry();
  const { config } = useHive();
  const currency = config.currency;

  const [filter, setFilter] = useState<Filter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const visible = useMemo(
    () => (filter === 'all' ? utilities : utilities.filter((u) => u.category === filter)),
    [utilities, filter],
  );

  const monthlyTotal = useMemo(() => sumMonthlyUtilities(utilities), [utilities]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">Pantry · Utilities</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">Bills &amp; salaries 🧾</h1>
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

      {/* Monthly roll-up — the number that flows into the Budget. */}
      <div className="bg-gradient-to-br from-pantry-leaf-soft to-white border border-pantry-leaf rounded-hive-lg p-4 mb-4">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk">
          Recurring this month
        </p>
        <p className="font-nunito font-black text-3xl mt-0.5">
          {formatCents(monthlyTotal, currency)}
        </p>
        <p className="text-[11px] text-hive-muted mt-1">
          {utilities.length} bill{utilities.length === 1 ? '' : 's'} &amp; salar{utilities.length === 1 ? 'y' : 'ies'} tracked
          {' '}· non-monthly cadences are normalised to a monthly figure.
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
        {UTILITY_CATEGORIES.map((c) => (
          <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
            {c.emoji} {c.label}
          </Chip>
        ))}
      </div>

      {/* Add form (collapsible) */}
      {adding && (
        <UtilityForm
          familyId={profile?.familyId || ''}
          suppliers={suppliers}
          currency={currency}
          onDone={() => setAdding(false)}
        />
      )}

      {/* List */}
      {visible.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <div className="text-4xl mb-2">🧾</div>
          <p className="font-nunito font-extrabold text-[14px]">Nothing here yet</p>
          <p className="text-[12px] text-hive-muted mt-1">
            {filter === 'all'
              ? 'Add your recurring bills — power, water, internet, TV, security — and a row per helper salary.'
              : 'No entries in this category. Tap + Add to add one.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((u) => (
            <UtilityRow
              key={u.id}
              utility={u}
              suppliers={suppliers}
              currency={currency}
              editing={editingId === u.id}
              onEditToggle={() => setEditingId((id) => (id === u.id ? null : u.id))}
              familyId={profile?.familyId || ''}
              isGuest={isGuest}
            />
          ))}
        </div>
      )}

      {/* Bridge note → Budget */}
      <div className="rounded-hive border border-dashed border-pantry-leaf bg-gradient-to-br from-pantry-leaf-soft to-white p-4 mt-5 mb-2">
        <p className="font-nunito font-extrabold text-[12px] text-pantry-leaf-dk">💰 Flows into the Budget</p>
        <p className="text-[11px] text-hive-muted leading-relaxed mt-1">
          Utilities sit beside <strong>Staples</strong> in the Pantry. When the unified{' '}
          <Link href="/pantry/budget" className="text-pantry-leaf-dk font-bold hover:underline">Budget</Link>{' '}
          ships, this monthly total joins the weekly grocery spend so the whole household run is one number.
        </p>
      </div>

      <p className="text-center text-[11px] text-hive-muted mt-4 leading-relaxed">
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

function UtilityRow({
  utility, suppliers, currency, editing, onEditToggle, familyId, isGuest,
}: {
  utility: Utility;
  suppliers: Supplier[];
  currency: string;
  editing: boolean;
  onEditToggle: () => void;
  familyId: string;
  isGuest: boolean;
}) {
  const supplier = utility.preferredSupplierId
    ? suppliers.find((s) => s.id === utility.preferredSupplierId)
    : undefined;
  const cat = UTILITY_CATEGORIES.find((c) => c.id === utility.category);
  const cadence = CADENCES.find((c) => c.id === utility.cadence);
  const monthly = monthlyEquivalentCents(utility.amountCents || 0, utility.cadence);

  if (editing) {
    return (
      <UtilityForm
        familyId={familyId}
        suppliers={suppliers}
        currency={currency}
        existing={utility}
        onDone={onEditToggle}
        onDelete={async () => {
          if (isGuest) return;
          if (!confirm(`Delete "${utility.name}" from utilities?`)) return;
          await deleteUtility(familyId, utility.id);
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
        <p className="font-nunito font-extrabold text-[14px] truncate">{utility.name}</p>
        <p className="text-[11px] text-hive-muted truncate flex items-baseline gap-1 flex-wrap">
          <span className="text-pantry-leaf-dk font-nunito font-extrabold">
            {utility.amountCents > 0 ? formatCents(utility.amountCents, currency) : 'No amount'}
          </span>
          <span>· {cadence?.label || utility.cadence}</span>
          {utility.cadence !== 'monthly' && utility.amountCents > 0 && (
            <span>· ≈ {formatCents(monthly, currency)}/mo</span>
          )}
          {utility.dueDay > 0 && <span>· due {ordinal(utility.dueDay)}</span>}
        </p>
        {utility.accountRef && (
          <p className="text-[10px] text-hive-muted truncate mt-0.5">Ref: {utility.accountRef}</p>
        )}
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

function UtilityForm({
  familyId, suppliers, currency, existing, onDone, onDelete,
}: {
  familyId: string;
  suppliers: Supplier[];
  currency: string;
  existing?: Utility;
  onDone: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(existing?.name || '');
  const [category, setCategory] = useState<UtilityCategory>(existing?.category || 'power');
  const [amountMajor, setAmountMajor] = useState<number>(
    existing?.amountCents ? existing.amountCents / 100 : 0,
  );
  const [cadence, setCadence] = useState<Cadence>(existing?.cadence || 'monthly');
  const [dueDay, setDueDay] = useState<number>(existing?.dueDay || 0);
  const [accountRef, setAccountRef] = useState(existing?.accountRef || '');
  const [supplierId, setSupplierId] = useState<string>(existing?.preferredSupplierId || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isSalary = category === 'salary';

  const submit = async () => {
    setError('');
    if (!name.trim()) { setError('Pick a name.'); return; }
    setSaving(true);
    try {
      // Empty optionals are stored as 0 / '' (never undefined) so the
      // Firestore client write never trips on an unsupported value.
      const payload = {
        name: name.trim(),
        category,
        amountCents: amountMajor > 0 ? Math.round(amountMajor * 100) : 0,
        cadence,
        dueDay: dueDay > 0 ? Math.min(31, Math.round(dueDay)) : 0,
        accountRef: accountRef.trim(),
        preferredSupplierId: supplierId,
        notes: notes.trim(),
        active: true,
      };
      if (existing) {
        await updateUtility(familyId, existing.id, payload);
      } else {
        await addUtility(familyId, payload);
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
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
          {isSalary ? 'Helper name / role' : 'Bill name'}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isSalary ? 'e.g. Mama Asha — house help' : 'e.g. Power (TANESCO)'}
          maxLength={80}
          autoFocus
          className="w-full mt-1 h-11 px-3 bg-hive-cream rounded-[12px] text-[15px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted block mb-1.5">Category</label>
        <div className="flex flex-wrap gap-1.5">
          {UTILITY_CATEGORIES.map((c) => {
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

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
          {isSalary ? 'Salary amount' : 'Bill amount'}
        </label>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="font-nunito font-black text-base text-hive-muted">{currency === 'USD' ? '$' : currency}</span>
          <NumberInput
            value={amountMajor}
            onChange={setAmountMajor}
            allowDecimal
            min={0}
            ariaLabel="Amount"
            placeholder="0"
            className="flex-1 h-10 px-3 bg-hive-cream rounded-[12px] font-nunito font-black text-base border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
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

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1">
          <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Due day</label>
          <NumberInput
            value={dueDay}
            onChange={setDueDay}
            min={0}
            max={31}
            ariaLabel="Day of month the bill is due"
            placeholder="—"
            className="w-full mt-1 h-10 px-3 bg-hive-cream rounded-[12px] text-center font-nunito font-black text-base border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
            {isSalary ? 'Reference (optional)' : 'Account / meter no. (optional)'}
          </label>
          <input
            value={accountRef}
            onChange={(e) => setAccountRef(e.target.value)}
            placeholder={isSalary ? 'e.g. payroll note' : 'e.g. meter 0123456789'}
            maxLength={60}
            className="w-full mt-1 h-10 px-3 bg-hive-cream rounded-[12px] text-[13px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
          {isSalary ? 'Paid via (optional)' : 'Preferred supplier (optional)'}
        </label>
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
            <Link href="/pantry/suppliers" className="text-pantry-leaf-dk font-bold hover:underline">Add a supplier</Link> first to link a provider.
          </p>
        )}
      </div>

      <div>
        <label className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Notes (optional)</label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={isSalary ? 'Paid end of month · cash' : 'Prepaid · top up at the kiosk'}
          maxLength={200}
          className="w-full mt-1 h-10 px-3 bg-hive-cream rounded-[12px] text-[12px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
      </div>

      {error && <p className="text-hive-rose text-[12px] font-bold">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={submit}
          disabled={saving}
          className="flex-1 h-11 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[13px] disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Add entry'}
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

// ── Helpers ───────────────────────────────────────────────────────

/** "1st", "2nd", "23rd" — for the due-day label on a row. */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
