'use client';

// Kaya Sparks · Treasures — the Keeper Check as a real to-do.
//
// D23 (Elia, 16-Aug-2026): "in the my day OR workplan, resurface it —
// reminder per week, 2x month etc for kids to check. If they miss, then
// the alert goes up so that they don't miss."
//
// So this is deliberately NOT a passive tile. It mounts on BOTH My Day
// and the kid's Workplan, renders nothing at all when there is nothing
// due, and clears from both surfaces the moment the check is completed.
// A module that only lives behind its own nav row is a module families
// forget — and a check nobody is reminded of is a check nobody does.
//
// The urgency shows in the colour, never in the words: amber on the due
// day, red once it's slipping. The copy stays "let's check your things"
// at every rung, and nothing is ever deducted (D7).

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchTreasuresToday, type TreasuresToday } from '@/lib/sparks/treasures';

interface Props {
  kidId: string;
  kidName: string;
  /** 'card' = the standalone deck card (My Day / Workplan).
   *  'row'  = the compact line used inside the Sparks Today strip. */
  variant?: 'card' | 'row';
}

export default function KeeperCheckTodo({ kidId, kidName, variant = 'card' }: Props) {
  const [t, setT] = useState<TreasuresToday | null>(null);

  useEffect(() => {
    if (!kidId) return;
    let dead = false;
    fetchTreasuresToday(kidId)
      .then((r) => { if (!dead) setT(r); })
      .catch(() => { if (!dead) setT(null); });
    return () => { dead = true; };
  }, [kidId]);

  // Nothing due, nothing missing, nothing owed back — render nothing.
  // An always-present card is how a surface stops being read.
  if (!t) return null;
  const slipping = t.check.due && t.check.overdueDays >= 1;
  const show = t.check.due || t.missing > 0 || t.dueBack > 0;
  if (!show) return null;

  const href = t.check.due
    ? `/sparks/${kidId}/treasures/check`
    : `/sparks/${kidId}/treasures`;

  const title = t.check.due
    ? '🔑 Keeper Check'
    : t.missing > 0
      ? '🔍 Something’s still missing'
      : '🤝 Due back today';

  const body = t.check.due
    ? `${t.check.items} thing${t.check.items === 1 ? '' : 's'} to tap · about 30 seconds${
        slipping ? ` · ${t.check.overdueDays} day${t.check.overdueDays === 1 ? '' : 's'} ago` : ''
      }`
    : t.missing > 0
      ? `${t.missing} thing${t.missing === 1 ? '' : 's'} to find — let’s retrace ${t.missing === 1 ? 'it' : 'them'}`
      : `${t.dueBack} thing${t.dueBack === 1 ? '' : 's'} you lent out ${t.dueBack === 1 ? 'is' : 'are'} due back`;

  if (variant === 'row') {
    return (
      <Link
        href={href}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl no-underline border ${
          slipping ? 'bg-white border-[#F0C9CC]' : 'bg-white border-[#BFE3D8]'
        }`}
      >
        <span className="text-[15px]" aria-hidden>🔑</span>
        <span className="text-[12.5px] flex-1 min-w-0 truncate font-bold text-[#0F1F44]">
          {t.check.due ? 'Keeper Check' : title.replace(/^\S+\s/, '')}
        </span>
        <span className="text-[#0E6B5E] font-bold" aria-hidden>›</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`block rounded-[18px] border p-4 no-underline transition-colors ${
        slipping
          ? 'border-[#F0C9CC] bg-[#FEF6F6] hover:border-[#C0392B]'
          : t.check.due
            ? 'border-[#EFD9A0] bg-[#FFF9EF] hover:border-[#D4A847]'
            : 'border-[#BFE3D8] bg-[#F1FAF7] hover:border-[#0E6B5E]'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-10 h-10 rounded-[13px] grid place-items-center text-lg shrink-0"
          style={{ background: '#E2F3EE', color: '#0E6B5E' }}
          aria-hidden
        >
          💎
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-extrabold text-[14px] text-[#0F1F44] leading-tight">
            {title}
          </div>
          <div className="text-[11.5px] text-[#5A6488] mt-0.5 leading-snug">{body}</div>
        </div>
        {t.check.due && (
          <span
            className="text-[11px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap"
            style={
              slipping
                ? { background: '#FDE8E8', color: '#C0392B' }
                : { background: '#FFF1C9', color: '#8A6800' }
            }
          >
            {slipping ? 'overdue' : 'due'}
          </span>
        )}
      </div>

      {t.check.due && (
        <p className="text-[11px] font-bold text-[#0E6B5E] mt-2.5 mb-0 leading-snug">
          Then {kidName === 'You' ? 'you’re' : `${kidName} is`} done until{' '}
          {t.check.cadence === 'weekly' ? 'next week'
            : t.check.cadence === 'fortnightly' ? 'the one after next'
              : t.check.cadence === 'monthly' ? 'next month' : 'next term'}.
        </p>
      )}
    </Link>
  );
}
