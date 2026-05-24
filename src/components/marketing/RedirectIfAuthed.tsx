'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// `/` serves the public marketing page (server-rendered). A signed-in
// family shouldn't sit on marketing — once auth resolves on the client we
// send them to their dashboard (or to onboarding if they have no family
// yet). Logged-out visitors and guests stay on the page. Mirrors the
// redirect the old /welcome page did, retargeted to /discover.
export default function RedirectIfAuthed() {
  const { user, profile, loading, isGuest } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || isGuest) return;
    if (user && profile?.familyId) router.replace('/discover');
    else if (user && !profile?.familyId) router.replace('/onboarding');
  }, [user, profile, loading, isGuest, router]);

  return null;
}
