'use client';

// Icon-first performance summary for a single helper. v3 (2026-05-18)
// upgrades from 2 metrics to 4 + reads its face / ring tones from the
// family's PerformancePolicy thresholds.
//
//   1. ✅ Workplan completion
//   2. 💰 Grocery budget adherence
//   3. ⭐ Rating completion (morning/evening logs)
//   4. 👍 Parent feedback
//
// Loads its own data via getHelperPerformance — caller just passes
// familyId + helperUid. Returns null while loading so it can sit in
// a list without flashing empty state for each row.

import { useEffect, useState } from 'react';
import { Trophy, CheckCircle2, Wallet, ShoppingCart, Star, ThumbsUp } from 'lucide-react';
import { getHelperPerformance, perfFace, type HelperPerformanceWindow } from '@/lib/helperPerformance';
import { formatCents } from '@/components/pantry/format';
import { useHive } from '@/contexts/HiveContext';

export default function PerformanceCard({
  familyId, helperUid, name, compact = false, days,
}: {
  familyId: string;
  helperUid: string;
  name?: string;
  /** Compact mode — squeezes into a single-row format for list views. */
  compact?: boolean;
  /** Override the policy's default window. Omit to use family policy. */
  days?: number;
}) {
  const [perf, setPerf] = useState<HelperPerformanceWindow | null>(null);
  const { config } = useHive();
  const currency = config.currency;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getHelperPerformance(familyId, helperUid, days ? { days } : {});
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

  // Headline = consolidated score. Fallback to today's workplan when
  // there's no window data yet (brand-new helper on day one).
  const headlinePct = perf.consolidatedPct ?? perf.todayPct;
  const face = perfFace(headlinePct, perf.policy.thresholds);
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
    // Compact subtitle lists the inputs that have data + their
    // weighted contribution so a helper with a few inputs sees the
    // composition explicitly.
    const subtitleBits: string[] = [];
    if (perf.avgPct !== null) subtitleBits.push(`Workplan ${perf.avgPct}%`);
    if (perf.budget.scorePct !== null) subtitleBits.push(`Budget ${perf.budget.scorePct}%`);
    if (perf.ratingCompletion.scorePct !== null) subtitleBits.push(`Ratings ${perf.ratingCompletion.scorePct}%`);
    if (perf.feedback.scorePct !== null) subtitleBits.push(`Feedback ${perf.feedback.scorePct}%`);
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

      {/* Four metric stat rows — 2 × 2 grid on desktop, stacked on
          mobile via flex-wrap. Each card shows its score, the raw
          inputs that produced it, and a small "excluded" pill when
          the metric is turned off for this helper via policy. */}
      <div className="mt-3 pt-3 border-t border-kaya-warm-dark/30 grid grid-cols-2 gap-3">
        <MetricBlock
          icon={<Trophy size={11} />}
          label="Workplan"
          value={perf.avgPct === null ? '—' : `${perf.avgPct}%`}
          subtitle={perf.scheduledDays > 0
            ? `avg across ${perf.scheduledDays} day${perf.scheduledDays === 1 ? '' : 's'}`
            : 'no scheduled tasks'}
          excluded={perf.excludedMetrics.includes('workplan')}
          weight={perf.policy.weights.workplan}
        />
        <MetricBlock
          icon={<CheckCircle2 size={11} />}
          label="Tasks done"
          value={`${perf.tasksDone} / ${perf.tasksScheduled}`}
          subtitle={`in last ${perf.days} days`}
        />
        <MetricBlock
          icon={<Star size={11} />}
          label="Ratings"
          value={perf.ratingCompletion.scorePct === null ? '—' : `${perf.ratingCompletion.scorePct}%`}
          subtitle={perf.ratingCompletion.expected > 0
            ? `${perf.ratingCompletion.logged} / ${perf.ratingCompletion.expected} logged`
            : 'no expectation set'}
          excluded={perf.excludedMetrics.includes('ratingCompletion')}
          weight={perf.policy.weights.ratingCompletion}
        />
        <MetricBlock
          icon={<ThumbsUp size={11} />}
          label="Feedback"
          value={perf.feedback.scorePct === null ? '—' : `${perf.feedback.scorePct}%`}
          subtitle={perf.feedback.notesCount > 0
            ? `👍 ${perf.feedback.positive} · 😐 ${perf.feedback.neutral} · 👎 ${perf.feedback.negative}`
            : 'no notes from parent yet'}
          excluded={perf.excludedMetrics.includes('parentFeedback')}
          weight={perf.policy.weights.parentFeedback}
        />
      </div>

      {/* Budget block — stays full-width below the grid because the
          variance line needs more room than the other metrics. */}
      {perf.budget.shopsCount > 0 ? (
        <div className="mt-3 pt-3 border-t border-kaya-warm-dark/30">
          <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold inline-flex items-center gap-1 mb-1">
            <Wallet size={11} /> Grocery budget
            {perf.excludedMetrics.includes('budget') && (
              <span className="ml-1 normal-case tracking-normal text-kaya-sand/80 italic">(excluded)</span>
            )}
            {!perf.excludedMetrics.includes('budget') && perf.policy.weights.budget !== 25 && (
              <span className="ml-1 normal-case tracking-normal text-kaya-sand/80">· {perf.policy.weights.budget}% weight</span>
            )}
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
        <div className="mt-3 pt-3 border-t border-kaya-warm-dark/30">
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

// ── Tiny metric block used in the 2x2 grid ───────────────────────
function MetricBlock({
  icon, label, value, subtitle, excluded, weight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
  excluded?: boolean;
  /** Policy weight (0-100). Shown as a small chip when non-default,
   *  so parents see "this metric is weighted 35%" without opening
   *  Settings. Omitted to skip the chip (e.g. info-only blocks like
   *  Tasks done). */
  weight?: number;
}) {
  return (
    <div className={excluded ? 'opacity-50' : ''}>
      <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold inline-flex items-center gap-1">
        {icon} {label}
        {excluded && (
          <span className="ml-1 normal-case tracking-normal italic text-[9px]">n/a</span>
        )}
        {weight != null && weight !== 25 && !excluded && (
          <span className="ml-1 normal-case tracking-normal text-kaya-sand/80 text-[9px]">· {weight}%</span>
        )}
      </p>
      <p className="font-display font-bold text-lg mt-0.5">{value}</p>
      <p className="text-[10px] text-kaya-sand">{subtitle}</p>
    </div>
  );
}
