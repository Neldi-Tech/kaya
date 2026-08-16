'use client';

// Kaya Sparks · the parent pulse (B6).
//
// Parents got no Sparks signal on their own home, so they never
// prompted the kid, and the loop never closed. One line per child —
// streak, what's still open, and whether anything is waiting on the
// parent — each tapping straight into that exact queue.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { subscribeSparksToday, type SparksToday } from '@/lib/sparks/quests';
import { fetchTreasuresToday, type TreasuresToday } from '@/lib/sparks/treasures';

interface Kid { id: string; name: string; avatarEmoji?: string }

export default function SparksParentPulse({ familyId, kids }: {
  familyId: string;
  kids: Kid[];
}) {
  if (!familyId || kids.length === 0) return null;
  return (
    <div className="rounded-[18px] border border-[#ECE4D3] bg-white p-4">
      <div className="font-display font-extrabold text-[12px] tracking-[0.5px] text-[#5A6488] uppercase mb-2.5">
        ✨ Sparks today
      </div>
      <div className="grid gap-1.5">
        {kids.map((k) => <PulseRow key={k.id} familyId={familyId} kid={k} />)}
      </div>
    </div>
  );
}

function PulseRow({ familyId, kid }: { familyId: string; kid: Kid }) {
  const [t, setT] = useState<SparksToday | null>(null);
  // 💎 Treasures joins the pulse (D23) — a parent who can see the check
  // slipping is a parent who prompts, and the loop closes.
  const [tr, setTr] = useState<TreasuresToday | null>(null);

  useEffect(() => {
    if (!familyId || !kid.id) return;
    return subscribeSparksToday(familyId, kid.id, setT);
  }, [familyId, kid.id]);

  useEffect(() => {
    if (!kid.id) return;
    let dead = false;
    fetchTreasuresToday(kid.id)
      .then((r) => { if (!dead) setTr(r); })
      .catch(() => { if (!dead) setTr(null); });
    return () => { dead = true; };
  }, [kid.id]);

  const treasureLine = !tr
    ? ''
    : tr.check.due
      ? (tr.check.overdueDays >= 1
          ? ` · 🔑 check ${tr.check.overdueDays}d overdue`
          : ' · 🔑 check due')
      : tr.missing > 0
        ? ` · 🔍 ${tr.missing} missing`
        : '';

  const clear = !!t && t.openCount === 0 && !treasureLine;
  const summary = !t
    ? '…'
    : clear
      ? 'all caught up'
      : `${t.openCount} still open`;

  return (
    <Link
      href={`/sparks/${kid.id}`}
      className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-[#F3EEE2] bg-[#FDFCF8] no-underline hover:border-[#D4A847] transition-colors"
    >
      <span className="text-[15px]" aria-hidden>{kid.avatarEmoji || '🧒'}</span>
      <span className="font-display font-extrabold text-[12.5px] text-[#0F1F44] min-w-0 truncate">
        {kid.name}
      </span>
      <span className="text-[11.5px] text-[#5A6488] flex-1 min-w-0 truncate">
        {t && t.bestStreak > 0 ? `🔥${t.bestStreak} · ` : ''}{summary}{treasureLine}
      </span>
      {t && !clear && (
        <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#DFE3FB] text-[#3B2E86] whitespace-nowrap">
          {t.openCount}
        </span>
      )}
      {clear && <span className="text-[13px]" aria-hidden>✅</span>}
    </Link>
  );
}
