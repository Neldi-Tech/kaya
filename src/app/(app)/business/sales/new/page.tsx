'use client';

// Log a Sale — multi-item sale form.
// Buyer name + type, line items (with price list autocomplete), cash
// destination toggle, auto-calculated total, then submit → pending approval.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { submitSale } from '@/lib/business';
import type { SaleType } from '@/lib/business';
import type { CashDestination } from '@/lib/hive';
import { formatCash } from '@/components/hive/format';
import BackButton from '@/components/ui/BackButton';

interface ItemDraft {
  itemName: string;
  emoji: string;
  quantity: string;   // string while editing
  unit: string;
  unitPrice: string;  // string while editing, currency units (not cents)
}

const BLANK_ITEM: ItemDraft = {
  itemName: '', emoji: '', quantity: '1', unit: 'unit', unitPrice: '',
};

function itemTotalCents(item: ItemDraft): number {
  const qty = parseFloat(item.quantity) || 0;
  const price = parseFloat(item.unitPrice) || 0;
  return Math.round(qty * price * 100);
}

export default function NewSalePage() {
  const { profile } = useAuth();
  const { activeKidId, config } = useHive();
  const { priceList } = useBusiness();
  const router = useRouter();
  const cur = config.currency;

  const [saleType, setSaleType]   = useState<SaleType>('family');
  const [buyerName, setBuyerName] = useState('');
  const [items, setItems]         = useState<ItemDraft[]>([{ ...BLANK_ITEM }]);
  const [destination, setDestination] = useState<CashDestination>('on_hand');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const activePriceList = priceList.filter((p) => p.active);

  const totalCents = items.reduce((sum, it) => sum + itemTotalCents(it), 0);

  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  // Auto-fill item from price list selection
  function applyPriceListItem(idx: number, plItemId: string) {
    const plItem = activePriceList.find((p) => p.id === plItemId);
    if (!plItem) return;
    updateItem(idx, {
      itemName: plItem.itemName,
      emoji: plItem.emoji || '',
      unit: plItem.unit,
      unitPrice: String(plItem.unitPriceCents / 100),
    });
  }

  async function submit() {
    if (!profile?.familyId || !activeKidId) return;
    setError('');

    if (!buyerName.trim()) { setError('Who is buying?'); return; }
    if (items.length === 0) { setError('Add at least one item.'); return; }
    for (const it of items) {
      if (!it.itemName.trim()) { setError('Every item needs a name.'); return; }
      const qty = parseFloat(it.quantity);
      if (!Number.isFinite(qty) || qty <= 0) { setError('Quantity must be positive.'); return; }
      const price = parseFloat(it.unitPrice);
      if (!Number.isFinite(price) || price < 0) { setError('Price must be 0 or more.'); return; }
    }
    if (totalCents <= 0) { setError('Sale total must be greater than zero.'); return; }

    setSaving(true);
    try {
      await submitSale(profile.familyId, activeKidId, {
        saleType,
        buyerName: buyerName.trim(),
        items: items.map((it) => ({
          itemName: it.itemName.trim(),
          emoji: it.emoji.trim() || undefined,
          quantity: parseFloat(it.quantity),
          unit: it.unit.trim() || 'unit',
          unitPriceCents: Math.round(parseFloat(it.unitPrice) * 100),
        })),
        cashDestination: destination,
        createdBy: profile.uid,
      });
      router.replace('/business/sales');
    } catch (e: any) {
      setError(e?.message || 'Failed to log sale.');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4 pb-8">
      <div className="mb-4"><BackButton /></div>

      <div className="mb-5">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-green">My Business</p>
        <h1 className="font-nunito font-black text-2xl mt-1">Log a sale 💼</h1>
      </div>

      {/* Sale type */}
      <section className="mb-4">
        <p className="font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-2">Sale type</p>
        <div className="flex gap-2">
          {(['family', 'relative'] as SaleType[]).map((t) => (
            <button
              key={t}
              onClick={() => setSaleType(t)}
              className={`h-9 px-5 rounded-hive-pill font-nunito font-extrabold text-[12px] border transition-colors ${
                saleType === t
                  ? 'border-hive-green bg-hive-green text-white'
                  : 'border-hive-line bg-hive-paper text-hive-navy hover:border-hive-green/50'
              }`}
            >
              {t === 'family' ? '🏠 Family' : '👨‍👩‍👧 Relative'}
            </button>
          ))}
        </div>
      </section>

      {/* Buyer name */}
      <section className="mb-4">
        <label className="block font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-1">
          Sold to
        </label>
        <input
          type="text"
          value={buyerName}
          onChange={(e) => setBuyerName(e.target.value)}
          placeholder="Mum · Dad · Auntie Janet…"
          maxLength={60}
          className="w-full h-11 px-4 bg-hive-paper border border-hive-line rounded-hive text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-green/40 placeholder:text-hive-muted/50"
        />
      </section>

      {/* Items */}
      <section className="mb-4">
        <p className="font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-2">Items sold</p>
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="bg-hive-paper border border-hive-line rounded-hive p-3">
              {/* Price list picker */}
              {activePriceList.length > 0 && (
                <select
                  onChange={(e) => { if (e.target.value) applyPriceListItem(idx, e.target.value); }}
                  defaultValue=""
                  className="w-full h-9 px-3 mb-2 bg-hive-cream border border-hive-line rounded-hive text-[12px] text-hive-muted focus:outline-none"
                >
                  <option value="">— pick from price list —</option>
                  {activePriceList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.emoji ? `${p.emoji} ` : ''}{p.itemName} · {formatCash(p.unitPriceCents, cur)}/{p.unit}
                    </option>
                  ))}
                </select>
              )}

              {/* Item name + emoji */}
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={item.emoji}
                  onChange={(e) => updateItem(idx, { emoji: e.target.value })}
                  placeholder="🌿"
                  maxLength={4}
                  className="w-12 h-10 text-center bg-hive-cream border border-hive-line rounded-hive text-[18px] focus:outline-none focus:ring-2 focus:ring-hive-green/40"
                />
                <input
                  type="text"
                  value={item.itemName}
                  onChange={(e) => updateItem(idx, { itemName: e.target.value })}
                  placeholder="Item name"
                  maxLength={60}
                  className="flex-1 h-10 px-3 bg-hive-cream border border-hive-line rounded-hive text-[13px] focus:outline-none focus:ring-2 focus:ring-hive-green/40 placeholder:text-hive-muted/50"
                />
              </div>

              {/* Qty · unit · price */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[9px] font-bold text-hive-muted uppercase mb-1">Qty</p>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                    placeholder="1"
                    className="w-full h-9 px-2 bg-hive-cream border border-hive-line rounded-hive text-[13px] focus:outline-none focus:ring-2 focus:ring-hive-green/40"
                  />
                </div>
                <div>
                  <p className="text-[9px] font-bold text-hive-muted uppercase mb-1">Unit</p>
                  <input
                    type="text"
                    value={item.unit}
                    onChange={(e) => updateItem(idx, { unit: e.target.value })}
                    placeholder="kg"
                    maxLength={20}
                    className="w-full h-9 px-2 bg-hive-cream border border-hive-line rounded-hive text-[13px] focus:outline-none focus:ring-2 focus:ring-hive-green/40"
                  />
                </div>
                <div>
                  <p className="text-[9px] font-bold text-hive-muted uppercase mb-1">Price ({cur})</p>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(idx, { unitPrice: e.target.value })}
                    placeholder="0"
                    className="w-full h-9 px-2 bg-hive-cream border border-hive-line rounded-hive text-[13px] focus:outline-none focus:ring-2 focus:ring-hive-green/40"
                  />
                </div>
              </div>

              {/* Line total + remove */}
              <div className="flex items-center justify-between mt-2">
                <p className="text-[11px] font-bold text-hive-green">
                  {itemTotalCents(item) > 0 ? formatCash(itemTotalCents(item), cur) : ''}
                </p>
                {items.length > 1 && (
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-[11px] text-hive-rose font-bold hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => setItems((prev) => [...prev, { ...BLANK_ITEM }])}
          className="mt-2 w-full h-10 rounded-hive border-2 border-dashed border-hive-line text-[12px] font-nunito font-extrabold text-hive-muted hover:border-hive-green/50 hover:text-hive-green transition-colors"
        >
          + Add another item
        </button>
      </section>

      {/* Cash destination */}
      <section className="mb-6">
        <p className="font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-2">Where should the money go?</p>
        <div className="flex gap-2">
          {([
            { key: 'on_hand',    label: '👛 On hand',    desc: 'I get it now'  },
            { key: 'on_deposit', label: '🏦 Safekeeping', desc: 'Save it'      },
          ] as { key: CashDestination; label: string; desc: string }[]).map((d) => (
            <button
              key={d.key}
              onClick={() => setDestination(d.key)}
              className={`flex-1 rounded-hive border px-3 py-2 text-left transition-colors ${
                destination === d.key
                  ? 'border-hive-green bg-[#E6F7EE]'
                  : 'border-hive-line bg-hive-paper hover:border-hive-green/50'
              }`}
            >
              <p className="font-nunito font-extrabold text-[12px]">{d.label}</p>
              <p className="text-[10px] text-hive-muted">{d.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Total + submit */}
      <div className="bg-hive-paper border border-hive-line rounded-hive px-4 py-3 flex items-center justify-between mb-4">
        <p className="font-nunito font-extrabold text-[13px]">Total</p>
        <p className="font-nunito font-black text-[22px] text-hive-green">{formatCash(totalCents, cur)}</p>
      </div>

      {error && <p className="text-hive-rose font-bold text-[13px] mb-3">{error}</p>}

      <button
        onClick={submit}
        disabled={saving || totalCents === 0}
        className="w-full bg-hive-green hover:bg-[#2A8553] disabled:opacity-50 text-white rounded-hive py-3.5 font-nunito font-black text-[14px] transition-colors"
      >
        {saving ? 'Sending for approval…' : 'Send to parent for approval →'}
      </button>
      <p className="text-center text-[11px] text-hive-muted mt-2">Your parent will approve and the money lands in your Hive wallet.</p>
    </div>
  );
}
