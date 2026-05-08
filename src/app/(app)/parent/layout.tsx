'use client';

// Parent route group — gates everything under /parent/* to users with
// role === 'parent'. Other roles are bounced to the Hive Home (or the
// dashboard if Hive is gated). Layout is presentation-only; the
// auth-required check is delegated to the (app) layout one level up.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading, isGuest } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading || isGuest) return;
    if (profile && profile.role !== 'parent') router.replace('/hive');
  }, [profile, loading, isGuest, router]);

  if (!isGuest && profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <p className="text-kaya-sand text-sm">Redirecting…</p>
      </div>
    );
  }
  return (
    <div className="font-lato bg-hive-cream text-hive-navy min-h-screen pb-24 lg:pb-0">
      {children}
    </div>
  );
}
