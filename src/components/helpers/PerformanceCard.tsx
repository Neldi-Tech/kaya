'use client';

// Icon-first performance summary for a single helper. Designed so a
// low-literacy helper can read it at a glance:
//   - Big face emoji (😀 🙂 😐 🙁) keyed to the % bucket
//   - Big consolidated % (workplan + budget, equal-weighted today)
//   - Color-coded ring (green / amber / cream) matches the face tone
//   - Workplan + budget broken out as separate stat rows so the
//     parent + helper see exactly what's driving the score
//
// Loads its own data via getHelperPerformance — caller just passes
// familyId + helperUid. Returns null while loading so it can sit in
// a list without flashing empty state for each row.

import { useEffect, useState } from 'react';
import { Trophy, CheckCircle2, Wallet, ShoppingCart } from 'lucide-react';
import { getHelperPerformance, perfFace, type HelperPerformanceWindow } from '@/lib/helperPerformance';
import { formatCents } from '@/components/pantry/format';
import { useHive } from '@/contexts/HiveContext';

export default function PerformanceCard({
  familyId, helperUid, name, compact = false, days = 7,
}: {
  familyId: string;
  helperUid: string;
  name?: string;
  /** Compact mode — squeezes into a single-row format for list views. */
  compact?: boolean;
  days?: number;
}) {
  const [perf, setPerf] = useState<HelperPerformanceWindow | null>(null);
  const { config } = useHive();
  const currency = config.currency;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getHelperPerformance(familyId, helperUid, { days });
        if (!cancelled) setPerf(p);
      } catch {
        // Best-effort: a perf card that can't load shouldn't break
        // the surrounding page. Leave at null → caller renders empty.
      }
    })();
    return () => { cancelled = true; };
  }, [familyId, helperUid, days]);

  if (!perf) {
    return (
      <div className={`bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya ${compact ? 'p-3' : 'p-4'} animate-pulse text-xs text-kaya-sand`}>
        Loading performance…
      </div>
    );
  }

  // Headline = consolidated score (workplan avg + budget score).
  // Fallback to today's workplan when there's no window data yet
  // (brand-new helper on day one).
  const headlinePct = perf.consolidatedPct ?? perf.todayPct;
  const face = perfFace(headlinePct);
  const ring =
    face.tone === 'great' ? 'border-green-400 bg-green-50' :
    face.tone === 'ok'    ? 'border-kaya-gold bg-kaya-gold-light/30' :
    face.tone === 'low'   ? 'border-red-300 bg-red-50' :
                            'border-kaya-warm-dark bg-kaya-cream';
  const headline =
    face.tone === 'great' ? 'text-green-700' :
    face.tone === 'low'   ? 'text-red-700' :
                            'text-kaya-chocolate';

  if (compact) {
    // Compact subtitle lists the inputs that have data — a helper
    // with workplan + shops shows both; new helpers show only what
    // they've got.
    const subtitleBits: string[] = [];
    if (perf.avgPct !== null) subtitleBits.push(`Workplan ${perf.avgPct}%`);
    if (perf.budget.scorePct !== null) subtitleBits.push(`Budget ${perf.budget.scorePct}%`);
    return (
      <div className={`rounded-kaya border-2 ${ring} px-3 py-2 flex items-center gap-3`}>
        <span className="text-2xl flex-shrink-0" aria-hidden>{face.emoji}</span>
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-bold">
            {headlinePct === null ? 'No performance data yet' : (
              <>
                <span className={`text-base ${headline}`}>{headlinePct}%</span>
                <span className="text-kaya-sand"> overall · {face.label}</span>
              </>
            )}
          </p>
          <p className="text-[10px] text-kaya-sand mt-0.5">
            {subtitleBits.length === 0 ? `Nothing scheduled in last ${perf.days} days` : subtitleBits.join(' · ')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-kaya-lg border-2 ${ring} p-4`}>
      <div className="flex items-center gap-4">
        <span className="text-5xl flex-shrink-0" aria-hidden>{face.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand">
            {name ? `${name}'s performance` : 'Performance'}
          </p>
          <p className={`font-display font-black text-3xl ${headline} leading-none mt-1`}>
            {headlinePct === null ? '—' : `${headlinePct}%`}
          </p>
          <p className="text-xs text-kaya-sand mt-0.5">
            {headlinePct === null ? 'No data yet' : `Overall · ${face.label}`}
          </p>
        </div>
      </div>

      {/* Workplan stat row */}
      <div className="mt-3 pt-3 border-t border-kaya-warm-dark/30 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold inline-flex items-center gap-1">
            <Trophy size={11} /> Workplan
          </p>
          <p className="font-display font-bold text-lg mt-0.5">
            {perf.avgPct === null ? '—' : `${perf.avgPct}%`}
          </p>
          <p className="text-[10px] text-kaya-sand">
            avg across {perf.scheduledDays} day{perf.scheduledDays === 1 ? '' : 's'}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold inline-flex items-center gap-1">
            <CheckCircle2 size={11} /> Tasks done
          </p>
          <p className="font-display font-bold text-lg mt-0.5">
            {perf.tasksDone}<span className="text-kaya-sand text-sm font-normal"> / {perf.tasksScheduled}</span>
          </p>
          <p className="text-[10px] text-kaya-sand">
            in last {perf.days} days
          </p>
        </div>
      </div>

      {/* Budget stat row — separate visual block so the metric reads
          independently of workplan + the variance is obvious. */}
      {perf.budget.shopsCount > 0 ? (
        <div className="mt-2 pt-3 border-t border-kaya-warm-dark/30">
          <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold inline-flex items-center gap-1 mb-1">
            <Wallet size={11} /> Grocery budget
          </p>
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className="font-display font-bold text-lg">
              {perf.budget.scorePct ?? '—'}%
            </p>
            <p className="text-[11px] text-kaya-sand">
              <ShoppingCart size={10} className="inline mr-0.5" />
              {perf.budget.shopsCount} shop{perf.budget.shopsCount === 1 ? '' : 's'}
              {' · '}
              <span className={perf.budget.varianceCents > 0 ? 'text-red-600 font-bold' : 'text-green-700 font-bold'}>
                {perf.budget.varianceCents === 0 ? 'on budget' :
                 perf.budget.varianceCents < 0 ? `${formatCents(-perf.budget.varianceCents, currency)} under` :
                                                  `${formatCents(perf.budget.varianceCents, currency)} over`}
              </span>
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-2 pt-3 border-t border-kaya-warm-dark/30">
          <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold inline-flex items-center gap-1">
            <Wallet size={11} /> Grocery budget
          </p>
          <p className="text-[11px] text-kaya-sand mt-0.5">
            No shops closed in last {perf.days} days — budget metric will appear here
          </p>
        </div>
      )}
    </div>
  );
}
