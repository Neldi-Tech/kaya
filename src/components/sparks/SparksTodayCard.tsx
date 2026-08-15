'use client';

// Kaya Sparks · the Today card (B4) and the Today strip (B5).
//
// B4 · Before this, the kid's whole learning world was invisible from
//      the deck — Sparks was a word in a menu you had to remember to
//      visit. One card, today's dots, each one tappable straight into
//      the action.
// B3/R2 · The count is HONEST. Only genuinely-open things are counted,
//      because a badge that cries wolf is a badge a kid learns to
//      ignore, and then the whole module goes quiet.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { subscribeSparksToday, type SparksToday } from '@/lib/sparks/quests';

interface Props {
  familyId: string;
  kidId: string;
  kidName: string;
  /** 'card' = the standalone deck card (My Day). 'strip' = the inline
   *  row that sits at the top of the Sparks home. */
  variant?: 'card' | 'strip';
}

export default function SparksTodayCard({ familyId, kidId, kidName, variant = 'card' }: Props) {
  const [today, setToday] = useState<SparksToday | null>(null);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeSparksToday(familyId, kidId, setToday);
  }, [familyId, kidId]);

  if (!today) return null;

  const dueQuests = today.quests.filter((q) => q.due && q.hasStep);
  // Nothing planned and the reflection is written → say so and stop.
  const allClear = today.openCount === 0;

  const dots: Array<{ key: string; emoji: string; label: string; done: boolean; href: string }> = [
    ...dueQuests.map((q) => ({
      key: q.id,
      emoji: q.emoji,
      label: q.stepDone ? q.title : (q.stepTitle || q.title),
      done: q.stepDone,
      href: `/sparks/${kidId}/quests/${q.id}`,
    })),
    {
      key: 'reflection',
      emoji: '🪞',
      label: today.reflectionDone ? 'Reflection written' : 'Today’s reflection',
      done: today.reflectionDone,
      href: `/sparks/${kidId}/reflection`,
    },
  ];

  if (variant === 'strip') {
    return (
      <div className="rounded-[16px] border border-[#DFE3FB] bg-[#F7F9FF] p-3.5 mb-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="font-display font-extrabold text-[12px] tracking-[0.5px] text-[#3B2E86] uppercase">
            Today
          </div>
          <span className="text-[11px] font-extrabold text-[#5A6488]">
            {allClear ? 'All done ✅' : `${today.openCount} to do`}
            {today.bestStreak > 0 ? ` · 🔥${today.bestStreak}` : ''}
          </span>
        </div>
        <div className="grid gap-1.5">
          {dots.map((d) => (
            <Link
              key={d.key}
              href={d.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl no-underline border ${
                d.done
                  ? 'bg-white border-[#DFE3FB] opacity-70'
                  : 'bg-white border-[#C9D2F5]'
              }`}
            >
              <span className="text-[15px]" aria-hidden>{d.done ? '✅' : d.emoji}</span>
              <span className={`text-[12.5px] flex-1 min-w-0 truncate ${
                d.done ? 'text-[#5A6488] line-through' : 'font-bold text-[#0F1F44]'
              }`}>
                {d.label}
              </span>
              {!d.done && <span className="text-[#3B2E86] font-bold" aria-hidden>›</span>}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Link
      href={`/sparks/${kidId}`}
      className="block rounded-[18px] border border-[#ECE4D3] bg-white p-4 no-underline hover:border-[#D4A847] transition-colors"
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-10 h-10 rounded-[13px] grid place-items-center text-lg shrink-0"
          style={{ background: '#DFE3FB', color: '#3B2E86' }}
          aria-hidden
        >
          ✨
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-extrabold text-[14px] text-[#0F1F44] leading-tight">
            Kaya Sparks
          </div>
          <div className="text-[11.5px] text-[#5A6488] mt-0.5">
            {allClear
              ? `${kidName} is all caught up${today.bestStreak > 0 ? ` · 🔥${today.bestStreak}` : ''}`
              : `${today.openCount} to do today${today.bestStreak > 0 ? ` · 🔥${today.bestStreak}` : ''}`}
          </div>
        </div>
        {!allClear && (
          <span className="text-[11px] font-extrabold px-2 py-1 rounded-full bg-[#DFE3FB] text-[#3B2E86]">
            {today.openCount}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {dots.map((d) => (
          <span
            key={d.key}
            className={`inline-flex items-center gap-1.5 text-[11px] font-extrabold px-2.5 py-1 rounded-full ${
              d.done
                ? 'bg-[#E7F5EC] text-[#2E7D34]'
                : 'bg-[#FBF7EE] text-[#5A6488] border border-[#ECE4D3]'
            }`}
          >
            {d.done ? '✅' : d.emoji} {d.label.length > 22 ? `${d.label.slice(0, 22)}…` : d.label}
          </span>
        ))}
      </div>
    </Link>
  );
}
