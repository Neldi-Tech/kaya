'use client';

import { useState } from 'react';
import { useFamily } from '@/contexts/FamilyContext';
import { BADGES } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function BadgesPage() {
  const { children } = useFamily();
  const [selectedChild, setSelectedChild] = useState(0);

  const child = children[selectedChild];
  const earnedBadges = child?.badges || [];
  const earnedCount = earnedBadges.length;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-5xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>

      <div className="mb-5 lg:mb-7 flex items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight">Badges</h1>
          <p className="text-kaya-sand text-sm mt-0.5 lg:mt-1">Milestones and achievements per kid.</p>
        </div>
      </div>

      {/* Child selector */}
      <div className="flex gap-2 mb-5 lg:mb-6 overflow-x-auto pb-1">
        {children.map((c, i) => {
          const sel = selectedChild === i;
          return (
            <button
              key={c.id}
              onClick={() => setSelectedChild(i)}
              className={`flex items-center gap-2 px-4 py-2 lg:py-2.5 rounded-full text-xs font-bold whitespace-nowrap border transition-all ${
                sel ? 'text-white border-transparent shadow-sm' : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-sand-light'
              }`}
              style={sel ? { backgroundColor: c.houseColor } : {}}
            >
              <span>{c.avatarEmoji}</span>{c.name}
            </button>
          );
        })}
      </div>

      {/* Stats banner */}
      {child && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 lg:p-5 mb-5 lg:mb-6 grid grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-4 items-center">
          <div className="hidden lg:flex items-center gap-3 col-span-1">
            <KidAvatar child={child} size="lg" shape="square" />
            <div>
              <p className="font-display font-bold text-base">{child.name}</p>
              <p className="text-[11px] text-kaya-sand">{child.houseName} House</p>
            </div>
          </div>
          <div className="text-center lg:text-left">
            <p className="text-2xl lg:text-3xl font-display font-black" style={{ color: child.houseColor }}>{fmt(child.totalPoints || 0)}</p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase tracking-wider">Total points</p>
          </div>
          <div className="text-center lg:text-left">
            <p className="text-2xl lg:text-3xl font-display font-black">{child.streak || 0}<span className="text-base ml-0.5">🔥</span></p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase tracking-wider">Day streak</p>
          </div>
          <div className="text-center lg:text-left">
            <p className="text-2xl lg:text-3xl font-display font-black">{earnedCount}<span className="text-base text-kaya-sand font-semibold ml-1">/ {BADGES.length}</span></p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase tracking-wider">Badges</p>
          </div>
        </div>
      )}

      {/* Badge grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        {BADGES.map((badge) => {
          const earned = earnedBadges.includes(badge.id);
          return (
            <div
              key={badge.id}
              className={`rounded-kaya lg:rounded-kaya-lg p-4 lg:p-5 text-center border transition-all ${
                earned
                  ? 'bg-white border-kaya-gold/40 shadow-sm'
                  : 'bg-kaya-warm/40 border-kaya-warm-dark/60 opacity-60'
              }`}
            >
              <div className={`text-3xl lg:text-4xl mb-2 lg:mb-3 ${earned ? '' : 'grayscale opacity-70'}`}>{badge.icon}</div>
              <p className="text-sm lg:text-[15px] font-bold mb-0.5">{badge.name}</p>
              <p className="text-[11px] lg:text-xs text-kaya-sand leading-tight">{badge.description}</p>
              {earned ? (
                <div className="mt-3 text-[10px] font-bold text-kaya-gold uppercase tracking-wider">✓ Earned</div>
              ) : (
                <div className="mt-3 text-[10px] font-bold text-kaya-sand uppercase tracking-wider">Locked</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
