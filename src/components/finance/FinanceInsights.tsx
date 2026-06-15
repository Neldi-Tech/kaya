'use client';

// AI Insights for Finances + Dashboard (2026-06-15) — PR 3.
//
// Two layers, cheap by design:
//   1. Deterministic insight cards computed from the trend series + range
//      roll-up — always present, no API call (biggest riser, best win,
//      anomaly vs trailing average, largest category share).
//   2. Ask Kaya — the existing on-tap Claude advisor (/api/pulse/advisor),
//      fed a trend-aware fact set. Runs only when the parent taps it.

import { useMemo } from 'react';
import { type PurchaseModule, MODULE_EMOJI, MODULE_LABEL } from '@/lib/purchase';
import { type ModuleSeries, lastTwoDeltas } from '@/lib/financeSeries';
import { formatCents } from '@/components/pantry/format';
import AskKaya from '@/components/pulse/AskKaya';

type Tone = 'hi' | 'win' | 'mid';
interface Insight { tone: Tone; emoji: string; title: string; body: string }

const DOT: Record<Tone, string> = { hi: '#E8806B', win: '#7FCF97', mid: '#D4A847' };

export default function FinanceInsights({
  familyId, series, modules, perModule, currency, periodLabel, monthKey,
}: {
  familyId: string;
  series: ModuleSeries;
  modules: PurchaseModule[];
  perModule: Record<PurchaseModule, { spent: number; cap: number }>;
  currency: string;
  periodLabel: string;
  monthKey: string;
}) {
  const fc = (c: number) => formatCents(c, currency);

  const { insights, facts } = useMemo(() => {
    const deltas = lastTwoDeltas(series, modules);
    const out: Insight[] = [];

    const riser = deltas.find((d) => d.deltaCents > 0);
    const win = [...deltas].sort((a, b) => a.deltaCents - b.deltaCents)[0];

    // Total + largest share across the range.
    const totalSpent = modules.reduce((a, m) => a + (perModule[m]?.spent ?? 0), 0);
    let shareLeader: PurchaseModule | null = null;
    for (const m of modules) {
      if (shareLeader == null || (perModule[m]?.spent ?? 0) > (perModule[shareLeader]?.spent ?? 0)) shareLeader = m;
    }
    const sharePct = shareLeader && totalSpent > 0
      ? Math.round(((perModule[shareLeader]?.spent ?? 0) / totalSpent) * 100) : 0;

    // Anomaly — latest month vs its own trailing average (excl. latest).
    let anomaly: { m: PurchaseModule; pct: number } | null = null;
    const n = series.months.length;
    if (n >= 3) {
      for (const m of modules) {
        const arr = series.perModule[m] ?? [];
        const latest = arr[n - 1] ?? 0;
        const past = arr.slice(0, n - 1);
        const avg = past.reduce((a, v) => a + v, 0) / Math.max(1, past.length);
        if (avg > 0 && latest > avg * 1.3) {
          const pct = Math.round(((latest - avg) / avg) * 100);
          if (!anomaly || pct > anomaly.pct) anomaly = { m, pct };
        }
      }
    }

    if (riser) {
      out.push({
        tone: 'hi', emoji: '⚡',
        title: `${MODULE_LABEL[riser.module]} is your fastest riser`,
        body: `Up ${fc(riser.deltaCents)}${riser.deltaPct != null ? ` (+${riser.deltaPct}%)` : ''} vs the previous month — the line to watch.`,
      });
    }
    if (win && win.deltaCents < 0) {
      out.push({
        tone: 'win', emoji: '✅',
        title: `${MODULE_LABEL[win.module]} is your big win`,
        body: `Down ${fc(Math.abs(win.deltaCents))}${win.deltaPct != null ? ` (${win.deltaPct}%)` : ''} vs the previous month. If it holds, that's banked.`,
      });
    }
    if (anomaly && anomaly.m !== riser?.module) {
      out.push({
        tone: 'hi', emoji: '📈',
        title: `${MODULE_LABEL[anomaly.m]} spiked vs its usual`,
        body: `This month is ${anomaly.pct}% above its recent average — worth a quick look.`,
      });
    }
    if (shareLeader && sharePct > 0) {
      out.push({
        tone: 'mid', emoji: '🧭',
        title: `${MODULE_LABEL[shareLeader]} is your biggest bucket`,
        body: `${sharePct}% of spend this period (${fc(perModule[shareLeader]?.spent ?? 0)}). The lever with the most room if you want to bank more.`,
      });
    }

    const factObj: Record<string, string | number> = {
      'Period': periodLabel,
      'Total spent': fc(totalSpent),
      'Biggest riser': riser ? `${MODULE_LABEL[riser.module]} +${fc(riser.deltaCents)}${riser.deltaPct != null ? ` (${riser.deltaPct}%)` : ''}` : 'none',
      'Biggest drop': win && win.deltaCents < 0 ? `${MODULE_LABEL[win.module]} ${fc(win.deltaCents)}${win.deltaPct != null ? ` (${win.deltaPct}%)` : ''}` : 'none',
      'Largest category': shareLeader ? `${MODULE_LABEL[shareLeader]} ${sharePct}%` : 'none',
    };
    if (anomaly) factObj['Anomaly'] = `${MODULE_LABEL[anomaly.m]} +${anomaly.pct}% vs average`;
    for (const m of modules) {
      const p = perModule[m];
      if (p && p.spent > 0) factObj[`${MODULE_LABEL[m]} spend/cap`] = `${fc(p.spent)} / ${p.cap > 0 ? fc(p.cap) : 'no cap'}`;
    }

    return { insights: out, facts: factObj };
  }, [series, modules, perModule, currency, periodLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {insights.length > 0 ? (
        <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg, #0F1F44, #1c3566)' }}>
          <div className="text-[11px] font-nunito font-black uppercase tracking-[1px]" style={{ color: '#D4A847' }}>
            🤖 What the numbers say · {periodLabel}
          </div>
          <div className="mt-2 space-y-2">
            {insights.map((it, i) => (
              <div key={i} className="rounded-xl bg-white/8 border border-white/10 p-3">
                <div className="flex items-center gap-2 font-nunito font-black text-[13.5px]">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: DOT[it.tone] }} />
                  {it.emoji} {it.title}
                </div>
                <p className="text-[12.5px] opacity-90 leading-snug mt-1 ml-[18px]">{it.body}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center text-hive-muted text-sm">
          Insights appear once there's a little spending history to compare.
        </div>
      )}

      <AskKaya
        familyId={familyId}
        monthKey={monthKey}
        monthLabel={periodLabel}
        currency={currency}
        facts={facts}
      />
    </div>
  );
}
