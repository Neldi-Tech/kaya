'use client';

// Guest play — a visitor joins a family's game on their own phone with a REAL
// anonymous Firebase account (no email, no profile, nothing saved). Requires
// Anonymous sign-in to be enabled in the Firebase console.

import { signInAnonymously } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export interface GuestAuth { uid: string; token: string }

/** Sign in anonymously (or reuse an existing anon session) and return a fresh
 *  id token. Never clobbers a real signed-in Kaya account — throws
 *  'already-signed-in' so the caller can offer the in-app path instead.
 *  Throws 'guest-auth-disabled' if Anonymous sign-in isn't enabled. */
export async function ensureGuestAuth(): Promise<GuestAuth> {
  const cur = auth.currentUser;
  if (cur && !cur.isAnonymous) throw new Error('already-signed-in');
  let user = cur;
  if (!user) {
    try {
      user = (await signInAnonymously(auth)).user;
    } catch (e) {
      const code = String((e as { code?: string })?.code || e);
      if (/operation-not-allowed|admin-restricted|configuration-not-found/i.test(code)) {
        throw new Error('guest-auth-disabled');
      }
      throw e;
    }
  }
  return { uid: user.uid, token: await user.getIdToken() };
}
