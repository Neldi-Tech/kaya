'use client';

// Kaya Sparks · Quests — 🔥 the Streak Chain (JOBS design v1, 2026-09-26).
//
// A streak isn't a number; it's a chain the kid fills one day at a time.
// This draws it from data that already exists — quest.streak (current ·
// best · shields · shielded days · done dates) plus the quest's rest
// days — so a kid can SEE and TRACK the streak on the hub, the quest
// page and the Today card. Kaya's kind rules (D10) become visible:
//   ✅ done · 🛡 a shield saved it · 😴 rest day · ○ missed · ▶ today
// Milestones: 3 🌱 · 7 ⭐ · 14 🔥 · 30 🏆 · 60 👑.

import { useMemo } from 'react';
import {
  type Quest, type QuestStep, buildStreakChain, nextStreakMilestone,
  STREAK_MILESTONES, scheduledSteps, todayKey, type ChainCell,
} from '@/lib/sparks/quests';

const CELL: Record<ChainCell['kind'], { cls: string; glyph: string }> = {
  done:   { cls: 'bg-[#E7F5EC] border-[#cfe8d4]', glyph: '✅' },
  shield: { cls: 'bg-[#E5F0FF] border-[#B9D2F7]', glyph: '🛡' },
  rest:   { cls: 'bg-white border-[#ECE4D3] text-[#8A8471]', glyph: '😴' },
  miss:   { cls: 'bg-[#FBEDEB] border-[#F3C8C4] text-[#B45959]', glyph: '○' },
  today:  { cls: 'bg-[#F2F4FE] border-[#5A3CB8] text-[#5A3CB8]', glyph: '▶' },
  empty:  { cls: 'bg-[#FBF7EE] border-transparent text-[#C9BFAF]', glyph: '·' },
};

export default function QuestStreakChain({ quest, steps, days = 14, hero = false, compact = false }: {
  quest: Quest;
  /** When present, done steps refine the chain (the hub passes none). */
  steps?: QuestStep[];
  days?: 14 | 28;
  /** Big 🔥 header with best · shields · next milestone. */
  hero?: boolean;
  /** Chain + one line only — for inside a card. */
  compact?: boolean;
}) {
  const today = todayKey();
  const cells = useMemo(() => buildStreakChain(quest, steps ?? [], days, today), [quest, steps, days, today]);
  const cur = quest.streak?.current ?? 0;
  const best = quest.streak?.best ?? 0;
  const shields = quest.streak?.shields ?? 0;
  const next = nextStreakMilestone(cur);
  const got = STREAK_MILESTONES.filter((m) => cur >= m.days).slice(-1)[0];
  const kept = useMemo(() => {
    const active = cells.filter((c) => c.kind === 'done' || c.kind === 'shield' || c.kind === 'miss');
    const good = active.filter((c) => c.kind !== 'miss').length;
    return active.length ? Math.round((good / active.length) * 100) : null;
  }, [cells]);
  const started = (quest.streak?.doneDates?.length ?? 0) > 0 || scheduledSteps(steps ?? []).some((s) => s.done);

  const nextLine = !started
    ? '🌱 Do today’s step to start your chain'
    : next
      ? `${next.emoji} ${next.days - cur} more day${next.days - cur === 1 ? '' : 's'} for your ${next.label}`
      : '👑 Legend — every milestone earned';

  return (
    <div className={compact ? 'mt-2.5' : 'mt-2 rounded-[16px] border border-[#ECE4D3] bg-white px-3 py-2.5'}>
      {hero && (
        <div className="rounded-[16px] p-3.5 text-white mb-2.5"
          style={{ background: `linear-gradient(135deg, ${quest.colour} 0%, #5AB7D6 140%)` }}>
          <div className="font-display font-black text-[28px] leading-none">🔥 {cur} day{cur === 1 ? '' : 's'}</div>
          <div className="text-[11.5px] opacity-90 mt-1">
            {best > cur ? `best ${best} · ` : cur > 0 ? 'your best so far · ' : ''}
            {cur > 0 ? 'you’re on a roll' : 'the chain starts with today'}
          </div>
          <div className="flex gap-2 mt-2.5">
            <div className="flex-1 rounded-xl bg-white/15 px-2 py-1.5 text-center">
              <div className="font-display font-black text-[14px]">🛡 {shields}</div>
              <div className="text-[9.5px] opacity-90">shield{shields === 1 ? '' : 's'} left</div>
            </div>
            <div className="flex-1 rounded-xl bg-white/15 px-2 py-1.5 text-center">
              <div className="font-display font-black text-[14px]">{next ? `${next.emoji} ${next.days}` : '👑'}</div>
              <div className="text-[9.5px] opacity-90">{next ? `next in ${next.days - cur}` : 'all earned'}</div>
            </div>
            <div className="flex-1 rounded-xl bg-white/15 px-2 py-1.5 text-center">
              <div className="font-display font-black text-[14px]">{kept == null ? '—' : `${kept}%`}</div>
              <div className="text-[9.5px] opacity-90">days kept</div>
            </div>
          </div>
        </div>
      )}

      {!compact && !hero && (
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] font-extrabold tracking-[1px] uppercase text-[#5A6488]">🔥 Streak · last {days} days</div>
          <div className="text-[11px] font-extrabold text-[#8A6800]">🔥{cur}{best > cur ? ` · best ${best}` : ''}{shields ? ` · 🛡${shields}` : ''}</div>
        </div>
      )}

      {/* the chain */}
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
        {cells.map((c) => (
          <div key={c.date} title={c.date}
            className={`aspect-square rounded-[6px] border grid place-items-center text-[11px] ${CELL[c.kind].cls}`}>
            {CELL[c.kind].glyph}
          </div>
        ))}
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-[#5A6488] mt-1.5">
          <span>✅ done</span><span>🛡 shield saved it</span><span>😴 rest</span><span>○ missed</span><span>▶ today</span>
        </div>
      )}

      {/* milestone ladder */}
      {!compact && (
        <div className="flex gap-1.5 mt-2">
          {STREAK_MILESTONES.map((m) => {
            const state = cur >= m.days ? 'got' : next && next.days === m.days ? 'next' : 'later';
            return (
              <div key={m.days}
                className={`flex-1 rounded-[10px] border py-1 text-center ${
                  state === 'got' ? 'bg-[#FFF1C9] border-[#D4A847]'
                    : state === 'next' ? 'bg-[#F2F4FE] border-[#5A3CB8]'
                    : 'bg-[#FBF7EE] border-[#ECE4D3]'}`}>
                <div className="text-[14px] leading-none">{m.emoji}</div>
                <div className="font-display font-black text-[10.5px] text-[#0F1F44] mt-0.5">{m.days}</div>
                <div className="text-[8.5px] text-[#5A6488]">{state === 'got' ? 'got it' : state === 'next' ? 'next' : ''}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className={`text-[11.5px] font-bold text-[#3B2E86] ${compact ? 'mt-1.5' : 'mt-2'}`}>
        {nextLine}{got && !compact ? ` · ${got.emoji} ${got.label} earned` : ''}
      </div>
    </div>
  );
}

/** Hub header — the quest with the longest live chain leads. */
export function StreakHero({ quests }: { quests: Quest[] }) {
  const top = quests
    .filter((q) => q.status === 'active')
    .sort((a, b) => (b.streak?.current ?? 0) - (a.streak?.current ?? 0))[0];
  if (!top) return null;
  return <QuestStreakChain quest={top} days={14} hero compact />;
}
