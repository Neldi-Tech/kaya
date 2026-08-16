'use client';

// ⏰ The kid's own Catch-Up strip (approved design 2026-08-10 · CU-3).
//
// Shown on the kid's My Day and under My Stats. Their OWN data only —
// each row taps straight into the REAL task (workplan / reflection /
// quest / treasures), so the strip never becomes a second checklist.
// When the family visibility switch is 'family' (parent-controlled,
// Reminders board header), Stats also shows siblings' On-Track chips —
// scores only, never each other's item details.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFamily } from '@/contexts/FamilyContext';
import {
  computeKidCatchUps, computeFamilyCatchUps, scoreMeta,
  type KidCatchUps,
} from '@/lib/catchUpBoard';

const SCORE_CLS: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-600',
  none: 'bg-kaya-warm text-kaya-sand',
};

export default function CatchUpStrip({ childId, showFamilyScores = false, className = '' }: {
  childId: string;
  /** Stats surface: sibling score chips when the family switch allows. */
  showFamilyScores?: boolean;
  className?: string;
}) {
  const { family, children } = useFamily();
  const [mine, setMine] = useState<KidCatchUps | null>(null);
  const [sibs, setSibs] = useState<KidCatchUps[] | null>(null);

  const familyWide = family?.catchUpVisibility === 'family';

  useEffect(() => {
    if (!family?.id) return;
    const me = children.find((c) => c.id === childId);
    if (!me) return;
    let dead = false;
    computeKidCatchUps(family.id, { id: me.id, name: me.name, avatarEmoji: me.avatarEmoji })
      .then((r) => { if (!dead) setMine(r); })
      .catch(() => { if (!dead) setMine(null); });
    if (showFamilyScores && familyWide && children.length > 1) {
      computeFamilyCatchUps(family.id, children.filter((c) => c.id !== childId)
        .map((c) => ({ id: c.id, name: c.name, avatarEmoji: c.avatarEmoji })))
        .then((r) => { if (!dead) setSibs(r); })
        .catch(() => { if (!dead) setSibs(null); });
    }
    return () => { dead = true; };
  }, [family?.id, childId, children, showFamilyScores, familyWide]);

  if (!mine) return null;
  const meta = scoreMeta(mine.onTrackPct);
  const firstName = mine.name.split(' ')[0];

  // Nothing due at all — stay invisible rather than show an empty card.
  if (mine.onTrackPct == null && mine.items.length === 0) return null;

  return (
    <div className={`bg-kaya-cream border-2 border-kaya-gold/70 rounded-kaya-lg p-4 ${className}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-display font-black text-[14px] flex-1">⏰ Your catch-ups, {firstName}</p>
        <span className={`text-[11.5px] font-black px-2.5 py-1 rounded-full ${SCORE_CLS[meta.cls]}`}>
          {meta.emoji} {meta.label}
        </span>
      </div>

      {mine.items.length === 0 ? (
        <p className="text-[12.5px] text-kaya-chocolate mt-2">
          ✨ All caught up{mine.cleared > 0 ? ` — and you cleared ${mine.cleared} this week. 👏` : ' — keep the rhythm going!'}
        </p>
      ) : (
        <>
          {mine.cleared > 0 && (
            <p className="text-[11.5px] font-bold text-emerald-700 mt-1.5">👏 You already cleared {mine.cleared} this week — these are what&apos;s left:</p>
          )}
          {mine.cleared === 0 && (
            <p className="text-[11.5px] text-kaya-sand mt-1">Clear these and your Sunday shines ✨</p>
          )}
          <div className="mt-1.5">
            {mine.items.map((item) => (
              <Link key={item.key} href={item.href}
                className="flex items-center gap-2.5 py-2 border-t border-dashed border-kaya-warm-dark text-[12.5px] hover:bg-kaya-gold/10 rounded-kaya-sm px-1 transition-colors">
                <span className="w-[18px] h-[18px] border-2 border-kaya-sand rounded-md shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="mr-1">{item.icon}</span>
                  <b>{item.label}</b>
                  {item.streak && item.streak >= 2 ? <span className="text-kaya-sand"> · {item.streak} days waiting</span> : null}
                </span>
                <span className="text-kaya-sand shrink-0">→</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {showFamilyScores && familyWide && sibs && sibs.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-kaya-warm-dark">
          <p className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-kaya-sand mb-1.5">👨‍👩‍👧 How the family is tracking</p>
          <div className="flex gap-1.5 flex-wrap">
            {sibs.map((s) => {
              const m = scoreMeta(s.onTrackPct);
              return (
                <span key={s.childId} className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full ${SCORE_CLS[m.cls]}`}>
                  {s.emoji} {s.name.split(' ')[0]} · {m.emoji} {s.onTrackPct == null ? '—' : `${s.onTrackPct}%`}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
