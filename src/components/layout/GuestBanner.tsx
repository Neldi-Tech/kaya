'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function GuestBanner() {
  const { isGuest, exitGuestMode } = useAuth();
  const router = useRouter();

  if (!isGuest) return null;

  const handleSignUp = () => {
    exitGuestMode();
    router.push('/login');
  };

  return (
    <div className="bg-kaya-chocolate text-kaya-gold-light px-4 py-2.5 flex items-center justify-between gap-3 safe-top">
      <div className="text-[12px] leading-snug">
        <span className="font-bold text-white">You&apos;re exploring as a guest.</span>{' '}
        <span className="text-kaya-sand-light">Nothing saves.</span>
      </div>
      <button
        onClick={handleSignUp}
        className="bg-kaya-gold text-kaya-chocolate font-bold text-[12px] px-3 py-1.5 rounded-kaya-sm whitespace-nowrap hover:bg-kaya-gold-light transition-colors"
      >
        Sign up to save
      </button>
    </div>
  );
}
