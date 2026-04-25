'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function Home() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
    } else if (!profile?.familyId) {
      router.replace('/onboarding');
    } else {
      router.replace('/dashboard');
    }
  }, [user, profile, loading, router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="text-4xl mb-3">🏠</div>
        <h1 className="font-display text-2xl font-bold gold-shimmer">Kaya</h1>
        <p className="text-kaya-sand text-sm mt-1">Loading...</p>
      </div>
    </div>
  );
}
