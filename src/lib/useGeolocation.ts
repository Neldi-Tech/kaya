'use client';

// Kaya · Max-Privacy Mode — the ONLY sanctioned way to read device location.
//
// Geolocation is the most sensitive signal a device can surface, so under
// Max-Privacy Mode a CHILD session may NEVER touch it. This is enforcement,
// not disclosure: the hook HARD-THROWS the instant it's used in a kid
// session, so the code path simply cannot exist for a child — there is no
// "ask then deny" surface for them to even see.
//
// Two rails keep this airtight (both asserted by the Max-Privacy smoke test,
// scripts/max-privacy-check.mjs, which blocks the build on a regression):
//   1. This hook throws for role === 'kid'.
//   2. No component may call `navigator.geolocation` directly — every read
//      must funnel through here, so the kid-guard can't be bypassed.

import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export class GeolocationBlockedError extends Error {
  constructor() {
    super('Max-Privacy Mode: geolocation is disabled for child sessions.');
    this.name = 'GeolocationBlockedError';
  }
}

/** Returns a guarded `getCurrentPosition`. Throws `GeolocationBlockedError`
 *  synchronously when called inside a kid session — the child never gets an
 *  accessor at all. Hooks are called unconditionally (before the guard) so
 *  the rules-of-hooks order stays stable. */
export function useGeolocation() {
  const { profile } = useAuth();

  const getCurrentPosition = useCallback(
    (options?: PositionOptions) =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          reject(new Error('Geolocation is unavailable in this environment.'));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
      }),
    [],
  );

  // Hard kid-guard — a child session must never even hold the accessor.
  if (profile?.role === 'kid') throw new GeolocationBlockedError();

  return { getCurrentPosition };
}
