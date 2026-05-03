'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  Family, Child, Reward,
  getFamily, getChildren, getRewards, subscribeToChildren, subscribeToFamily,
} from '@/lib/firestore';

interface FamilyContextType {
  family: Family | null;
  children: Child[];
  rewards: Reward[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const FamilyContext = createContext<FamilyContextType | null>(null);

export function FamilyProvider({ children: kids }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [family, setFamily] = useState<Family | null>(null);
  const [childrenList, setChildrenList] = useState<Child[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.familyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [f, r] = await Promise.all([
      getFamily(profile.familyId),
      getRewards(profile.familyId),
    ]);
    setFamily(f);
    setRewards(r);
    setLoading(false);
  }, [profile?.familyId]);

  useEffect(() => {
    load();
  }, [load]);

  // Real-time family subscription — keeps `family.allowGenderOther`,
  // `family.earningMethods`, `family.anniversary` etc. fresh so toggles
  // reflect their new value the instant Firestore confirms the write.
  useEffect(() => {
    if (!profile?.familyId) return;
    const unsub = subscribeToFamily(profile.familyId, setFamily);
    return unsub;
  }, [profile?.familyId]);

  // Real-time children subscription
  useEffect(() => {
    if (!profile?.familyId) return;
    const unsub = subscribeToChildren(profile.familyId, (c) => {
      setChildrenList(c.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0)));
    });
    return unsub;
  }, [profile?.familyId]);

  return (
    <FamilyContext.Provider value={{
      family, children: childrenList, rewards, loading, refresh: load,
    }}>
      {kids}
    </FamilyContext.Provider>
  );
}

export function useFamily() {
  const ctx = useContext(FamilyContext);
  if (!ctx) throw new Error('useFamily must be used within FamilyProvider');
  return ctx;
}
