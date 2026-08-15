'use client';

// Kaya Sparks · the live nav badge (B3).
//
// "Kaya Sparks" as a bare label tells a kid nothing about whether
// anything is waiting inside. A number that changes is what earns a tap.
//
// Two states, both honest:
//   · something open  → the count, in the accent colour
//   · nothing open    → 🔥 the streak, if there is one, quietly
// Nothing at all when there's neither, because a permanent badge is
// just decoration and stops being read within a week.

import { useEffect, useState } from 'react';
import { subscribeSparksToday, type SparksToday } from '@/lib/sparks/quests';

export default function SparksNavBadge({ familyId, kidId, active }: {
  familyId: string;
  kidId: string;
  /** The row is the current page — invert the colours so it stays legible. */
  active?: boolean;
}) {
  const [t, setT] = useState<SparksToday | null>(null);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeSparksToday(familyId, kidId, setT);
  }, [familyId, kidId]);

  if (!t) return null;

  if (t.openCount > 0) {
    return (
      <span
        className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
          active ? 'bg-white text-kaya-chocolate' : 'bg-[#3B2E86] text-white'
        }`}
      >
        {t.openCount}
      </span>
    );
  }

  if (t.bestStreak > 0) {
    return (
      <span
        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
          active ? 'bg-white/20 text-kaya-gold-light' : 'bg-[#FFF1C9] text-[#8A6800]'
        }`}
      >
        🔥{t.bestStreak}
      </span>
    );
  }

  return null;
}
