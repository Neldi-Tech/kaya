'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { CelebrationProvider } from '@/components/celebrate/CelebrationProvider';
import { PresenceHeartbeat } from '@/components/messaging/PresenceHeartbeat';
import AppShell from '@/components/layout/AppShell';
import KayaGuide from '@/components/guide/KayaGuide';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, isGuest } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || isGuest) return;
    if (!user) {
      // `/` is the public marketing page (its own route, outside this
      // group); any app route reached without auth goes through /login.
      router.replace('/login');
    } else if (!profile?.familyId) {
      router.replace('/onboarding');
    }
  }, [user, profile, loading, isGuest, router]);

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

  // ConfirmProvider mounts the in-app confirm dialog so any descendant
  // can call useConfirm() instead of window.confirm(). One dialog is
  // shared across the whole app shell (2026-05-18).
  return (
    <ConfirmProvider>
      <CelebrationProvider>
        <PresenceHeartbeat />
        <AppShell>{children}</AppShell>
        {/* App-wide help bubble for both kids and parents (2026-05-28). */}
        <KayaGuide />
      </CelebrationProvider>
    </ConfirmProvider>
  );
}
