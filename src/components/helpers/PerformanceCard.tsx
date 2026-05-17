'use client';

// Icon-first performance summary for a single helper. Designed so a
// low-literacy helper can read it at a glance:
//   - Big face emoji (😀 🙂 😐 🙁) keyed to the % bucket
//   - Two large numbers (today + 7-day avg)
//   - Color-coded ring (green / amber / cream) matches the face tone
//
// Loads its own data via getHelperPerformance — caller just passes
// familyId + helperUid. Returns null while loading so it can sit in
// a list without flashing empty state for each row.

import { useEffect, useState } from 'react';
import { Trophy, CheckCircle2 } from 'lucide-react';
import { getHelperPerformance, perfFace, type HelperPerformanceWindow } from '@/lib/helperPerformance';

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getHelperPerformance(familyId, helperUid, { days });
        if (!cancelled) setPerf(p);
      } catch {
        // Best-effort: a perf card that can't load shouldn't break the
        // surrounding page. Leave at null → caller renders nothing.
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

  // The headline number — prefer today (most actionable), fall back
  // to the window average when today wasn't scheduled.
  const headlinePct = perf.todayPct ?? perf.avgPct;
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
    return (
      <div className={`rounded-kaya border-2 ${ring} px-3 py-2 flex items-center gap-3`}>
        <span className="text-2xl flex-shrink-0" aria-hidden>{face.emoji}</span>
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-bold">
            {headlinePct === null ? 'No tasks scheduled today' : (
              <>
                <span className={`text-base ${headline}`}>{headlinePct}%</span>
                <span className="text-kaya-sand"> today · {face.label}</span>
              </>
            )}
          </p>
          <p className="text-[10px] text-kaya-sand mt-0.5">
            {perf.avgPct !== null ? `Last ${perf.days} days: ${perf.avgPct}% avg` : `No scheduled days in last ${perf.days}`}
            {' · '}{perf.tasksDone}/{perf.tasksScheduled} tasks
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
            {headlinePct === null ? 'No tasks scheduled today' : `Today · ${face.label}`}
          </p>
        </div>
      </div>

      {/* Two-up stat row */}
      <div className="mt-3 pt-3 border-t border-kaya-warm-dark/30 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold inline-flex items-center gap-1">
            <Trophy size={11} /> Last {perf.days} days
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
    </div>
  );
}
