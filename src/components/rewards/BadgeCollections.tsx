'use client';

// ✨ Collection meters (BDG PR5 · B22) — "✨ Sparks set: 2/4 — complete the
// set!" per area, plus the evolving I → II → III ladders. Completing an area
// mints its 💎 Collector badge (verified server-side in /api/badges/mint), so
// the meter is a real promise, not decoration.

import { useMemo } from 'react';
import type { Child } from '@/lib/firestore';
import {
  BADGE_AREAS, SET_META, SET_RING, ROMAN,
  areaCollection, setProgress, familyBadgeSet, isBadgeReleased,
  type BadgeConfig,
} from '@/lib/badgeLib';

export default function BadgeCollections({ cfg, child }: { cfg: BadgeConfig | undefined; child: Child }) {
  const areas = useMemo(() => BADGE_AREAS
    .map((a) => ({ ...a, col: areaCollection(cfg, a.id, child.badges) }))
    .filter((a) => a.col.need > 0), [cfg, child.badges]);

  // Only sets the family has actually released, in catalog order.
  const sets = useMemo(() => {
    const ids: string[] = [];
    for (const b of familyBadgeSet(cfg)) {
      if (b.set && isBadgeReleased(cfg, b) && !ids.includes(b.set.id)) ids.push(b.set.id);
    }
    return ids.map((id) => ({ id, ...setProgress(cfg, id, child.badges) }))
      .filter((s) => s.levels.length > 1);
  }, [cfg, child.badges]);

  if (areas.length === 0) return null;

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya lg:rounded-kaya-lg p-4 lg:p-5">
      <p className="font-display text-[15px] lg:text-base font-black mb-1">✨ Collections</p>
      <p className="text-[11.5px] text-kaya-sand mb-3">
        Finish every badge in an area to earn its 💎 Collector badge.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {areas.map((a) => (
          <div
            key={a.id}
            className={`rounded-kaya p-3 border ${a.col.complete ? 'border-kaya-gold/60 bg-kaya-gold/5' : 'border-kaya-warm-dark/50 bg-kaya-warm/25'}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[12.5px] font-bold">{a.emoji} {a.label} set</p>
              <p className="text-[11.5px] font-black tabular-nums" style={{ color: a.col.complete ? '#F0A32A' : undefined }}>
                {a.col.have}/{a.col.need}
              </p>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-kaya-warm-dark/50 overflow-hidden">
              <div className="h-full rounded-full bg-kaya-gold" style={{ width: `${a.col.pct}%` }} />
            </div>
            <p className="mt-1 text-[10.5px] font-bold text-kaya-sand">
              {a.col.complete ? '💎 Complete — Collector earned!' : `${a.col.need - a.col.have} to go — complete the set!`}
            </p>
          </div>
        ))}
      </div>

      {/* ✨ Evolving ladders — same badge, richer shell each level */}
      {sets.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-kaya-sand mb-2">Evolving sets</p>
          <div className="space-y-2">
            {sets.map((s) => (
              <div key={s.id} className="flex items-center gap-2.5">
                <p className="text-[12px] font-bold w-28 shrink-0 truncate">
                  {SET_META[s.id]?.emoji} {SET_META[s.id]?.label ?? s.id}
                </p>
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  {s.levels.map((l, i) => (
                    <div key={l.def.id} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-[10px] text-kaya-sand">→</span>}
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-black"
                        style={l.earned
                          ? { border: `1.5px solid ${SET_RING[l.def.set!.level]}`, color: SET_RING[l.def.set!.level] }
                          : { border: '1.5px dashed #d8cfc0', color: '#9c9384' }}
                        title={`${l.def.name} — ${l.def.how}`}
                      >
                        <span className={l.earned ? '' : 'grayscale opacity-70'}>{l.def.icon}</span>
                        {ROMAN[l.def.set!.level]}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10.5px] font-bold text-kaya-sand shrink-0">
                  {s.highest > 0 ? `at ${ROMAN[s.highest as 1 | 2 | 3]}` : 'not started'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
