'use client';

// Public scan-back page (2026-07-04). A buyer/supplier opens this from the
// QR on a printed purchase form — NO login. They see the shopping list and
// type the actual prices, which post back to Kaya to pre-fill the parent's
// reconcile. Backed by /api/purchase/scan (Admin SDK + opaque 48h token).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { currencyDecimals } from '@/lib/hive';

type Item = {
  id: string; name: string; name2: string; category: string;
  qty: number; unit: string; estimatedCents: number;
  actualCents: number | null; actualQty: number | null;
};
type Data = {
  ref: string; module: string; familyName: string; currency: string;
  status: string; canLog: boolean; note: string; items: Item[];
};

export default function ScanBackPage() {
  const params = useParams();
  const token = String(params?.token ?? '');
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'expired' | 'error'>('loading');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setState('notfound'); return; }
    fetch(`/api/purchase/scan?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.status === 404) { setState('notfound'); return; }
        if (r.status === 410) { setState('expired'); return; }
        if (!r.ok) { setState('error'); return; }
        const d = (await r.json()) as Data;
        setData(d);
        const seed: Record<string, string> = {};
        for (const it of d.items) if (it.actualCents != null) seed[it.id] = String(it.actualCents / 100);
        setPrices(seed);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [token]);

  const dec = data ? currencyDecimals(data.currency) : 0;
  const money = useMemo(() => (cents: number) => {
    const amt = cents / 100;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: dec === 0 || amt % 1 === 0 ? 0 : 2,
      maximumFractionDigits: dec === 0 ? 0 : 2,
    }).format(amt);
  }, [dec]);

  const enteredTotalCents = useMemo(() => {
    if (!data) return 0;
    return data.items.reduce((s, it) => {
      const v = parseFloat(prices[it.id]);
      return s + (Number.isFinite(v) ? Math.round(v * 100) * it.qty : 0);
    }, 0);
  }, [prices, data]);

  async function submit() {
    if (!data) return;
    const items = data.items
      .map((it) => {
        const v = parseFloat(prices[it.id]);
        return Number.isFinite(v) ? { id: it.id, actualCents: Math.round(v * 100), actualQty: it.qty } : null;
      })
      .filter(Boolean);
    if (items.length === 0) return;
    setSending(true);
    try {
      const r = await fetch('/api/purchase/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'logActuals', token, items }),
      });
      if (r.ok) setDone(true);
      else if (r.status === 410) setState('expired');
      else setState('error');
    } catch { setState('error'); }
    finally { setSending(false); }
  }

  const shell = (inner: ReactNode) => (
    <div style={{ minHeight: '100dvh', background: '#F7F3E9' }} className="w-full flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-md">{inner}</div>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2.5 mb-4">
      <div style={{ background: '#D2A63E', color: '#2a2205' }} className="w-9 h-9 rounded-xl grid place-items-center font-black text-lg">K</div>
      <div className="font-black text-lg" style={{ color: '#17223C' }}>Kaya</div>
    </div>
  );

  if (state === 'loading') return shell(<><div>{brand}</div><p className="text-center text-sm" style={{ color: '#8B8064' }}>Loading…</p></>);
  if (state === 'notfound') return shell(<><div>{brand}</div><div className="text-center py-16"><div className="text-4xl mb-2">🔎</div><p className="font-black text-lg" style={{ color: '#17223C' }}>Link not found</p><p className="text-sm mt-1" style={{ color: '#8B8064' }}>This share link isn’t valid.</p></div></>);
  if (state === 'expired') return shell(<><div>{brand}</div><div className="text-center py-16"><div className="text-4xl mb-2">⌛</div><p className="font-black text-lg" style={{ color: '#17223C' }}>Link expired</p><p className="text-sm mt-1" style={{ color: '#8B8064' }}>Ask the family to share a fresh link (they expire after 48 hours).</p></div></>);
  if (state === 'error') return shell(<><div>{brand}</div><div className="text-center py-16"><div className="text-4xl mb-2">😕</div><p className="font-black text-lg" style={{ color: '#17223C' }}>Something went wrong</p><p className="text-sm mt-1" style={{ color: '#8B8064' }}>Please try again in a moment.</p></div></>);
  if (done) return shell(<><div>{brand}</div><div className="text-center py-16"><div className="text-4xl mb-2">✅</div><p className="font-black text-lg" style={{ color: '#17223C' }}>Prices sent — asante! 🙏</p><p className="text-sm mt-1" style={{ color: '#8B8064' }}>The family will see them in Kaya to reconcile.</p></div></>);

  const d = data as Data;
  return shell(
    <>
      {brand}
      <div className="rounded-2xl overflow-hidden border" style={{ borderColor: '#E8DEC9', background: '#fff' }}>
        <div style={{ background: '#17223C', color: '#fff' }} className="px-5 py-4">
          <div className="text-[11px]" style={{ color: '#c7cfdd' }}>{d.familyName}</div>
          <div className="font-black text-xl">Shopping List</div>
          <div className="text-[12px]" style={{ color: '#c7cfdd' }}>{d.ref}</div>
        </div>
        <div className="px-4 py-3">
          {d.canLog
            ? <p className="text-[13px] mb-3" style={{ color: '#41506E' }}>Type what you actually paid <b>per item</b> and send it back. 🙏</p>
            : <p className="text-[13px] mb-3" style={{ color: '#41506E' }}>This purchase is already closed — here’s the list for reference.</p>}
          {d.note ? <p className="text-[12px] mb-3 rounded-xl px-3 py-2" style={{ background: '#FFF8EC', border: '1px solid #E8DEC9', color: '#41506E' }}><b>Note:</b> {d.note}</p> : null}

          {d.items.map((it, i) => (
            <div key={it.id} className="py-2.5" style={{ borderTop: i === 0 ? 'none' : '1px solid #EEE7D6' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-sm" style={{ color: '#0F1822' }}>{it.name}</div>
                  <div className="text-[12px]" style={{ color: '#8B8064' }}>{it.qty}× {it.unit}{it.estimatedCents ? ` · est. ${money(it.estimatedCents)}` : ''}</div>
                </div>
                {d.canLog ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[11px] font-bold" style={{ color: '#8B8064' }}>{d.currency}</span>
                    <input
                      value={prices[it.id] ?? ''}
                      onChange={(e) => setPrices((p) => ({ ...p, [it.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      inputMode="decimal" placeholder="0"
                      className="w-24 text-right text-sm font-bold px-2 py-1.5 rounded-lg focus:outline-none"
                      style={{ border: '1.5px solid #E8DEC9' }}
                    />
                  </div>
                ) : (
                  <div className="text-sm font-bold shrink-0" style={{ color: '#0F1822' }}>{it.actualCents != null ? `${d.currency} ${money(it.actualCents)}` : '—'}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {d.canLog && (
          <div className="px-4 py-4 sticky bottom-0" style={{ background: '#fff', borderTop: '1px solid #EEE7D6' }}>
            <div className="flex items-center justify-between mb-2 text-sm">
              <span style={{ color: '#8B8064' }}>Your total</span>
              <span className="font-black" style={{ color: '#17223C' }}>{d.currency} {money(enteredTotalCents)}</span>
            </div>
            <button onClick={submit} disabled={sending || enteredTotalCents === 0}
              className="w-full font-black text-sm px-5 py-3 rounded-full disabled:opacity-40"
              style={{ background: '#17223C', color: '#fff' }}>
              {sending ? 'Sending…' : '📲 Send prices to Kaya'}
            </button>
          </div>
        )}
      </div>
      <p className="text-center text-[11px] mt-4" style={{ color: '#8B8064' }}>Secured by Kaya · this link expires 48h after it was shared</p>
    </>,
  );
}
