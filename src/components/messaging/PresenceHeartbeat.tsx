'use client';

// Kaya · presence heartbeat. Mounted once in the (app) layout. While the app is
// foregrounded, writes the user's `lastActiveAt` so others can see online /
// last-seen — but only if they share presence (showPresence !== false).

import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { heartbeatPresence } from '@/lib/messaging';

export function PresenceHeartbeat() {
  const { profile } = useAuth();
  const uid = profile?.uid;
  const share = profile?.messagingPrivacy?.showPresence !== false;

  useEffect(() => {
    if (!uid || !share) return;
    let alive = true;
    const beat = () => { if (alive && typeof document !== 'undefined' && document.visibilityState === 'visible') heartbeatPresence(uid); };
    beat();
    const iv = setInterval(beat, 40_000); // < ONLINE_WINDOW_MS so we stay "online" between beats
    const onVis = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [uid, share]);

  return null;
}
