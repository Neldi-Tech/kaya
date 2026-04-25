'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { todayString } from '@/lib/firestore';

export default function HelperPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { children } = useFamily();

  return (
    <div className="px-4 pt-4">
      <div className="mb-5">
        <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">{todayString()}</p>
        <h1 className="font-display text-2xl font-black">
          Hello, {profile?.displayName?.split(' ')[0]} 🤝
        </h1>
        <p className="text-kaya-sand text-sm mt-1">Ready to rate the children's routines</p>
      </div>

      {/* Children overview */}
      <div className="space-y-3 mb-6">
        {children.map((child) => (
          <div key={child.id} className="bg-white border border-kaya-warm-dark rounded-kaya p-4 flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
              style={{ backgroundColor: child.houseColor + '20' }}
            >
              {child.avatarEmoji}
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm">{child.name}</p>
              <p className="text-xs text-kaya-sand">{child.houseName} · {child.totalPoints || 0} pts</p>
            </div>
            {child.streak > 0 && (
              <span className="text-xs">🔥 {child.streak}</span>
            )}
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => router.push('/rate?period=morning')}
          className="flex flex-col items-center gap-2 p-5 bg-white border border-kaya-warm-dark rounded-kaya hover:shadow-sm transition-shadow"
        >
          <span className="text-3xl">☀️</span>
          <span className="text-sm font-bold">Morning Rating</span>
        </button>
        <button
          onClick={() => router.push('/rate?period=evening')}
          className="flex flex-col items-center gap-2 p-5 bg-white border border-kaya-warm-dark rounded-kaya hover:shadow-sm transition-shadow"
        >
          <span className="text-3xl">🌙</span>
          <span className="text-sm font-bold">Evening Rating</span>
        </button>
      </div>
    </div>
  );
}
