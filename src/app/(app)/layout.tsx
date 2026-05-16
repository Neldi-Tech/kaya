'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import AppShell from '@/components/layout/AppShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, isGuest } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || isGuest) return;
    if (!user) {
      // Unauthed visitors landing on the root see the marketing page;
      // hitting a deeper route still goes through /login.
      router.replace(pathname === '/' ? '/welcome' : '/login');
    } else if (!profile?.familyId) {
      router.replace('/onboarding');
    }
  }, [user, profile, loading, isGuest, router, pathname]);

  // Guests bypass the auth gate entirely.
  if (!isGuest && (loading || !user || !profile?.familyId)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-3xl mb-2">🏠</div>
          <p className="text-kaya-sand text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
