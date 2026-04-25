'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import AppShell from '@/components/layout/AppShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (!profile?.familyId) router.replace('/onboarding');
  }, [user, profile, loading, router]);

  if (loading || !user || !profile?.familyId) {
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
