'use client';

// /pantry/list/[id] — the active shopping run. Items grouped by
// supplier; each group gets its own one-tap "Send to … on WhatsApp"
// button. Inline qty + price editing, swipe-to-delete via a small ✕
// button per row. Add-row appears at the bottom with autocomplete from
// staples.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { usePantry } from '@/contexts/PantryContext';
import { useHive } from '@/contexts/HiveContext';
import {
  GroceryList, GroceryListItem, Supplier,
  STAPLE_CATEGORIES, StapleCategory,
  subscribeToList, setListItems, closeList,
  upsertItem, removeItem, toggleItemDone, groupBySupplier,
  cryptoId,
} from '@/lib/pantry';
import { formatCents } from '@/components/pantry/format';
import WhatsAppSendButton from '@/components/pantry/WhatsAppSendButton';
import NumberInput from '@/components/ui/NumberInput';
import BackButton from '@/components/ui/BackButton';

export default function ListPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const listId = params?.id;
  const { profile, isGuest } = useAuth();
  const { family } = useFamily();
  const { sokoSuppliers, staples } = usePantry();
  const { config } = useHive();
  const currency = config.currency;

  const [list, setList] = useState<GroceryList | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!profile?.familyId || !listId) return;
    const unsub = subscribeToList(profile.familyId, listId, (l) => {
      setList(l);
      setLoading(false);
    });
    return unsub;
  }, [profile?.familyId, listId]);

  const items = list?.items || [];
  const groups = useMemo(() => groupBySupplier(items, sokoSuppliers), [items, sokoSuppliers]);
  const doneCount = items.filter((i) => i.done).length;

  // Persist any change to items by writing the full array (lists are
  // small enough that this is fine, and the read-side gets a single
  // snapshot on every save).
  const persist = async (next: GroceryListItem[]) => {
    if (!profile?.familyId || !listId || isGuest) return;
    await setListItems(profile.familyId, listId, next);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center text-hive-muted text-sm">Loading…</div>
    );
  }
  if (!list) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <p className="font-nunito font-extrabold text-base">List not found</p>
        <p className="text-hive-muted text-sm mt-2">It may have been closed or deleted.</p>
        <Link href="/pantry" className="inline-block mt-4 px-4 py-2 rounded-hive-pill bg-pantry-leaf text-white font-nunito font-extrabold text-[12px] no-underline">← Back to Pantry</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">Pantry · List</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">{list.name} 📝</h1>
      </div>

      {/* Status strip */}
      <div className="rounded-hive bg-pantry-leaf-soft px-4 py-3 mb-3 flex items-baseline justify-between">
        <span className="font-nunito font-extrabold text-[13px] text-pantry-leaf-dk">
          {items.length} item{items.length === 1 ? '' : 's'} · {doneCount} done
        </span>
        <span className="font-nunito font-black text-[15px] text-pantry-leaf-dk">
          ~ {formatCents(list.estimatedTotalCents, currency)}
        </span>
      </div>

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <div className="text-4xl mb-2">📝</div>
          <p className="font-nunito font-extrabold text-[14px]">Empty list</p>
          <p className="text-[12px] text-hive-muted mt-1 mb-4">
            Add items below or seed from staples.
          </p>
          <Link href="/pantry/staples" className="inline-block px-4 py-2 rounded-hive-pill bg-pantry-leaf text-white font-nunito font-extrabold text-[12px] no-underline">
            Open staples →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <SupplierGroupCard
              key={g.supplierId || 'unassigned'}
              group={g}
              items={items}
              currency={currency}
              familyName={family?.name}
              onChange={persist}
              onToggleDone={(itemId) => persist(toggleItemDone(items, itemId))}
              onRemove={(itemId) => persist(removeItem(items, itemId))}
              suppliers={sokoSuppliers}
              isGuest={isGuest}
            />
          ))}
        </div>
      )}

      {/* Add row */}
      {!isGuest && (
        adding ? (
          <AddItemForm
            staples={staples}
            suppliers={sokoSuppliers}
            currency={currency}
            onAdd={async (newItem) => {
              await persist([...items, newItem]);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full mt-3 py-3 rounded-hive border-2 border-dashed border-pantry-leaf/60 text-pantry-leaf-dk font-nunito font-extrabold text-[13px] hover:bg-pantry-leaf-soft/50 transition-colors"
          >
            + Add an item
          </button>
        )
      )}

      {/* Close-list footer */}
      {items.length > 0 && !isGuest && (
        <div className="mt-6 mb-2">
          <button
            onClick={async () => {
              if (!profile?.familyId || !listId) return;
              if (!confirm('Close this list? You can still see it in history.')) return;
              await closeList(profile.familyId, listId);
              router.push('/pantry');
            }}
            className="w-full h-11 rounded-hive-pill border border-hive-line bg-hive-paper text-hive-muted font-nunito font-extrabold text-[12px]"
          >
            Close this run
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function SupplierGroupCard({
  group, items, currency, familyName, onChange, onToggleDone, onRemove, suppliers, isGuest,
}: {
  group: import('@/lib/pantry').SupplierGroup;
  items: GroceryListItem[];
  currency: string;
  familyName?: string;
  onChange: (next: GroceryListItem[]) => void;
  onToggleDone: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  suppliers: Supplier[];
  isGuest: boolean;
}) {
  const supplier = group.supplier;
  const initial = supplier?.name?.[0]?.toUpperCase() || '?';
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-[10px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center font-nunito font-black">
          {supplier ? initial : '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-nunito font-extrabold text-[13px] truncate">
            {supplier?.name || 'Unassigned'}
          </p>
          <p className="text-[10px] text-hive-muted">
            {group.items.length} item{group.items.length === 1 ? '' : 's'} · ~ {formatCents(group.estimatedCents, currency)}
          </p>
        </div>
      </div>

      <div>
        {group.items.map((it) => (
          <ListRow
            key={it.id}
            item={it}
            onToggleDone={() => onToggleDone(it.id)}
            onRemove={() => onRemove(it.id)}
            onChange={(patch) => onChange(items.map((i) => (i.id === it.id ? { ...i, ...patch } : i)))}
            currency={currency}
            suppliers={suppliers}
            isGuest={isGuest}
          />
        ))}
      </div>

      {supplier && (
        <div className="mt-3">
          <WhatsAppSendButton
            supplier={supplier}
            items={group.items}
            familyName={familyName}
          />
        </div>
      )}
      {!supplier && group.items.some((i) => !i.done) && (
        <p className="text-[11px] text-hive-muted text-center mt-3 italic">
          Tag these items with a supplier to enable WhatsApp send.
        </p>
      )}
    </div>
  );
}

function ListRow({
  item, currency, suppliers, onToggleDone, onRemove, onChange, isGuest,
}: {
  item: GroceryListItem;
  currency: string;
  suppliers: Supplier[];
  onToggleDone: () => void;
  onRemove: () => void;
  onChange: (patch: Partial<GroceryListItem>) => void;
  isGuest: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hive-line last:border-b-0 py-2">
      <div className="flex items-center gap-2.5">
        <button
          onClick={onToggleDone}
          aria-label={item.done ? 'Mark not bought' : 'Mark bought'}
          disabled={isGuest}
          className={`w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center text-[12px] font-black transition-colors ${
            item.done
              ? 'bg-pantry-leaf border-pantry-leaf text-white'
              : 'border-hive-line bg-white text-transparent hover:border-pantry-leaf'
          }`}
        >
          {item.done ? '✓' : ''}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`font-nunito font-extrabold text-[13px] truncate ${item.done ? 'line-through text-hive-muted' : ''}`}>
            {item.name}
            {item.preferredBrands && item.preferredBrands.length > 0 && !item.done && (
              <span className="ml-1.5 text-[10px] font-bold text-pantry-leaf-dk">
                · {item.preferredBrands.slice(0, 2).join(' / ')}
              </span>
            )}
          </p>
          <p className="text-[10px] text-hive-muted truncate">
            {item.qty}{item.unit ? ` ${item.unit}` : ''}
            {typeof item.estimatedCents === 'number' && item.estimatedCents > 0 && (
              <> · {formatCents(item.estimatedCents, currency)}</>
            )}
          </p>
        </div>
        {!isGuest && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[10px] font-nunito font-extrabold text-hive-muted hover:text-pantry-leaf-dk shrink-0"
          >
            {open ? 'Close' : 'Edit'}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 pl-8 grid grid-cols-12 gap-2">
          <input
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="col-span-12 h-9 px-3 bg-hive-cream rounded-[10px] text-[12px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
            placeholder="Item name"
          />
          <div className="col-span-3">
            <NumberInput
              value={item.qty}
              onChange={(n) => onChange({ qty: Math.max(1, Math.round(n)) })}
              min={1}
              ariaLabel="Quantity"
              className="w-full h-9 px-2 bg-hive-cream rounded-[10px] text-center font-nunito font-extrabold text-[12px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
            />
          </div>
          <input
            value={item.unit || ''}
            onChange={(e) => onChange({ unit: e.target.value })}
            placeholder="kg"
            className="col-span-3 h-9 px-2 bg-hive-cream rounded-[10px] text-center text-[12px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
          <div className="col-span-6 flex items-center gap-1">
            <span className="text-[11px] text-hive-muted font-bold">
              {currency === 'USD' ? '$' : currency}
            </span>
            <NumberInput
              value={(item.estimatedCents || 0) / 100}
              onChange={(n) => onChange({ estimatedCents: n > 0 ? Math.round(n * 100) : undefined })}
              allowDecimal
              min={0}
              ariaLabel="Estimated cost"
              placeholder="0"
              className="flex-1 h-9 px-2 bg-hive-cream rounded-[10px] font-nunito font-extrabold text-[12px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
            />
          </div>
          <select
            value={item.supplierId || ''}
            onChange={(e) => onChange({ supplierId: e.target.value || undefined })}
            className="col-span-12 h-9 px-2 bg-hive-cream rounded-[10px] font-nunito font-extrabold text-[12px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          >
            <option value="">— no supplier —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={onRemove}
            className="col-span-12 h-9 rounded-hive-pill bg-[#FCEAEA] text-hive-rose font-nunito font-extrabold text-[11px]"
          >
            Remove from list
          </button>
        </div>
      )}
    </div>
  );
}

function AddItemForm({
  staples, suppliers, currency, onAdd, onCancel,
}: {
  staples: import('@/lib/pantry').Staple[];
  suppliers: Supplier[];
  currency: string;
  onAdd: (item: GroceryListItem) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState<number>(1);
  const [unit, setUnit] = useState('');
  const [estimatedMajor, setEstimatedMajor] = useState<number>(0);
  const [supplierId, setSupplierId] = useState<string>('');
  const [category, setCategory] = useState<StapleCategory | ''>('');
  // Brand preferences carry over from the picked staple. We snapshot
  // them here so the parent can still tweak before submitting.
  const [brands, setBrands] = useState<string[]>([]);
  const [stapleId, setStapleId] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  // Quick-pick staple suggestions filter as the parent types.
  const matches = useMemo(() => {
    if (!name.trim()) return [];
    const q = name.trim().toLowerCase();
    return staples.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 3);
  }, [name, staples]);

  const useStaple = (s: import('@/lib/pantry').Staple) => {
    setName(s.name);
    setQty(s.defaultQty);
    setUnit(s.unit || '');
    setEstimatedMajor((s.lastBoughtCents || 0) / 100);
    setSupplierId(s.preferredSupplierId || '');
    setCategory(s.category);
    setBrands(s.preferredBrands ? [...s.preferredBrands] : []);
    setStapleId(s.id);
  };

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    await onAdd({
      id: cryptoId(),
      name: name.trim(),
      qty,
      unit: unit.trim(),
      estimatedCents: estimatedMajor > 0 ? Math.round(estimatedMajor * 100) : undefined,
      supplierId: supplierId || undefined,
      category: category || undefined,
      preferredBrands: brands.length > 0 ? brands : undefined,
      stapleId,
      done: false,
    });
    setSubmitting(false);
  };

  return (
    <div className="mt-3 bg-hive-paper border-2 border-pantry-leaf rounded-hive-lg p-4 space-y-3">
      <div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Item name (e.g. Spinach)"
          autoFocus
          className="w-full h-11 px-3 bg-hive-cream rounded-[12px] text-[14px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
        {matches.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {matches.map((s) => (
              <button
                key={s.id}
                onClick={() => useStaple(s)}
                className="px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border border-pantry-leaf/40 bg-pantry-leaf-soft text-pantry-leaf-dk hover:brightness-105"
              >
                {s.name}{s.unit ? ` · ${s.defaultQty}${s.unit}` : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-3">
          <NumberInput
            value={qty}
            onChange={(n) => setQty(Math.max(1, Math.round(n)))}
            min={1}
            ariaLabel="Quantity"
            className="w-full h-10 px-2 bg-hive-cream rounded-[12px] text-center font-nunito font-black text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </div>
        <input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="kg"
          className="col-span-3 h-10 px-2 bg-hive-cream rounded-[12px] text-center text-[12px] font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
        />
        <div className="col-span-6 flex items-center gap-1">
          <span className="text-[11px] text-hive-muted font-bold">
            {currency === 'USD' ? '$' : currency}
          </span>
          <NumberInput
            value={estimatedMajor}
            onChange={setEstimatedMajor}
            allowDecimal
            min={0}
            ariaLabel="Estimated cost"
            placeholder="0"
            className="flex-1 h-10 px-2 bg-hive-cream rounded-[12px] font-nunito font-extrabold text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
          />
        </div>
      </div>

      <select
        value={supplierId}
        onChange={(e) => setSupplierId(e.target.value)}
        className="w-full h-10 px-2 bg-hive-cream rounded-[12px] font-nunito font-extrabold text-[12px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
      >
        <option value="">— no supplier —</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      <div className="flex gap-2 pt-1">
        <button
          onClick={submit}
          disabled={!name.trim() || submitting}
          className="flex-1 h-11 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-[13px] disabled:opacity-40 transition-colors"
        >
          {submitting ? 'Adding…' : 'Add to list'}
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          className="h-11 px-4 rounded-hive-pill bg-hive-line text-hive-muted font-nunito font-extrabold text-[12px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
