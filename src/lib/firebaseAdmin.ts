// Server-side Firebase Admin SDK init (v4-final §04 Step 8, 2026-05-18).
//
// First introduced for FCM web-push delivery on ad-hoc workplan assigns,
// but designed to be reused by any server-side route that needs Admin
// privileges (e.g. cross-collection rollups, scheduled jobs).
//
// Credentials policy:
//   • Prefer GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account
//     JSON file (Google's standard; works locally + on most hosts).
//   • Fall back to inline env vars FIREBASE_PROJECT_ID +
//     FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (Vercel-friendly —
//     no file upload needed).
//   • If neither is set, `getAdminApp()` returns null and callers should
//     gracefully no-op (we don't want a missing service account to take
//     down feature writes like "assign work" — the user-visible action
//     succeeds whether or not the push delivers).
//
// On Vercel, set the three env vars in Project Settings → Environment
// Variables. The private key needs literal `\n` sequences turned into
// real newlines — see the `formatPrivateKey()` helper.

import { initializeApp, getApps, cert, applicationDefault, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

const APP_NAME = 'kaya-admin';

/** Vercel-friendly key parsing. The platform stores multi-line env
 *  vars as a single line with literal `\n` escapes; this restores
 *  them to real newlines before handing the key to the SDK. */
function formatPrivateKey(raw: string): string {
  return raw.replace(/\\n/g, '\n');
}

let cached: App | null | undefined; // undefined = not attempted; null = attempted, no creds

/** Returns an initialized Firebase Admin app, or null if no
 *  credentials are configured. Lazy + memoised — safe to call from
 *  any API route on every request. */
export function getAdminApp(): App | null {
  if (cached !== undefined) return cached;

  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) {
    cached = existing;
    return cached;
  }

  // Prefer GOOGLE_APPLICATION_CREDENTIALS (Google standard).
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      cached = initializeApp({ credential: applicationDefault() }, APP_NAME);
      return cached;
    } catch (e) {
      console.warn('[firebaseAdmin] applicationDefault() failed:', e);
      // fall through to inline-env attempt
    }
  }

  // Inline env vars (Vercel-friendly).
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKeyRaw) {
    try {
      cached = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: formatPrivateKey(privateKeyRaw),
        }),
      }, APP_NAME);
      return cached;
    } catch (e) {
      console.warn('[firebaseAdmin] cert() init failed:', e);
      cached = null;
      return null;
    }
  }

  // No creds — log once at first attempt, then memoise the null so
  // we don't spam the logs on every request.
  console.warn(
    '[firebaseAdmin] No service-account credentials configured. ' +
    'FCM web-push will no-op. Set either GOOGLE_APPLICATION_CREDENTIALS ' +
    'or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.'
  );
  cached = null;
  return null;
}

/** Convenience accessor — returns Admin Messaging() or null. */
export function getAdminMessaging(): Messaging | null {
  const app = getAdminApp();
  if (!app) return null;
  return getMessaging(app);
}

/** Convenience accessor — returns Admin Firestore() or null. */
export function getAdminFirestore(): Firestore | null {
  const app = getAdminApp();
  if (!app) return null;
  return getFirestore(app);
}

/** Convenience accessor — returns Admin Auth() or null. Used to verify a
 *  client's Firebase ID token on routes that act on the caller's behalf. */
export function getAdminAuth(): Auth | null {
  const app = getAdminApp();
  if (!app) return null;
  return getAuth(app);
}
