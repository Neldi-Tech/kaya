'use client';

// Kaya Business 2.0 · 🛎️ Family Orders Board (approved innovation, D5).
//
// One card, two faces:
//  - OWNER (kid) + parents: the order queue — accept → make → "Delivered ✓".
//    Delivering marks the order done at the gateway, then books the sale
//    through the normal client logSale (money sweeps the Honey Pot exactly
//    like the sale screen — the gateway never moves money).
//  - Everyone else in the family: "Order from {kid}" — pick from the menu,
//    set how many, add a note, place. Demand for made-to-order businesses,
//    made by the people who love the kid most.
//
// Reads/writes ride the Admin gateway /api/business/orders (no client rules
// path for cross-kid writes — see the route header). Data refreshes after
// every action; previews without admin creds show a quiet empty state.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import { Business, BusinessItem, logSale, resolvePricingModel, pricingModelMeta } from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import { useCelebrate } from '@/components/celebrate/CelebrationProvider';

interface OrderRow {
  id: string;
  productName: string;
  qty: number;
  unitPriceCents: number;
  amountCents: number;
  itemId: string | null;
  note: string | null;
  status: 'open' | 'accepted' | 'declined' | 'done' | 'cancelled';
  customerUid: string;
  customerName: string;
  placedAt: number | null;
}

