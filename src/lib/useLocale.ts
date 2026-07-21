'use client';

// useLocale — resolves the active language for the current person using the
// chain: their own choice → the family's primary language → the country →
// English. Backed by lib/i18n. Setters persist the choice (per-user, or the
// family default for parents).

import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { asLocale, localeForCountry, type Locale } from '@/lib/i18n';

export function useLocale(): Locale {
  const { profile } = useAuth();
  const { family } = useFamily();
  // Helpers: the LOCAL language is primary (own choice → country), skipping
  // the family default — a helper in TZ reads Swahili even in an EN family.
  if (profile?.role === 'helper') {
    return asLocale(profile?.languagePref) ?? localeForCountry(family?.location?.country);
  }
  return (
    asLocale(profile?.languagePref)
    ?? asLocale(family?.primaryLanguage)
    ?? localeForCountry(family?.location?.country)
  );
}

/** Set THIS person's language. Pass null to clear (follow the family default). */
export async function setUserLocale(uid: string, locale: Locale | null): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { languagePref: locale ?? deleteField() });
}

/** Set the FAMILY's default language (parent action). */
export async function setFamilyLocale(familyId: string, locale: Locale): Promise<void> {
  await updateDoc(doc(db, 'families', familyId), { primaryLanguage: locale });
}
