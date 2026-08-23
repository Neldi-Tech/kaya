'use client';
// 👑 Leader of the Week — the compact family-visible label (R4): "👑 Ama is
// Leader of the Week · day 3 of 7". Renders for everyone who is NOT the
// leader (siblings, parents, helpers); the leader's own Home wears the
// ribbon instead. Tap → Guide sheet (sibling version for kids).

import { useEffect, useState } from 'react';
import { useFamily } from '@/contexts/FamilyContext';
import { useAuth } from '@/contexts/AuthContext';
import { readLeaderConfig, termDayNumber, termWeekNumber } from '@/lib/leaderWeek.shared';
import { listLeaderTerms } from '@/lib/leaderWeek';
import LeaderGuideSheet from './LeaderGuideSheet';

export default function LeaderCrownChip({ className = '' }: { className?: string }) {
  const { family } = useFamily();
  const { profile } = useAuth();
  const [guide, setGuide] = useState(false);
  const [ledTimes, setLedTimes] = useState<number | null>(null);
  const hl = family?.houseLeader;
  const hlChildId = hl?.childId;
  // "led N×" — siblings see only the crown + the count (R14).
  useEffect(() => {
    if (!family?.id || !hlChildId) { setLedTimes(null); return; }
    let alive = true;
    listLeaderTerms(family.id, hlChildId)
      .then((r) => { if (alive) setLedTimes(r.lifetime.find((l) => l.childId === hlChildId)?.selected ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [family?.id, hlChildId]);
  if (!hl || !readLeaderConfig(family).enabled) return null;
  const isMe = profile?.role === 'kid' && profile.childId === hl.childId;
  if (isMe) return null;
  const day = termDayNumber(hl.startAt);
  const week = termWeekNumber(hl.startAt);
  const first = hl.name.split(' ')[0];
  return (
    <>
      <button
        type="button"
        onClick={() => setGuide(true)}
        className={`w-full text-left rounded-2xl border px-4 py-2.5 flex items-center gap-3 ${className}`}
        style={{ background: 'linear-gradient(135deg,#FFF7E5,#FFE9C4)', borderColor: '#E9C867' }}
        aria-label={`${first} is Leader of the Week — what does it mean?`}
      >
        <span className="text-2xl" aria-hidden>{hl.emoji || '👑'}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] font-nunito font-black uppercase tracking-[1.5px]" style={{ color: '#B8860B' }}>👑 Leader of the Week</span>
          <span className="block text-[13.5px] font-nunito font-black text-[#4a3a18] leading-snug truncate">
            {first} is leading this week · day {Math.min(day, 7)}{week > 1 ? ` · week ${week}` : ''}{ledTimes && ledTimes > 1 ? ` · led ${ledTimes}×` : ''}
          </span>
        </span>
        <span className="text-[11px] font-black" style={{ color: '#B8860B' }}>{profile?.role === 'kid' ? 'how can I help? →' : 'guide →'}</span>
      </button>
      <LeaderGuideSheet open={guide} onClose={() => setGuide(false)} isLeader={false} leaderName={hl.name} />
    </>
  );
}
