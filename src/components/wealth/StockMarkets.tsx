'use client';

// Kaya Wealth · DSE markets + AI (Phase 2 · PR9 · 2026-06-01).
//
// Local market first: the DSE with DAILY-CLOSE indicative levels + a
// plain-language AI update tied to the family's holdings. Global markets stay
// locked (Phase 3). Reuses the mockup's market styling from wealth.css.

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';

interface DseQuote { symbol: string; name: string; price: string; changePct: number }
interface MarketUpdate { quotes: DseQuote[]; asOf: string; commentary: string; ai: boolean }

function sparkline(up: boolean) {
  return (
    <svg className="spark" viewBox="0 0 64 24">
      <polyline points={up ? '0,18 13,15 26,16 39,10 52,8 64,5' : '0,8 13,10 26,9 39,14 52,15 64,17'}
        fill="none" stroke={up ? '#2E7D34' : '#E85C5C'} strokeWidth="2" />
    </svg>
  );
}

export default function StockMarkets() {
  const [data, setData] = useState<MarketUpdate | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const u = auth.currentUser;
    const token = u ? await u.getIdToken() : '';
    try {
      const r = await fetch('/api/wealth/markets/ai-update', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (j?.ok) setData({ quotes: j.quotes ?? [], asOf: j.asOf ?? '', commentary: j.commentary ?? '', ai: !!j.ai });
    } catch { /* keep prior */ }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  return (
    <div className="adult-block">
      <div className="section-title">
        <h2>📡 Stock Markets <span className="pilltag">Local · DSE + AI</span></h2>
        {!loading && <a onClick={load} style={{ cursor: 'pointer' }}>↻ Refresh</a>}
      </div>
      <div className="grid g2">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: '13.5px', color: 'var(--navy)' }}>🇹🇿 Dar es Salaam · DSE</div>
            <span style={{ fontSize: '9.5px', fontWeight: 800, color: 'var(--navy)', background: 'var(--gold)', padding: '3px 8px', borderRadius: 20, letterSpacing: '.04em' }}>
              DAILY CLOSE{data?.asOf ? ` · ${data.asOf}` : ''}
            </span>
          </div>
          {loading && !data && <div className="market"><div className="t">Loading DSE…</div></div>}
          {(data?.quotes ?? []).map((q) => (
            <div className="market" key={q.symbol}>
              <div className="t">{q.symbol}<small>{q.name}</small></div>
              {sparkline(q.changePct >= 0)}
              <div className="p"><div className="px">{q.price}</div><div className={`pc ${q.changePct >= 0 ? 'up' : 'down'}`}>{q.changePct >= 0 ? '+' : ''}{q.changePct}%</div></div>
            </div>
          ))}
          <div className="aiupdate">
            <span className="ai-orb" />
            <div><b>AI market update:</b> {loading ? 'Reading your holdings…' : (data?.commentary || 'The DSE is your local market.')}</div>
          </div>
          <div className="glock-note" style={{ marginTop: 8 }}>Indicative daily-close levels — a near-live feed is a future upgrade. AI gives context only, never trade advice.</div>
        </div>

        <div className="card glocked">
          <div className="gtitle">🌍 Global Markets <span className="tag" style={{ background: '#fbf3df', color: '#9a7b27' }}>🔒 Locked</span></div>
          <div className="grow"><span>NYSE · S&amp;P 500</span><span>4,930 ▲ 0.4%</span></div>
          <div className="grow"><span>NASDAQ Composite</span><span>15,620 ▲ 0.6%</span></div>
          <div className="grow"><span>LSE · FTSE 100</span><span>7,690 ▼ 0.2%</span></div>
          <button className="glock-cta">⭐ Unlock global markets — Phase 3 (paid)</button>
          <div className="glock-note">Kaya Wealth shows your <b>local exchange (DSE)</b> first. Global data &amp; AI-assisted live trading is a future paid upgrade — it requires brokerage licensing, KYC, and stronger AI safeguards before any live trade is allowed.</div>
        </div>
      </div>
    </div>
  );
}
