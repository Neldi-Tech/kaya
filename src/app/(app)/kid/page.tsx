'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { BADGES } from '@/lib/firestore';

export default function KidPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { children } = useFamily();

  // Find the child linked to this kid profile
  const myChild = children.find((c) => c.id === profile?.childId) || children[0];

  if (!myChild) {
    return (
      <div className="px-4 pt-10 text-center">
        <p className="text-4xl mb-3">👋</p>
        <p className="text-kaya-sand text-sm">Ask your parent to link your account to your profile</p>
      </div>
    );
  }

  const earnedBadges = BADGES.filter((b) => (myChild.badges || []).includes(b.id));
  const nextBadge = BADGES.find((b) => !(myChild.badges || []).includes(b.id));

  return (
    <div className="px-4 pt-4">
      {/* Hero card */}
      <div
        className="rounded-kaya-lg p-6 mb-5 text-center text-white shadow-lg"
        style={{ background: `linear-gradient(135deg, ${myChild.houseColor}, ${myChild.houseColor}CC)` }}
      >
        <div className="text-4xl mb-2">{myChild.avatarEmoji}</div>
        <h1 className="font-display text-2xl font-black mb-0.5">{myChild.name}</h1>
        <p className="text-white/80 text-sm font-medium mb-4">{myChild.houseName}</p>

        <div className="flex justify-around">
          <div>
            <p className="text-3xl font-display font-black">{myChild.totalPoints || 0}</p>
            <p className="text-white/70 text-xs font-medium">Total Points</p>
          </div>
          <div className="w-px bg-white/20" />
          <div>
            <p className="text-3xl font-display font-black">{myChild.streak || 0} 🔥</p>
            <p className="text-white/70 text-xs font-medium">Day Streak</p>
          </div>
        </div>
      </div>

      {/* Next badge */}
      {nextBadge && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-5 flex items-center gap-3">
          <div className="text-2xl opacity-40">{nextBadge.icon}</div>
          <div className="flex-1">
            <p className="text-xs text-kaya-sand font-medium">Next badge</p>
            <p className="text-sm font-bold">{nextBadge.name}</p>
            <p className="text-xs text-kaya-sand">{nextBadge.description}</p>
          </div>
          <span className="text-xs text-kaya-gold font-bold">Go!</span>
        </div>
      )}

      {/* Badges earned */}
      {earnedBadges.length > 0 && (
        <div className="mb-5">
          <h2 className="font-display text-base font-bold mb-3">My Badges</h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {earnedBadges.map((b) => (
              <div key={b.id} className="flex-shrink-0 bg-white border border-kaya-warm-dark rounded-kaya p-3 text-center w-20">
                <div className="text-2xl mb-1">{b.icon}</div>
                <p className="text-[10px] font-bold leading-tight">{b.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => router.push('/badges')}
          className="flex flex-col items-center gap-2 p-5 bg-white border border-kaya-warm-dark rounded-kaya"
        >
          <span className="text-2xl">🏆</span>
          <span className="text-xs font-bold">All Badges</span>
        </button>
        <button
          onClick={() => router.push('/rewards')}
          className="flex flex-col items-center gap-2 p-5 bg-white border border-kaya-warm-dark rounded-kaya"
        >
          <span className="text-2xl">🎁</span>
          <span className="text-xs font-bold">Rewards Store</span>
        </button>
      </div>
    </div>
  );
}
