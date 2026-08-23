'use client';
// 👑 Leader of the Week — the Guide sheet (R5): "What it means to be Leader
// of the Week" in kid voice. Leader version (Your job) vs sibling version
// (How to help your leader). Parents' custom duties appended.

import { useFamily } from '@/contexts/FamilyContext';
import { readLeaderConfig, guideBlocks } from '@/lib/leaderWeek.shared';

export default function LeaderGuideSheet({ open, onClose, isLeader, leaderName }: {
  open: boolean;
  onClose: () => void;
  isLeader: boolean;
  leaderName: string;
}) {
  const { family, children } = useFamily();
  if (!open) return null;
  const cfg = readLeaderConfig(family);
  const siblings = Math.max(0, (children?.length || 1) - 1);
  const blocks = guideBlocks({ isLeader, leaderName: leaderName.split(' ')[0], customDuties: cfg.customDuties, siblings });
  return (
    <div className="fixed inset-0 z-[80] flex items-end lg:items-center justify-center bg-black/40 p-0 lg:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label="What it means to be Leader of the Week">
      <div className="bg-white w-full lg:max-w-lg rounded-t-kaya-lg lg:rounded-kaya-lg overflow-hidden shadow-2xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg,#B8860B,#E9B949)' }}>
          <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px] opacity-90">👑 Leader of the Week</p>
          <h2 className="font-display text-xl font-black leading-tight mt-0.5">
            {isLeader ? 'What it means to be the leader' : `${leaderName.split(' ')[0]} is leading this week`}
          </h2>
          <p className="text-[12px] font-bold opacity-90 mt-1">
            {isLeader ? 'A small job with a big heart. Here is what Kaya asks of you.' : 'Here is how you can help — and what the leader can do.'}
          </p>
        </div>
        <div className="p-5 space-y-4">
          {blocks.map((b) => (
            <div key={b.title} className="rounded-kaya border border-kaya-warm-dark bg-kaya-warm/60 p-3.5">
              <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand mb-1.5">{b.title}</p>
              <ul className="space-y-1">
                {b.lines.map((l) => (
                  <li key={l} className="text-[13px] font-bold text-kaya-chocolate leading-snug">{l}</li>
                ))}
              </ul>
            </div>
          ))}
          <button type="button" onClick={onClose} className="w-full py-3 rounded-full font-display font-black text-[14px] text-[#3D2E08]" style={{ background: '#E9B949' }}>
            Got it 👑
          </button>
        </div>
      </div>
    </div>
  );
}
