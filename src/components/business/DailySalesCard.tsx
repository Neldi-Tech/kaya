'use client';

// Daily auto-sale (#6). For products flagged "sold daily" (fresh veg, eggs…),
// the kid gets a one-tap draft: set today's qty and send it to a parent for
// approval. On approve, resolveBusinessRequest runs the sale (sweeps the Honey
// Pot + decrements stock). Renders nothing if there are no daily products.

import { useEffect, useState } from 'react';
import {
  Business, BusinessItem, subscribeToBusinessItems, requestDailySale,
} from '@/lib/business';
import { ApprovalRequest } from '@/lib/hive';
import { formatCash } from '@/components/hive/format';

export default function DailySalesCard({
  familyId, business, requests, currency, uid,
}: {
  familyId: string;
  business: Pick<Business, 'id' | 'ownerId' | 'name' | 'emoji'>;
  requests: ApprovalRequest[];
  currency: string;
  uid: string;
}) {
  const [items, setItems] = useState<BusinessItem[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => subscribeToBusinessItems(familyId, business.id, setItems), [familyId, business.id]);

  const daily = items.filter((i) => i.soldDaily && i.kind === 'stock' && !i.loss);
  if (daily.length === 0) return null;

  const pendingFor = (itemId: string) =>
    requests.some((r) => r.type === 'business_sale' && r.status === 'pending' && r.businessId === business.id && r.itemId === itemId);

  const send = async (it: BusinessItem) => {
    const q = Math.max(1, Math.round(qty[it.id] ?? 1));
    const price = it.unitMarketCents || 0;
    if (price <= 0) { setError(`Set a price for ${it.name} first (in Inventory).`); return; }
    setError(''); setBusy(it.id);
    try {
      await requestDailySale(familyId, business, it, q, price, uid);
    } catch (e: any) {
      setError(e?.message || 'Could not send.');
    } finally { setBusy(''); }
  };

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="font-nunito font-extrabold text-[14px]">🔁 Daily sales</h3>
        <span className="text-[11px] text-hive-muted">send today&apos;s sale for a parent OK</span>
      </div>
      {daily.map((it) => {
        const pending = pendingFor(it.id);
        const q = qty[it.id] ?? 1;
        const price = it.unitMarketCents || 0;
        return (
          <div key={it.id} className="flex items-center gap-2.5 py-2 border-b border-dashed border-hive-line last:border-0">
            {it.photoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={it.photoUrl} alt="" className="w-9 h-9 rounded-hive object-cover bg-hive-cream shrink-0" />
              : <span className="w-9 h-9 rounded-hive bg-hive-cream flex items-center justify-center text-[16px] shrink-0">🌱</span>}
            <div className="flex-1 min-w-0">
              <div className="font-nunito font-bold text-[13px] truncate">{it.name}</div>
              <div className="text-[11px] text-hive-muted truncate">{price > 0 ? `${formatCash(price, currency)}${it.unitLabel ? ` / ${it.unitLabel}` : ''}` : 'set a price'}</div>
            </div>
            {pending ? (
              <span className="text-[11px] font-nunito font-extrabold text-[#B25E16] shrink-0">⏳ Pending</span>
            ) : (
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => setQty((p) => ({ ...p, [it.id]: Math.max(1, q - 1) }))} className="w-7 h-7 rounded-hive border border-hive-line bg-white text-[15px]">−</button>
                <span className="w-6 text-center font-nunito font-black text-[13px]">{q}</span>
                <button onClick={() => setQty((p) => ({ ...p, [it.id]: q + 1 }))} className="w-7 h-7 rounded-hive border border-hive-line bg-white text-[15px]">+</button>
                <button onClick={() => send(it)} disabled={!!busy || price <= 0}
                  className="h-8 px-3 rounded-hive-pill bg-hive-navy text-hive-honey font-nunito font-black text-[11.5px] disabled:opacity-40 hover:brightness-110">
                  {busy === it.id ? 'Sending…' : 'Send →'}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {error && <p className="text-hive-rose text-[12px] font-bold mt-2">{error}</p>}
    </div>
  );
}
