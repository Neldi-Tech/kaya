'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { todayString } from '@/lib/firestore';
import KidAvatar from '@/components/ui/KidAvatar';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function HelperPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { children } = useFamily();

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const firstName = profile?.displayName?.split(' ')[0] || 'there';

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-5xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="mb-5 lg:mb-7">
        <p className="text-xs text-kaya-sand font-bold uppercase tracking-[0.14em]">{today}</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight mt-0.5">
          Hello, {firstName} 🤝
        </h1>
        <p className="text-kaya-sand text-sm mt-1 lg:mt-2">Ready to rate the children&apos;s routines.</p>
      </div>

      {/* Children overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-4 mb-6 lg:mb-8">
        {children.map((child) => (
          <div
            key={child.id}
            className="bg-white border border-kaya-warm-dark rounded-kaya lg:rounded-kaya-lg p-4 lg:p-5 flex items-center gap-3 lg:gap-4"
          >
            <KidAvatar child={child} size="lg" shape="circle" bgOpacity="20" />
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-base lg:text-lg truncate">{child.name}</p>
              <p className="text-[12px] text-kaya-sand truncate">
                {child.houseName} House · <span className="font-bold" style={{ color: child.houseColor }}>{fmt(child.totalPoints || 0)} pts</span>
              </p>
            </div>
            {(child.streak || 0) > 0 && (
              <span className="text-xs lg:text-sm font-bold whitespace-nowrap">🔥 {child.streak}</span>
            )}
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 lg:gap-4 lg:max-w-2xl">
        <button
          onClick={() => router.push('/rate?period=morning')}
          className="flex flex-col items-center gap-2 lg:gap-3 p-5 lg:p-8 bg-white border border-kaya-warm-dark rounded-kaya lg:rounded-kaya-lg hover:shadow-md hover:-translate-y-0.5 transition-all"
        >
          <span className="text-3xl lg:text-5xl">☀️</span>
          <span className="text-sm lg:text-base font-bold">Morning rating</span>
          <span className="hidden lg:block text-[12px] text-kaya-sand">Rate today&apos;s wake-up routines</span>
        </button>
        <button
          onClick={() => router.push('/rate?period=evening')}
          className="flex flex-col items-center gap-2 lg:gap-3 p-5 lg:p-8 bg-white border border-kaya-warm-dark rounded-kaya lg:rounded-kaya-lg hover:shadow-md hover:-translate-y-0.5 transition-all"
        >
          <span className="text-3xl lg:text-5xl">🌙</span>
          <span className="text-sm lg:text-base font-bold">Evening rating</span>
          <span className="hidden lg:block text-[12px] text-kaya-sand">Rate today&apos;s wind-down routines</span>
        </button>
      </div>
    </div>
  );
}
