'use client';

// 🤝 Helper Recognition tab (HR PR-1) — the 5-dial scorecard for one
// helper, parent-only, living beside Today / Fill / Score / Reviews on
// the workplan page. The dials feed reward & recognition planning; the
// monthly helper round + Asante card land in HR PR-2/3.

import { useEffect, useState } from 'react';
import { computeHelperDials, DIAL_META, dialColor, type HelperDials } from '@/lib/helperRecognition';
import type { HelperLink } from '@/lib/firestore';

export default function HelperRecognitionTab({ helper, familyId }: {
  helper: HelperLink;
  familyId: string;
}) {
  const [dials, setDials] = useState<HelperDials | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    setState('loading');
    computeHelperDials(familyId, helper.uid)
      .then((d) => { if (alive) { setDials(d); setState('ready'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [familyId, helper.uid]);

  if (state === 'loading') {
    return <p className="text-[12.5px] text-hive-muted py-4">Reading {helper.displayName.split(' ')[0]}&apos;s last 4 weeks…</p>;
  }
  if (state === 'error' || !dials) {
    return <p className="text-[12.5px] text-hive-muted py-4">Could not compute the scorecard — try again shortly.</p>;
  }

  const first = helper.displayName.split(' ')[0];
  return (
    <div className="space-y-3">
      {/* Composite */}
      <div className="flex items-center gap-3 bg-white border border-hive-line rounded-hive p-3">
        <span className="font-nunito font-black text-3xl" style={{ color: dialColor(dials.score) }}>
          {dials.score === null ? '—' : dials.score}
        </span>
        <div className="min-w-0">
          <p className="font-nunito font-extrabold text-[13px]">🤝 Helper Score · last 4 weeks</p>
          <p className="text-[11px] text-hive-muted">Weighted blend of the five dials below (missing dials sit out, weights renormalise).</p>
        </div>
      </div>

      {/* The five dials */}
      <div className="bg-white border border-hive-line rounded-hive p-3 space-y-1.5">
        {DIAL_META.map((m) => {
          const v = dials[m.key];
          return (
            <div key={m.key} className="flex items-center gap-2.5">
              <span className="w-40 shrink-0 text-[12px] font-nunito font-extrabold">{m.emoji} {m.label}</span>
              <div className="flex-1 h-2 rounded-full bg-hive-cream overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${v ?? 0}%`, background: dialColor(v) }} />
              </div>
              <span className="w-9 text-right text-[12px] font-nunito font-black" style={{ color: dialColor(v) }}>
                {v === null ? '—' : v}
              </span>
              <span className="w-8 text-[9px] text-hive-muted font-bold text-right">×{m.weight}</span>
            </div>
          );
        })}
      </div>

      {/* Facts — the WHY behind the two new dials */}
      <div className="bg-hive-cream/60 border border-dashed border-hive-line rounded-hive p-3 text-[11.5px] text-hive-ink space-y-1">
        <p>🎯 <b>Strictness:</b> {dials.facts.rated} routines rated — {dials.facts.excellent} Excellent · {dials.facts.good} Good · {dials.facts.bad} Bad.{' '}
          {dials.strictness === null
            ? 'Not enough ratings yet to judge honesty (needs 10+).'
            : dials.strictness >= 85
              ? `Healthy, honest mix — ${first} rates what they actually see.`
              : 'Almost everything is Excellent — worth a chat about honest differentiation.'}
        </p>
        <p>✍️ <b>Corrections:</b>{' '}
          {dials.facts.bad === 0
            ? 'No Bad ratings in the window — nothing needed explaining.'
            : `${dials.facts.badWithNote} of ${dials.facts.bad} Bad ratings carried a note that teaches the kid${dials.corrections !== null && dials.corrections < 70 ? ' — remind ' + first + ' that the details matter to the kids' : ' — exactly the coaching kids need'}.`}
        </p>
        <p className="text-hive-muted">📅 Consistency, 🧹 Workplan and 💬 Kids&apos; voice come from the weekly performance snapshots ({dials.facts.weeks} week{dials.facts.weeks === 1 ? '' : 's'} read).</p>
      </div>

      <p className="text-[10.5px] text-hive-muted">
        🌟 The monthly helper round (first Monday) proposes recognition from these dials — Asante card, gift advisor and Payroll-sealed bonuses ride the next update.
      </p>
    </div>
  );
}
