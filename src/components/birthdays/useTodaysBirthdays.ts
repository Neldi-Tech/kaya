'use client';

// Kaya · Birthdays — shared client hook. Assembles today's birthday people
// from the live family (children via useFamily, adults via getFamilyMembers)
// plus the per-day celebration state on the family doc (family.birthdays,
// written by the /api/birthdays/* admin routes).

import { useEffect, useMemo, useState } from 'react';
import { useFamily } from '@/contexts/FamilyContext';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';
import {
  todaysBirthdays, type BirthdayPerson, type BirthdayPersonSource, type BirthdayDayState,
} from '@/lib/birthdays';

export function useTodaysBirthdays(familyId: string | undefined): {
  people: BirthdayPerson[];
  state: Record<string, BirthdayDayState>;
} {
  const { family, children } = useFamily();
  const [members, setMembers] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!familyId) return;
    let off = false;
    getFamilyMembers(familyId).then((m) => { if (!off) setMembers(m); }).catch(() => {});
    return () => { off = true; };
  }, [familyId]);

  const people = useMemo(() => {
    const sources: BirthdayPersonSource[] = [];
    for (const c of children) {
      sources.push({
        id: c.id, kind: 'kid', name: c.name,
        birthday: c.birthday, gender: c.gender,
        interests: c.interests, aspirations: c.aspirations,
        email: c.loginEnabled ? c.email : undefined,
      });
    }
    for (const m of members) {
      if (m.role !== 'parent' && m.role !== 'helper') continue;
      sources.push({
        id: m.uid, kind: 'adult', name: m.displayName || 'Family member',
        birthday: m.birthday, gender: m.gender,
        privacy: m.birthdayPrivacy || 'partial',
      });
    }
    return todaysBirthdays(sources);
  }, [children, members]);

  const state = useMemo(
    () => ((family as unknown as { birthdays?: Record<string, BirthdayDayState> })?.birthdays) || {},
    [family],
  );

  return { people, state };
}
