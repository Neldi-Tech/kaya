'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { CelebrationProvider } from '@/components/celebrate/CelebrationProvider';
import { PresenceHeartbeat } from '@/components/messaging/PresenceHeartbeat';
import AppShell from '@/components/layout/AppShell';
import KayaGuide from '@/components/guide/KayaGuide';
import GuideHost from '@/components/guide/GuideHost';
import { ACTIVE_POLICY_VERSION, ACCEPT_SESSION_KEY } from '@/lib/coppa/constants';
import type { UserProfile } from '@/lib/firestore';

// True when a signed-in ADULT must pass back through the /accept re-consent
// gate before re-entering the app. Deliberately FAIL-OPEN on an absent
// version: only an explicitly-recorded OLDER acceptance triggers the gate, so
// new signups (whose profile write doesn't carry the mirror) and legacy users
// are picked up by their next login clickwrap instead of being locked out.
//   • Kids never see legal copy — they're excluded outright.
//   • The session flag set on a deliberate /accept tap short-circuits the
//     gate so a best-effort audit-write hiccup can't trap them in a loop.
function needsReaccept(profile: UserProfile | null): boolean {
  if (!profile || profile.role === 'kid') return false;
  const accepted = profile.acceptedPolicyVersion;
  if (!accepted || accepted === ACTIVE_POLICY_VERSION) return false;
  if (typeof window !== 'undefined' &&
      sessionStorage.getItem(ACCEPT_SESSION_KEY) === ACTIVE_POLICY_VERSION) {
    return false;
  }
  return true;
}

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
    } else if (needsReaccept(profile)) {
      // Material policy change since their last acceptance → re-consent gate.
      router.replace('/accept');
    }
  }, [user, profile, loading, isGuest, router]);

  // Guests bypass the auth gate entirely.
  if (!isGuest && (loading || !user || !profile?.familyId || needsReaccept(profile))) {
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
        {/* App-wide "how it works" guide player (launched from the FAB,
            a module's ▶ pill, or the Videos library). */}
        <GuideHost />
      </CelebrationProvider>
    </ConfirmProvider>
  );
}
