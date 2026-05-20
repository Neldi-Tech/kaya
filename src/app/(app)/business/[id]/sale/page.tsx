'use client';

// Kaya Business · Log a sale (kid screen 5). 1-tap entry — who bought, how
// many, price, payment method. A paid sale's full amount sweeps into the
// owner's Hive Cash immediately (earning is frictionless; spending from the
// Hive still needs a parent OK). See logSale in business.ts.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { Business, PaymentMethod, subscribeToBusiness, logSale } from '@/lib/business';
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
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState('');
  const [customer, setCustomer] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!familyId || !businessId) return;
    return subscribeToBusiness(familyId, businessId, (b) => {
      setBusiness(b);
      if (b && !price && typeof b.unitPriceCents === 'number') setPrice((b.unitPriceCents / 100).toString());
    });
  }, [familyId, businessId]);

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === business?.ownerId;
  const canAct = isParent || isOwner;

  const unitCents = useMemo(() => {
    const n = parseFloat(price.replace(/,/g, ''));
    return Number.isNaN(n) ? 0 : Math.round(n * 100);
  }, [price]);
  const totalCents = unitCents * qty;
  const unitLabel = business?.unitLabel;

  const submit = async () => {
    if (!familyId || !business || !profile?.uid) return;
    if (totalCents <= 0) { setError('Enter a price.'); return; }
    setError(''); setSaving(true);
    try {
      await logSale(familyId, businessId, {
        qty,
        unitPriceCents: unitCents,
        customerLabel: customer.trim() || undefined,
        paymentMethod: method,
        description: customer.trim() ? `Sold to ${customer.trim()}` : 'Sale',
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
          <div className={label}>Who bought? (optional)</div>
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} maxLength={40} placeholder="e.g. Aunty Mary"
            className="w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
          {children.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {children.filter((c) => c.id !== business?.ownerId).map((c) => (
                <button key={c.id} onClick={() => setCustomer(c.name)} className={chip(customer === c.name)}>{c.avatarEmoji} {c.name}</button>
              ))}
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

          <div className="bg-[#F4ECD8] border border-hive-honey/60 rounded-hive p-4 mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between"><span>Quantity</span><span className="font-nunito font-bold">{qty}</span></div>
            <div className="flex justify-between"><span>Unit price</span><span className="font-nunito font-bold">{formatCash(unitCents, config.currency)}</span></div>
            <div className="flex justify-between border-t border-dashed border-black/10 pt-1.5"><span>Total</span><span className="font-nunito font-black text-[#2F7D32]">{formatCash(totalCents, config.currency)}</span></div>
            {method !== 'iou' && (
              <div className="flex justify-between"><span>→ Hive Cash</span><span className="font-nunito font-extrabold">{formatCash(totalCents, config.currency)}</span></div>
            )}
          </div>

          <div className={label}>Paid in</div>
          <div className="flex flex-wrap gap-2">
            {PAY.map((p) => (
              <button key={p.k} onClick={() => setMethod(p.k)} className={chip(method === p.k)}>{p.label}</button>
            ))}
          </div>
          {method === 'iou' && (
            <p className="text-[11px] text-hive-muted mt-1.5">An IOU is recorded but won&apos;t reach your Hive until it&apos;s paid.</p>
          )}

          {error && <p className="text-hive-rose text-[12px] font-bold mt-3">{error}</p>}

          <button onClick={submit} disabled={saving || totalCents <= 0}
            className="w-full mt-5 h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition">
            {saving ? 'Saving…' : 'Save sale'}
          </button>
        </>
      )}
    </div>
  );
}
