'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// Short URL helpers can land on — bounces them to the right place
// based on auth state.
export default function HelperRootPage() {
  const router = useRouter();
  const { profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (profile?.role === 'helper') {
      router.replace('/helper');
    } else {
      router.replace('/h/login');
    }
  }, [loading, profile, router]);

  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-kaya-sand">
      Loading…
    </div>
  );
}
