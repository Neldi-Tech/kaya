'use client';

// AskKaya — the on-demand Pulse AI advisor card (§2b). Parent-only.
// Calls /api/pulse/advisor with the month's pre-formatted facts and shows
// a plain-language insight + a concrete action. Cached per month in
// localStorage so repeat Dashboard opens are free; "Refresh" re-runs it.

import { useEffect, useState } from 'react';

const NAVY = '#0F1F44';
const GOLD = '#D4A847';

interface Advice { insight: string; action: string; ts: number }

export default function AskKaya({ familyId, monthKey, monthLabel, currency, facts }: {
  familyId: string;
  monthKey: string;            // YYYY-MM
  monthLabel: string;
  currency: string;
  facts: Record<string, string | number>;
}) {
  const cacheKey = `kaya:pulse:advice:${familyId}:${monthKey}`;
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  // Load any cached advice for this month on mount / month change.
  useEffect(() => {
    setAdvice(null); setError(null); setUnconfigured(false);
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) setAdvice(JSON.parse(raw) as Advice);
    } catch { /* ignore */ }
  }, [cacheKey]);

  const run = async () => {
    setLoading(true); setError(null); setUnconfigured(false);
    try {
      const res = await fetch('/api/pulse/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency, monthLabel, facts }),
      });
      const json = await res.json();
      if (json?.skipped) { setUnconfigured(true); return; }
      if (!res.ok) { setError(json?.error || 'Could not get advice.'); return; }
      const next: Advice = { insight: json.insight || '', action: json.action || '', ts: Date.now() };
      setAdvice(next);
      try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* ignore */ }
    } catch {
      setError('Could not reach the advisor. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl p-4 mt-3 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, #1c3566)` }}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-nunito font-black uppercase tracking-[1px]" style={{ color: GOLD }}>
          🤖 Ask Kaya
        </div>
        {(advice || error) && !loading && (
          <button onClick={run} className="text-[10px] font-black opacity-90 hover:opacity-100">↻ Refresh</button>
        )}
      </div>

      {!advice && !loading && !error && !unconfigured && (
        <>
          <p className="text-[12px] opacity-90 mt-1 leading-snug">
            Get a plain-language read of where this month&apos;s money is going + one thing to do about it.
          </p>
          <button
            onClick={run}
            className="mt-3 w-full rounded-xl py-2.5 font-nunito font-black text-[13px]"
            style={{ background: GOLD, color: '#3a2c08' }}
          >
            Get advice
          </button>
          <p className="text-[9px] opacity-70 text-center mt-2">Runs on tap (Claude) — not on every load, to keep it cheap.</p>
        </>
      )}

      {loading && (
        <p className="text-[13px] opacity-90 mt-2 animate-pulse">Kaya is reading your month…</p>
      )}

      {unconfigured && (
        <p className="text-[12px] opacity-90 mt-2 leading-snug">
          The AI advisor isn&apos;t switched on yet. Add an <code className="bg-white/15 px-1 rounded">ANTHROPIC_API_KEY</code> to enable &quot;Ask Kaya&quot;.
        </p>
      )}

      {error && !loading && (
        <p className="text-[12px] mt-2 leading-snug" style={{ color: '#FFD7D7' }}>⚠ {error}</p>
      )}

      {advice && !loading && (
        <div className="mt-2 space-y-2">
          <div className="rounded-xl bg-white/10 p-3">
            <div className="text-[9px] font-black uppercase tracking-[1px] opacity-80">Insight</div>
            <p className="text-[12.5px] leading-snug mt-1">{advice.insight}</p>
          </div>
          {advice.action && (
            <div className="rounded-xl bg-white/10 p-3">
              <div className="text-[9px] font-black uppercase tracking-[1px]" style={{ color: GOLD }}>💡 Suggested action</div>
              <p className="text-[12.5px] leading-snug mt-1">{advice.action}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
