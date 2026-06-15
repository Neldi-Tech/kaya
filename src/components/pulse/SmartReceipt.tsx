'use client';

// SmartReceipt — Pulse Smart Receipt AI card for /pulse/txn/[id] (PR 3 / v2).
// Calls /api/pulse/smart-receipt with pre-formatted facts about a single
// purchase and renders Claude's 1-2 sentence insight + an optional tweak.
// Cached per-txn in localStorage so a repeat open is free; "Refresh" re-runs.
// Mirrors AskKaya's shape.

import { useEffect, useState } from 'react';

interface Insight { insight: string; tip: string; ts: number }

export default function SmartReceipt({ txnId, bucketLabel, currency, facts }: {
  txnId: string;
  bucketLabel: string;
  currency: string;
  facts: Record<string, string | number>;
}) {
  const cacheKey = `kaya:pulse:smart-receipt:${txnId}`;
  const [data, setData] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  useEffect(() => {
    setData(null); setError(null); setUnconfigured(false);
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) setData(JSON.parse(raw) as Insight);
    } catch { /* ignore */ }
  }, [cacheKey]);

  const run = async () => {
    setLoading(true); setError(null); setUnconfigured(false);
    try {
      const res = await fetch('/api/pulse/smart-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency, bucketLabel, facts }),
      });
      const json = await res.json();
      if (json?.skipped) { setUnconfigured(true); return; }
      if (!res.ok) { setError(json?.error || 'Could not get insight.'); return; }
      const next: Insight = { insight: json.insight || '', tip: json.tip || '', ts: Date.now() };
      setData(next);
      try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* ignore */ }
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl p-4 text-white mt-3 shadow-[0_8px_24px_rgba(15,31,68,0.18)]"
      style={{ background: 'linear-gradient(135deg,#0F1F44 0%,#1c3566 100%)' }}>
      <div className="text-[10px] font-nunito font-black uppercase tracking-[1.4px] text-pulse-gold mb-2">🧠 Smart Receipt · Kaya AI</div>

      {!data && !loading && !error && !unconfigured && (
        <>
          <p className="text-[12.5px] font-bold opacity-90 leading-snug mb-3">Ask Kaya for a quick read of this purchase — how it fits the bucket plan + one tweak for next time.</p>
          <button type="button" onClick={run}
            className="bg-pulse-gold text-pulse-navy font-nunito font-black text-[12px] px-3 py-1.5 rounded-full">
            Get insight
          </button>
        </>
      )}
      {loading && <p className="text-[12.5px] font-bold opacity-90">Kaya is thinking…</p>}
      {unconfigured && <p className="text-[11px] opacity-80">AI not configured. Set ANTHROPIC_API_KEY in Vercel to enable.</p>}
      {error && (
        <>
          <p className="text-[12px] text-[#FAB8B8] font-bold mb-2">{error}</p>
          <button type="button" onClick={run} className="bg-pulse-gold text-pulse-navy font-nunito font-black text-[12px] px-3 py-1.5 rounded-full">Try again</button>
        </>
      )}
      {data && (
        <>
          <p className="text-[12.5px] font-bold leading-snug mb-2">{data.insight}</p>
          {data.tip && (
            <div className="bg-pulse-gold/20 border border-pulse-gold/40 rounded-xl px-3 py-2 mt-2">
              <p className="text-[11px] font-extrabold text-pulse-gold">💡 {data.tip}</p>
            </div>
          )}
          <button type="button" onClick={run}
            className="text-[10px] font-bold opacity-70 mt-2 underline">
            Refresh
          </button>
        </>
      )}
    </div>
  );
}