async function api(path: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  try {
    const tok = await auth.currentUser?.getIdToken();
    if (!tok) return null;
    const r = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}`, ...(init?.headers || {}) },
    });
    return (await r.json()) as Record<string, unknown>;
  } catch { return null; }
}

export default function OrdersCard({ familyId, business, items, uid, isParent, isOwner, currency }: {
  familyId: string;
  business: Business;
  items: BusinessItem[];
  uid: string;
  isParent: boolean;
  isOwner: boolean;
  currency: string;
}) {
  const businessId = business.id;
  const celebrate = useCelebrate();
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  // Place-order form (non-owner face)
  const [placing, setPlacing] = useState(false);
  const [pickId, setPickId] = useState('');
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placed, setPlaced] = useState(false);

  const canManage = isOwner || isParent;
  const menu = items.filter((it) => (it.kind === 'menu' || it.kind === 'stock') && !it.archived && !it.loss && (it.unitMarketCents || 0) > 0);

  const load = useCallback(async () => {
    const j = await api(`/api/business/orders?businessId=${businessId}`);
    if (j && Array.isArray(j.orders)) setOrders(j.orders as OrderRow[]);
    else if (j?.skipped) setOrders([]);
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (orderId: string, action: 'accept' | 'decline' | 'cancel' | 'fulfill', order?: OrderRow) => {
    if (busyId) return;
    setBusyId(orderId); setError('');
    try {
      const j = await api('/api/business/orders', {
        method: 'POST',
        body: JSON.stringify({ action, businessId, orderId }),
      });
      if (!j || j.error) { setError(String(j?.message || j?.error || 'Could not update the order.')); return; }
      // Delivered → book the sale on the proven client path (owner/parent
      // are item+ledger writers by rules). Gateway enforces exactly-once
      // via the accepted→done status gate.
      if (action === 'fulfill' && order) {
        try {
          const model = resolvePricingModel(business);
          await logSale(familyId, businessId, {
            qty: order.qty,
            halfSteps: !!pricingModelMeta(model).halfSteps,
            unitPriceCents: order.unitPriceCents,
            ...(order.itemId ? { itemId: order.itemId } : {}),
            productName: order.productName,
            customerRef: order.customerUid,
            customerLabel: order.customerName,
            paymentMethod: 'hive_transfer',
            description: `${order.productName} (order)`,
          }, { uid, ownerId: business.ownerId });
          celebrate({ kind: 'sale', subtitle: `${formatCash(order.amountCents, currency)} → the Honey Pot 🍯` });
        } catch {
          setError('Order marked delivered, but the sale did not log — add it from 💵 Log sale.');
        }
      }
      await load();
    } finally { setBusyId(''); }
  };

  const place = async () => {
    if (placeBusy || !pickId) return;
    setPlaceBusy(true); setError(''); setPlaced(false);
    try {
      const j = await api('/api/business/orders', {
        method: 'POST',
        body: JSON.stringify({ action: 'place', businessId, itemId: pickId, qty, note: note.trim() || undefined }),
      });
      if (!j || j.error) { setError(String(j?.message || j?.error || 'Could not place the order.')); return; }
      setPlaced(true); setPlacing(false); setPickId(''); setQty(1); setNote('');
      await load();
    } finally { setPlaceBusy(false); }
  };

  if (orders === null) return null; // quiet while loading / signed out

  const open = orders.filter((o) => o.status === 'open');
  const accepted = orders.filter((o) => o.status === 'accepted');
  const myOpen = orders.filter((o) => o.customerUid === uid && (o.status === 'open' || o.status === 'accepted'));

  // Nothing to show at all? (owner with no orders still sees the empty queue
  // so they know the board exists; non-owners see the order button.)
  const chip = 'text-[10px] font-nunito font-black uppercase tracking-wide px-1.5 py-0.5 rounded-hive-pill';

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="font-nunito font-extrabold text-[14px]">🛎️ Family orders</h3>
        {canManage && (open.length + accepted.length > 0) && (
          <span className="text-[11px] font-nunito font-black text-hive-honey-dk">{open.length + accepted.length} to handle</span>
        )}
      </div>

      {/* ── Owner/parent queue ── */}
      {canManage && (
        (open.length + accepted.length) === 0 ? (
          <p className="text-[12px] text-hive-muted py-1.5">
            No orders waiting. Family members can order right from this page — your best first customers live with you. 😊
          </p>
        ) : (
          <div>
            {[...open, ...accepted].map((o) => (
              <div key={o.id} className="py-2 border-b border-dashed border-hive-line last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-nunito font-bold truncate">
                      {o.qty}× {o.productName} <span className="text-hive-muted font-normal">· {o.customerName}</span>
                    </div>
                    {o.note && <div className="text-[11.5px] text-hive-navy/70 truncate">💬 “{o.note}”</div>}
                    <div className="text-[11px] text-hive-muted">{formatCash(o.amountCents, currency)}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {o.status === 'open' ? (
                      <>
                        <button onClick={() => act(o.id, 'accept')} disabled={busyId === o.id}
                          className="h-9 px-3 rounded-hive-pill bg-[#2F7D32] text-white font-nunito font-black text-[12px] disabled:opacity-40">✓ Accept</button>
                        <button onClick={() => act(o.id, 'decline')} disabled={busyId === o.id}
                          className="h-9 px-2.5 rounded-hive-pill bg-[#FCEAEA] text-hive-rose font-nunito font-black text-[12px] disabled:opacity-40">✕</button>
                      </>
                    ) : (
                      <button onClick={() => act(o.id, 'fulfill', o)} disabled={busyId === o.id}
                        className="h-9 px-3 rounded-hive-pill bg-hive-honey text-hive-navy font-nunito font-black text-[12px] disabled:opacity-40">
                        {busyId === o.id ? '…' : '🧾 Delivered ✓'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <p className="text-[10.5px] text-hive-muted mt-1.5">Delivered ✓ books the sale → Honey Pot, like any sale.</p>
          </div>
        )
      )}

      {/* ── Customer face — order from this kid ── */}
      {!isOwner && (
        <div className={canManage ? 'mt-2 pt-2 border-t border-dashed border-hive-line' : ''}>
          {myOpen.length > 0 && (
            <div className="mb-1.5">
              {myOpen.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]">
                  <span className="min-w-0 truncate">🧾 Your order: {o.qty}× {o.productName}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className={`${chip} ${o.status === 'accepted' ? 'bg-[#E2F0E2] text-[#2F7D32]' : 'bg-hive-cream text-hive-muted'}`}>
                      {o.status === 'accepted' ? 'being made' : 'waiting'}
                    </span>
                    {o.status === 'open' && (
                      <button onClick={() => act(o.id, 'cancel')} disabled={busyId === o.id}
                        className="text-[11px] text-hive-muted font-nunito font-bold hover:underline">cancel</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {placed && <p className="text-[12px] font-nunito font-bold text-[#2F7D32] mb-1.5">✓ Order sent! 🛎️</p>}

          {!placing ? (
            <button onClick={() => setPlacing(true)} disabled={menu.length === 0}
              className="w-full h-10 rounded-hive bg-hive-cream border border-hive-honey/60 text-hive-navy font-nunito font-extrabold text-[12.5px] disabled:opacity-50 hover:brightness-95 transition">
              {menu.length === 0 ? 'Nothing priced to order yet' : `🛎️ Place an order`}
            </button>
          ) : (
            <div className="space-y-2">
              <select value={pickId} onChange={(e) => setPickId(e.target.value)}
                className="w-full h-10 px-2 bg-white rounded-hive border border-hive-line text-[13px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40">
                <option value="">What would you like?</option>
                {menu.map((it) => (
                  <option key={it.id} value={it.id}>{it.name} · {formatCash(it.unitMarketCents || 0, currency)}</option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-9 h-9 rounded-hive border border-hive-line bg-white text-[15px]">−</button>
                <span className="w-10 text-center font-nunito font-black text-[14px]">{qty}</span>
                <button onClick={() => setQty((q) => Math.min(99, q + 1))} className="w-9 h-9 rounded-hive border border-hive-line bg-white text-[15px]">＋</button>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Note (e.g. for Saturday!)"
                  className="flex-1 min-w-0 h-9 px-2.5 bg-white rounded-hive border border-hive-line text-[12.5px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
              </div>
              <div className="flex gap-2">
                <button onClick={place} disabled={placeBusy || !pickId}
                  className="flex-1 h-10 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[12.5px] disabled:opacity-40">
                  {placeBusy ? 'Sending…' : '🛎️ Send order'}
                </button>
                <button onClick={() => { setPlacing(false); setError(''); }} className="h-10 px-3 rounded-hive bg-hive-cream text-hive-muted font-nunito font-extrabold text-[12px]">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-hive-rose text-[12px] font-bold mt-2">{error}</p>}
      {canManage && menu.length === 0 && (
        <p className="text-[11px] text-hive-muted mt-1.5">
          Family can only order priced items — <Link href={`/business/${businessId}/pricing`} className="text-hive-honey-dk font-extrabold hover:underline">set prices in the Pricing Studio →</Link>
        </p>
      )}
    </div>
  );
}
