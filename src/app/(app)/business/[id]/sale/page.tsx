'use client';

// Kaya Business · Log a sale (kid screen 5). Multi-line cart: tap products to
// add lines (price pre-fills from the usual price, editable), set qty per line
// with "% vs your last price" coaching, see a running total, and add an
// optional Tip if the buyer offers one. Pick who bought + how they paid (shared
// across the cart). Each paid line — and the tip — sweeps into the Honey Pot
// (Treasury) and reduces that product's stock. See logSale in business.ts.

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

const PAY: Array<{ k: PaymentMethod; label: string }> = [
  { k: 'cash', label: 'Cash' },
  { k: 'hive_transfer', label: 'Hive transfer' },
  { k: 'iou', label: 'Owe me (IOU)' },
];

const toCents = (s: string): number => {
  const n = parseFloat((s || '').replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
};

interface CartLine { itemId: string; qty: number; price: string }

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
  const [lines, setLines] = useState<CartLine[]>([]);
  const [tip, setTip] = useState('');
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
  const itemById = useMemo(() => new Map(sellable.map((i) => [i.id, i])), [sellable]);
  const capFor = (it: BusinessItem) => (it.instantStock ? Infinity : Math.max(0, it.qty || 0));

  // Tap a product → add a line (auto-price from its usual price) or bump qty.
  const addProduct = (it: BusinessItem) => {
    setError('');
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === it.id);
      if (existing) {
        const cap = capFor(it);
        return prev.map((l) => l.itemId === it.id ? { ...l, qty: Math.min(cap, l.qty + 1) } : l);
      }
      const auto = typeof it.unitMarketCents === 'number' && it.unitMarketCents > 0 ? (it.unitMarketCents / 100).toString() : '';
      return [...prev, { itemId: it.id, qty: 1, price: auto }];
    });
  };
  const setQty = (itemId: string, qty: number) => {
    const it = itemById.get(itemId);
    const cap = it ? capFor(it) : Infinity;
    setLines((prev) => prev.map((l) => l.itemId === itemId ? { ...l, qty: Math.max(1, Math.min(cap, qty)) } : l));
  };
  const setPrice = (itemId: string, price: string) =>
    setLines((prev) => prev.map((l) => l.itemId === itemId ? { ...l, price } : l));
  const removeLine = (itemId: string) =>
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));

  const subtotalCents = lines.reduce((sum, l) => sum + toCents(l.price) * l.qty, 0);
  const tipCents = toCents(tip);
  const totalCents = subtotalCents + tipCents;
  const inCart = useMemo(() => new Map(lines.map((l) => [l.itemId, l.qty])), [lines]);

  const customerLabel = otherOpen ? (otherName.trim() ? `${otherName.trim()} (${otherKind})` : otherKind) : customer;

  const submit = async () => {
    if (!familyId || !business || !profile?.uid) return;
    if (lines.length === 0) { setError('Add at least one product.'); return; }
    if (lines.some((l) => toCents(l.price) <= 0)) { setError('Set a price for every item.'); return; }
    setError(''); setSaving(true);
    const actor = { uid: profile.uid, ownerId: business.ownerId };
    const label = customerLabel.trim();
    try {
      for (const l of lines) {
        const it = itemById.get(l.itemId);
        await logSale(familyId, businessId, {
          qty: l.qty,
          unitPriceCents: toCents(l.price),
          itemId: l.itemId,
          productName: it?.name,
          customerLabel: label || undefined,
          paymentMethod: method,
          description: label ? `${it?.name || 'Sale'} → ${label}` : (it?.name || 'Sale'),
        }, actor);
      }
      if (tipCents > 0) {
        await logSale(familyId, businessId, {
          qty: 1,
          unitPriceCents: tipCents,
          customerLabel: label || undefined,
          paymentMethod: method,
          description: label ? `Tip 💝 from ${label}` : 'Tip 💝',
        }, actor);
      }
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
        <div className="text-[22px]">🛒</div>
        <div className="min-w-0">
          <div className="font-nunito font-black text-[16px]">Log a sale</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">{business?.name || 'Loading…'}</div>
        </div>
      </div>

      {!canAct ? (
        <p className="text-hive-muted text-sm text-center py-8">Only the owner or a parent can log sales.</p>
      ) : (
        <>
          <div className={label}>Add what you sold</div>
          {sellable.length === 0 ? (
            <p className="text-[12.5px] text-hive-muted bg-hive-paper border border-hive-line rounded-hive p-3">No products yet — add some in Inventory first.</p>
          ) : (
            <div className="space-y-2">
              {sellable.map((it) => {
                const n = inCart.get(it.id) || 0;
                const out = capFor(it) <= 0;
                return (
                  <button key={it.id} type="button" onClick={() => addProduct(it)} disabled={out && n === 0}
                    className={`w-full flex items-center gap-2.5 rounded-hive p-2.5 border text-left transition disabled:opacity-50 ${n > 0 ? 'border-hive-navy bg-hive-honey-soft/40' : 'border-hive-line bg-hive-paper'}`}>
                    {it.photoUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={it.photoUrl} alt="" className="w-9 h-9 rounded-hive object-cover bg-hive-cream shrink-0" />
                      : <span className="w-9 h-9 rounded-hive bg-hive-cream flex items-center justify-center text-[16px] shrink-0">🛒</span>}
                    <span className="flex-1 min-w-0">
                      <span className="block font-nunito font-bold text-[13px] truncate">{it.name}</span>
                      <span className="block text-[11px] truncate text-hive-muted">
                        {it.qty || 0}{it.unitLabel ? ` ${it.unitLabel}` : ''} in stock
                        {typeof it.unitMarketCents === 'number' && it.unitMarketCents > 0 ? ` · usual ${formatCash(it.unitMarketCents, config.currency)}` : ''}
                        {it.instantStock ? ' · 🌱 instant' : out ? ' · out' : ''}
                      </span>
                    </span>
                    <span className={`shrink-0 text-[12px] font-nunito font-black ${n > 0 ? 'text-hive-honey-dk' : 'text-hive-muted'}`}>{n > 0 ? `+${n} ✓` : '＋ add'}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Cart */}
          {lines.length > 0 && (
            <>
              <div className={label}>Your cart</div>
              <div className="space-y-2">
                {lines.map((l) => {
                  const it = itemById.get(l.itemId);
                  if (!it) return null;
                  const unitCents = toCents(l.price);
                  const lineTotal = unitCents * l.qty;
                  const last = lastSaleUnitPriceCents(ledger, l.itemId);
                  const pct = last && last > 0 && unitCents > 0 ? Math.round(((unitCents - last) / last) * 100) : null;
                  const unit = it.unitLabel || business?.unitLabel;
                  return (
                    <div key={l.itemId} className="bg-hive-paper border border-hive-line rounded-hive p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-nunito font-extrabold text-[13px] truncate">{it.name}</span>
                        <button type="button" onClick={() => removeLine(l.itemId)} aria-label="Remove"
                          className="w-6 h-6 rounded-full bg-hive-cream text-hive-muted text-[12px] flex items-center justify-center shrink-0">✕</button>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => setQty(l.itemId, l.qty - 1)} className="w-8 h-8 rounded-hive bg-hive-cream font-black text-hive-navy">−</button>
                          <input type="number" min={1} value={l.qty} onChange={(e) => setQty(l.itemId, parseInt(e.target.value) || 1)}
                            className="w-12 h-8 text-center bg-white rounded-hive border border-hive-line text-[13px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
                          <button type="button" onClick={() => setQty(l.itemId, l.qty + 1)} className="w-8 h-8 rounded-hive bg-hive-cream font-black text-hive-navy">＋</button>
                        </div>
                        <span className="text-[11px] text-hive-muted">×</span>
                        <div className="flex items-center gap-1 flex-1">
                          <input value={l.price} onChange={(e) => setPrice(l.itemId, e.target.value)} inputMode="decimal" placeholder="price"
                            className="w-full h-8 px-2 bg-white rounded-hive border border-hive-line text-[13px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
                          <span className="text-[10px] text-hive-muted whitespace-nowrap">/{unit || 'unit'}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[11px] font-nunito font-bold">
                          {pct !== null && (pct > 0
                            ? <span className="text-[#2F7D32]">📈 +{pct}% · Bravo!</span>
                            : pct < 0
                            ? <span className="text-[#B25E16]">📉 {pct}% · negotiate?</span>
                            : <span className="text-hive-muted">= last price</span>)}
                        </span>
                        <span className="text-[12.5px] font-nunito font-black text-hive-navy">{formatCash(lineTotal, config.currency)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tip */}
              <div className={label}>Tip? <span className="text-hive-muted normal-case font-bold">(only if the buyer offers — goes to your Honey Pot 🍯)</span></div>
              <input value={tip} onChange={(e) => setTip(e.target.value)} inputMode="decimal" placeholder="0"
                className="w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />

              {/* Totals */}
              <div className="bg-[#F4ECD8] border border-hive-honey/60 rounded-hive p-4 mt-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between"><span>Subtotal ({lines.length} item{lines.length === 1 ? '' : 's'})</span><span className="font-nunito font-bold">{formatCash(subtotalCents, config.currency)}</span></div>
                {tipCents > 0 && <div className="flex justify-between"><span>Tip 💝</span><span className="font-nunito font-bold">{formatCash(tipCents, config.currency)}</span></div>}
                <div className="flex justify-between border-t border-dashed border-black/10 pt-1.5"><span>Total</span><span className="font-nunito font-black text-[#2F7D32]">{formatCash(totalCents, config.currency)}</span></div>
                {method !== 'iou' && (
                  <div className="flex justify-between"><span>→ Honey Pot 🍯</span><span className="font-nunito font-extrabold">{formatCash(totalCents, config.currency)}</span></div>
                )}
              </div>
            </>
          )}

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

          <button onClick={submit} disabled={saving || lines.length === 0 || subtotalCents <= 0}
            className="w-full mt-5 h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition">
            {saving ? 'Saving…' : `Save sale → Honey Pot 🍯 ${totalCents > 0 ? formatCash(totalCents, config.currency) : ''}`}
          </button>
        </>
      )}
    </div>
  );
}
