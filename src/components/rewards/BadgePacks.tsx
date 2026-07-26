'use client';

// 🎁 Badge Packs (BDG PR5 · B20) — the rail on top of the Boutique. Curated
// seasonal bundles a parent releases with ONE tap. A pack with a window is
// limited-time: the ⏳ chip is honest because the mint route enforces the same
// window server-side, so missing the season really does mean missing the
// badge.
//
// Releasing a pack writes released:true for each of its badges; releasing it
// again while already open retires the pack (one control, no dead state).

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily } from '@/lib/firestore';
import { BADGE_PACKS, isBadgeReleased, badgeById, isBadgeInSeason, type BadgeConfig } from '@/lib/badgeLib';
import { localTodayKey } from '@/lib/badgeEngine';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "08-01" → "1 Aug" */
function md(key: string): string {
  const [m, d] = key.split('-');
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1] ?? ''}`.trim();
}

export default function BadgePacks() {
  const { profile } = useAuth();
  const { family, refresh } = useFamily();
  const cfg: BadgeConfig | undefined = family?.badgeConfig;
  const [busy, setBusy] = useState<string | null>(null);
  const today = localTodayKey();

  const release = async (packId: string, on: boolean) => {
    const pack = BADGE_PACKS.find((p) => p.id === packId);
    if (!pack || !profile?.familyId || busy) return;
    setBusy(packId);
    try {
      const released = { ...(cfg?.released ?? {}) };
      for (const id of pack.badgeIds) {
        // Only touch badges that actually exist in this family's set.
        if (badgeById(cfg, id)) released[id] = on;
      }
      await updateFamily(profile.familyId, { badgeConfig: { ...(cfg ?? {}), released } } as any);
      await refresh?.();
    } finally { setBusy(null); }
  };

  return (
    <div className="mb-4">
      <p className="text-[11.5px] font-black mb-2" style={{ color: '#F0A32A' }}>
        🎁 Badge Packs <span className="font-bold" style={{ color: '#d9c89a' }}>— release a whole season with one tap</span>
      </p>
      <div className="flex gap-2.5 overflow-x-auto pb-1.5">
        {BADGE_PACKS.map((pack) => {
          const known = pack.badgeIds.filter((id) => badgeById(cfg, id));
          const openCount = known.filter((id) => isBadgeReleased(cfg, badgeById(cfg, id)!)).length;
          const allOpen = known.length > 0 && openCount === known.length;
          const inSeason = pack.window ? isBadgeInSeason(pack.badgeIds[0], today) : true;
          return (
            <div
              key={pack.id}
              className="shrink-0 rounded-2xl p-3 text-white"
              style={{ minWidth: 186, background: pack.gradient }}
            >
              <p className="text-[12.5px] font-black leading-tight">{pack.emoji} {pack.name}</p>
              <p className="text-[10px] font-semibold mt-0.5" style={{ opacity: 0.85 }}>
                {known.length} badge{known.length === 1 ? '' : 's'} · {pack.blurb}
              </p>
              {pack.window && (
                <p className="text-[10px] font-bold mt-1" style={{ opacity: 0.95 }}>
                  ⏳ {md(pack.window.from)} – {md(pack.window.to)}
                  {inSeason ? ' · earnable now' : ' · out of season'}
                </p>
              )}
              <button
                type="button"
                disabled={busy === pack.id || known.length === 0}
                onClick={() => void release(pack.id, !allOpen)}
                className="mt-2 w-full rounded-full px-2.5 py-1 text-[10.5px] font-black"
                style={allOpen
                  ? { background: 'rgba(255,255,255,.22)', color: '#fff' }
                  : { background: '#fff', color: pack.ink }}
              >
                {busy === pack.id ? 'Saving…' : allOpen ? '✓ released · retire' : `Release all ＋`}
              </button>
              {!allOpen && openCount > 0 && (
                <p className="text-[9.5px] font-bold mt-1" style={{ opacity: 0.85 }}>{openCount} of {known.length} already open</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
