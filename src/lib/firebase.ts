import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// authDomain controls what users see in the Google sign-in popup
// (e.g. "Sign in to continue to <authDomain>"). Default to the custom
// auth.ourkaya.com so users see "auth.ourkaya.com" instead of
// "kaya-app-b9463.firebaseapp.com". The env var still wins if set, so
// rollback is just an env-var change in Vercel — no redeploy of code.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'auth.ourkaya.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);
// Firebase Storage (Blaze plan) — backs the Moments photo feed. Avatars
// still travel as data: URLs because they're small; full-res photos go
// here so we don't bloat Firestore docs.
const storage = getStorage(app);

export { app, auth, db, storage };
