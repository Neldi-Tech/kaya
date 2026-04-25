'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import {
  User,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getUserProfile, UserProfile } from '@/lib/firestore';
import {
  GUEST_FAMILY_ID, GUEST_UID, MOCK_PROFILE,
  setGuestActive, isGuestActive,
} from '@/lib/mockFamily';

const GUEST_FLAG_KEY = 'kaya.guest';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isGuest: boolean;
  signInWithGoogle: () => Promise<User>;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  signUpWithEmail: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  enterGuestMode: () => void;
  exitGuestMode: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// A minimal Firebase-User-shaped object for guest mode.
const fakeGuestUser = (): User => ({
  uid: GUEST_UID,
  email: 'guest@ourkaya.com',
  displayName: 'Guest Visitor',
  emailVerified: false,
  isAnonymous: true,
  photoURL: null,
  phoneNumber: null,
  providerId: 'guest',
  metadata: {} as any,
  providerData: [],
  refreshToken: '',
  tenantId: null,
  delete: async () => {},
  getIdToken: async () => 'guest-token',
  getIdTokenResult: async () => ({} as any),
  reload: async () => {},
  toJSON: () => ({}),
} as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  const loadProfile = async (u: User) => {
    const p = await getUserProfile(u.uid);
    setProfile(p);
  };

  const enterGuestMode = useCallback(() => {
    setGuestActive(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(GUEST_FLAG_KEY, '1');
    }
    setIsGuest(true);
    setUser(fakeGuestUser());
    setProfile(MOCK_PROFILE);
    setLoading(false);
  }, []);

  const exitGuestMode = useCallback(() => {
    setGuestActive(false);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(GUEST_FLAG_KEY);
    }
    setIsGuest(false);
    setUser(null);
    setProfile(null);
  }, []);

  // Restore guest mode from sessionStorage on first load.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(GUEST_FLAG_KEY) === '1') {
      enterGuestMode();
    }
  }, [enterGuestMode]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      // If we're in guest mode, ignore Firebase auth state.
      if (isGuestActive()) return;

      setUser(u);
      if (u) {
        await loadProfile(u);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signInWithGoogle = async () => {
    if (isGuestActive()) exitGuestMode();
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    await loadProfile(result.user);
    return result.user;
  };

  const signInWithEmail = async (email: string, password: string) => {
    if (isGuestActive()) exitGuestMode();
    const result = await signInWithEmailAndPassword(auth, email, password);
    await loadProfile(result.user);
    return result.user;
  };

  const signUpWithEmail = async (email: string, password: string) => {
    if (isGuestActive()) exitGuestMode();
    const result = await createUserWithEmailAndPassword(auth, email, password);
    return result.user;
  };

  const signOut = async () => {
    if (isGuestActive()) {
      exitGuestMode();
      return;
    }
    await firebaseSignOut(auth);
    setProfile(null);
  };

  const refreshProfile = async () => {
    if (isGuestActive()) {
      setProfile(MOCK_PROFILE);
      return;
    }
    if (user) await loadProfile(user);
  };

  return (
    <AuthContext.Provider value={{
      user, profile, loading, isGuest,
      signInWithGoogle, signInWithEmail, signUpWithEmail, signOut, refreshProfile,
      enterGuestMode, exitGuestMode,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
