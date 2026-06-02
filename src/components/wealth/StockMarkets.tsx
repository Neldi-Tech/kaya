'use client';

// Kaya Wealth · DSE markets + AI (Phase 2 · PR9 · 2026-06-01).
//
// Local market first: the DSE with DAILY-CLOSE indicative levels + a
// plain-language AI update tied to the family's holdings. Global markets stay
// locked (Phase 3). Reuses the mockup's market styling from wealth.css.

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';

interface DseQuote { symbol: string; name: string; price: string; changePct: number }
interface MarketUpdate { quotes: DseQuote[]; asOf: string; commentary: string; ai: boolean; live: boolean }

// Indicative Bank of Tanzania Treasury Bond / Bill auction yields. Curated +
// labelled honestly (not a live feed) — government securities are a low-risk
// home for idle cash. Swap for an operator/feed-maintained store later.
const TBONDS: { name: string; yieldPct: string }[] = [
  { name: '25-yr T-Bond', yieldPct: '15.4%' },
  { name: '20-yr T-Bond', yieldPct: '15.1%' },
  { name: '15-yr T-Bond', yieldPct: '13.9%' },
  { name: '10-yr T-Bond', yieldPct: '12.6%' },
  { name: '7-yr T-Bond',  yieldPct: '11.3%' },
  { name: '5-yr T-Bond',  yieldPct: '10.2%' },
  { name: '364-day T-Bill', yieldPct: '9.8%' },
  { name: '182-day T-Bill', yieldPct: '8.4%' },
];

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
      if (j?.ok) setData({ quotes: j.quotes ?? [], asOf: j.asOf ?? '', commentary: j.commentary ?? '', ai: !!j.ai, live: !!j.live });
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
            <span style={{ fontSize: '9.5px', fontWeight: 800, color: data?.live ? '#fff' : 'var(--navy)', background: data?.live ? 'var(--green)' : 'var(--gold)', padding: '3px 8px', borderRadius: 20, letterSpacing: '.04em' }}>
              {data?.live ? '🟢 LIVE' : 'DAILY CLOSE'}{data?.asOf ? ` · ${data.asOf}` : ''}
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
          <div className="glock-note" style={{ marginTop: 8 }}>{data?.live ? 'Live prices read from the Dar es Salaam Stock Exchange (dse.co.tz), cached briefly.' : 'Indicative daily-close levels.'} AI gives context only, never trade advice.</div>
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

      {/* Treasury Bonds & Bills — a low-risk home for idle cash */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: '13.5px', color: 'var(--navy)' }}>🏦 Treasury Bonds &amp; Bills <small style={{ color: 'var(--grey)', fontWeight: 600 }}>· Bank of Tanzania</small></div>
          <span style={{ fontSize: '9.5px', fontWeight: 800, color: '#9a7b27', background: '#fbf3df', padding: '3px 8px', borderRadius: 20, letterSpacing: '.04em' }}>INDICATIVE</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {TBONDS.map((b) => (
            <div key={b.name} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '9px 11px', background: '#fff' }}>
              <div style={{ fontSize: 12, color: 'var(--navy)', fontWeight: 700 }}>{b.name}</div>
              <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--green)' }}>{b.yieldPct}</div>
              <div style={{ fontSize: 10, color: 'var(--grey)' }}>p.a. yield</div>
            </div>
          ))}
        </div>
        <div className="glock-note" style={{ marginTop: 10 }}>Indicative auction yields — check the latest BoT auction for live rates. Government securities (T-Bonds &amp; T-Bills) are a low-risk way to put idle cash to work; add one to your Asset Register under Public Markets.</div>
      </div>
    </div>
  );
}
