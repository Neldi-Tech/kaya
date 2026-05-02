'use client';

import { useState } from 'react';
import { useFamily } from '@/contexts/FamilyContext';
import { BADGES } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

export default function BadgesPage() {
  const { children } = useFamily();
  const [selectedChild, setSelectedChild] = useState(0);

  const child = children[selectedChild];
  const earnedBadges = child?.badges || [];

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4">
      <BackButton />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-black">Badges</h1>
        <p className="text-kaya-sand text-sm">Milestones and achievements</p>
      </div>

      {/* Child selector */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {children.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setSelectedChild(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap border transition-all ${
              selectedChild === i
                ? 'text-white border-transparent shadow-sm'
                : 'border-kaya-warm-dark bg-white text-kaya-sand'
            }`}
            style={selectedChild === i ? { backgroundColor: c.houseColor } : {}}
          >
            {c.avatarEmoji} {c.name}
          </button>
        ))}
      </div>

      {/* Stats banner */}
      {child && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-5 flex items-center justify-around">
          <div className="text-center">
            <p className="text-2xl font-display font-black" style={{ color: child.houseColor }}>
              {child.totalPoints || 0}
            </p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase">Total Points</p>
          </div>
          <div className="w-px h-10 bg-kaya-warm-dark" />
          <div className="text-center">
            <p className="text-2xl font-display font-black">{child.streak || 0}</p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase">Day Streak</p>
          </div>
          <div className="w-px h-10 bg-kaya-warm-dark" />
          <div className="text-center">
            <p className="text-2xl font-display font-black">{earnedBadges.length}</p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase">Badges</p>
          </div>
        </div>
      )}

      {/* Badge grid */}
      <div className="grid grid-cols-2 gap-3">
        {BADGES.map((badge) => {
          const earned = earnedBadges.includes(badge.id);
          return (
            <div
              key={badge.id}
              className={`rounded-kaya p-4 text-center border transition-all ${
                earned
                  ? 'bg-white border-kaya-gold/30 shadow-sm'
                  : 'bg-kaya-warm border-transparent opacity-50'
              }`}
            >
              <div className={`text-3xl mb-2 ${earned ? '' : 'grayscale'}`}>{badge.icon}</div>
              <p className="text-sm font-bold mb-0.5">{badge.name}</p>
              <p className="text-xs text-kaya-sand leading-tight">{badge.description}</p>
              {earned && (
                <div className="mt-2 text-[10px] font-bold text-kaya-gold uppercase">✓ Earned</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
