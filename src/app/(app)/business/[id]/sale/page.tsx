'use client';

// Kaya Business · Log a sale (kid screen 5). Smart entry: pick the product from
// your inventory (price pre-fills from its usual price), set qty + price — with
// "% vs your last price" coaching — pick who bought (family or a relative), and
// the payment method. A paid sale sweeps into the Honey Pot (Treasury) and
// reduces that product's stock. See logSale in business.ts.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, BusinessItem, LedgerEntry, PaymentMethod,
  subscribeToBusiness, subscribeToBusinessItems, subscribeToLedger,
  logSale, lastSaleUnitPriceCents,
} from '@/lib/business';
import { formatCash } from '@/components/hive/format';

const QTY_CHIPS = [1, 2, 3, 5, 10];
const PAY: Array<{ k: PaymentMethod; label: string }> = [
  { k: 'cash', label: 'Cash' },
  { k: 'hive_transfer', label: 'Hive transfer' },
  { k: 'iou', label: 'Owe me (IOU)' },
];

export default function LogSalePage() {
  const params = useParams();
  const router = useRouter();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const { children } = useFamily();
  const { config } = useHive();
  const familyId = profile?.familyId;

  const [business, setBusiness] = useState<Business | null>(null);
  const [items, setItems] = useState<BusinessItem[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [itemId, setItemId] = useState<string>('');
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState('');
  // Customer: a family chip / Mum / Dad, OR "Other" → relative/friend + name.
  const [customer, setCustomer] = useState('');
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherKind, setOtherKind] = useState<'Relative' | 'Friend'>('Relative');
  const [otherName, setOtherName] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!familyId || !businessId) return;
    const u1 = subscribeToBusiness(familyId, businessId, setBusiness);
    const u2 = subscribeToBusinessItems(familyId, businessId, setItems);
    const u3 = subscribeToLedger(familyId, businessId, setLedger, 100);
    return () => { u1(); u2(); u3(); };
  }, [familyId, businessId]);

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === business?.ownerId;
  const canAct = isParent || isOwner;

  const sellable = items.filter((i) => i.kind === 'stock' && !i.loss);
  const selected = sellable.find((i) => i.id === itemId) || null;

  // Pick a product → pre-fill its usual price + unit.
  const selectProduct = (it: BusinessItem) => {
    setItemId(it.id);
    if (typeof it.unitMarketCents === 'number' && it.unitMarketCents > 0) setPrice((it.unitMarketCents / 100).toString());
  };

  const unitCents = useMemo(() => {
    const n = parseFloat(price.replace(/,/g, ''));
    return Number.isNaN(n) ? 0 : Math.round(n * 100);
  }, [price]);
  const totalCents = unitCents * qty;
  const unitLabel = selected?.unitLabel || business?.unitLabel;

  // "% vs your last price" coaching for the selected product.
  const lastPrice = useMemo(() => (itemId ? lastSaleUnitPriceCents(ledger, itemId) : null), [ledger, itemId]);
  const pricePct = lastPrice && lastPrice > 0 && unitCents > 0 ? Math.round(((unitCents - lastPrice) / lastPrice) * 100) : null;

  const customerLabel = otherOpen ? (otherName.trim() ? `${otherName.trim()} (${otherKind})` : otherKind) : customer;

  const submit = async () => {
    if (!familyId || !business || !profile?.uid) return;
    if (!itemId) { setError('Pick what you sold.'); return; }
    if (totalCents <= 0) { setError('Enter a price.'); return; }
    setError(''); setSaving(true);
    try {
      await logSale(familyId, businessId, {
        qty,
        unitPriceCents: unitCents,
        itemId,
        productName: selected?.name,
        customerLabel: customerLabel.trim() || undefined,
        paymentMethod: method,
        description: customerLabel.trim() ? `${selected?.name || 'Sale'} → ${customerLabel.trim()}` : (selected?.name || 'Sale'),
      }, { uid: profile.uid, ownerId: business.ownerId });
      router.push(`/business/${businessId}`);
    } catch (e: any) {
      setError(e?.message || 'Could not save the sale.');
      setSaving(false);
    }
  };

  const label = 'text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5 mt-3';
  const chip = (active: boolean) =>
    `px-3.5 py-2 rounded-hive-pill text-[12.5px] font-nunito font-extrabold border transition ${active ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'}`;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">💵</div>
        <div className="min-w-0">
          <div className="font-nunito font-black text-[16px]">Log a sale</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">{business?.name || 'Loading…'}</div>
        </div>
      </div>

      {!canAct ? (
        <p className="text-hive-muted text-sm text-center py-8">Only the owner or a parent can log sales.</p>
      ) : (
        <>
          <div className={label}>What did you sell?</div>
          {sellable.length === 0 ? (
            <p className="text-[12.5px] text-hive-muted bg-hive-paper border border-hive-line rounded-hive p-3">No products yet — add some in Inventory first.</p>
          ) : (
            <div className="space-y-2">
              {sellable.map((it) => {
                const on = it.id === itemId;
                const out = (it.qty || 0) <= 0;
                return (
                  <button key={it.id} type="button" onClick={() => selectProduct(it)}
                    className={`w-full flex items-center gap-2.5 rounded-hive p-2.5 border text-left transition ${on ? 'border-hive-navy bg-hive-navy text-hive-honey' : 'border-hive-line bg-hive-paper'}`}>
                    {it.photoUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={it.photoUrl} alt="" className="w-9 h-9 rounded-hive object-cover bg-hive-cream shrink-0" />
                      : <span className="w-9 h-9 rounded-hive bg-hive-cream flex items-center justify-center text-[16px] shrink-0">🛒</span>}
                    <span className="flex-1 min-w-0">
                      <span className="block font-nunito font-bold text-[13px] truncate">{it.name}</span>
                      <span className={`block text-[11px] truncate ${on ? 'text-hive-honey-soft/80' : 'text-hive-muted'}`}>
                        {it.qty || 0}{it.unitLabel ? ` ${it.unitLabel}` : ''} in stock
                        {typeof it.unitMarketCents === 'number' && it.unitMarketCents > 0 ? ` · usual ${formatCash(it.unitMarketCents, config.currency)}` : ''}
                        {it.instantStock ? ' · 🌱 instant' : out ? ' · out' : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className={label}>How many{unitLabel ? ` (${unitLabel})` : ''}?</div>
          <div className="flex flex-wrap gap-2">
            {QTY_CHIPS.map((n) => (
              <button key={n} onClick={() => setQty(n)} className={chip(qty === n)}>{n}</button>
            ))}
            <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-16 h-10 px-2 text-center bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
          </div>

          <div className={label}>Price per {unitLabel || 'unit'} ({config.currency})</div>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0"
            className="w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
          {pricePct !== null && (
            pricePct > 0 ? (
              <p className="text-[12px] font-nunito font-bold text-[#2F7D32] mt-1.5">📈 +{pricePct}% above your last price — 🎉 Bravo, great deal!</p>
            ) : pricePct < 0 ? (
              <p className="text-[12px] font-nunito font-bold text-[#B25E16] mt-1.5">📉 {pricePct}% below your last price — try to negotiate a bit more? 🤝</p>
            ) : (
              <p className="text-[12px] font-nunito font-bold text-hive-muted mt-1.5">Same as your last price.</p>
            )
          )}

          <div className="bg-[#F4ECD8] border border-hive-honey/60 rounded-hive p-4 mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between"><span>Quantity</span><span className="font-nunito font-bold">{qty}</span></div>
            <div className="flex justify-between"><span>Unit price</span><span className="font-nunito font-bold">{formatCash(unitCents, config.currency)}</span></div>
            <div className="flex justify-between border-t border-dashed border-black/10 pt-1.5"><span>Total</span><span className="font-nunito font-black text-[#2F7D32]">{formatCash(totalCents, config.currency)}</span></div>
            {method !== 'iou' && (
              <div className="flex justify-between"><span>→ Honey Pot 🍯</span><span className="font-nunito font-extrabold">{formatCash(totalCents, config.currency)}</span></div>
            )}
            {selected && (
              <div className="flex justify-between text-hive-muted text-[11.5px]"><span>{selected.name} stock after</span><span>{selected.qty || 0} → {Math.max(0, (selected.qty || 0) - qty)}</span></div>
            )}
          </div>

          <div className={label}>Who bought?</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setOtherOpen(false); setCustomer('Mum'); }} className={chip(!otherOpen && customer === 'Mum')}>👩 Mum</button>
            <button onClick={() => { setOtherOpen(false); setCustomer('Dad'); }} className={chip(!otherOpen && customer === 'Dad')}>👨 Dad</button>
            {children.filter((c) => c.id !== business?.ownerId).map((c) => (
              <button key={c.id} onClick={() => { setOtherOpen(false); setCustomer(c.name); }} className={chip(!otherOpen && customer === c.name)}>{c.avatarEmoji} {c.name}</button>
            ))}
            <button onClick={() => { setOtherOpen(true); setCustomer(''); }} className={chip(otherOpen)}>➕ Other</button>
          </div>
          {otherOpen && (
            <div className="bg-hive-paper border border-hive-line rounded-hive p-3 mt-2">
              <div className="flex gap-2 mb-2">
                <button onClick={() => setOtherKind('Relative')} className={chip(otherKind === 'Relative')}>Relative</button>
                <button onClick={() => setOtherKind('Friend')} className={chip(otherKind === 'Friend')}>Family friend</button>
              </div>
              <input value={otherName} onChange={(e) => setOtherName(e.target.value)} maxLength={40} placeholder={`${otherKind}'s name (e.g. Aunty Mary)`}
                className="w-full h-11 px-3 bg-white rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
            </div>
          )}

          <div className={label}>Paid in</div>
          <div className="flex flex-wrap gap-2">
            {PAY.map((p) => (
              <button key={p.k} onClick={() => setMethod(p.k)} className={chip(method === p.k)}>{p.label}</button>
            ))}
          </div>
          {method === 'iou' && (
            <p className="text-[11px] text-hive-muted mt-1.5">An IOU is recorded but won&apos;t reach your Honey Pot until it&apos;s paid.</p>
          )}

          {error && <p className="text-hive-rose text-[12px] font-bold mt-3">{error}</p>}

          <button onClick={submit} disabled={saving || totalCents <= 0 || !itemId}
            className="w-full mt-5 h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition">
            {saving ? 'Saving…' : 'Save sale → Honey Pot 🍯'}
          </button>
        </>
      )}
    </div>
  );
}
