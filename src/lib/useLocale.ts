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
  const defaults = family?.memberLanguageDefaults;
  // Helpers: own choice → parent-set default → LOCAL country language.
  // The family default is skipped — a helper in TZ reads Swahili even in an
  // EN family unless the parent (or the helper) picked otherwise.
  if (profile?.role === 'helper') {
    return (
      asLocale(profile?.languagePref)
      ?? asLocale(defaults?.[profile?.uid ?? ''])
      ?? localeForCountry(family?.location?.country)
    );
  }
  // Kids: own choice → parent-set per-kid default → family default → country.
  if (profile?.role === 'kid') {
    return (
      asLocale(profile?.languagePref)
      ?? asLocale(defaults?.[profile?.childId ?? ''])
      ?? asLocale(family?.primaryLanguage)
      ?? localeForCountry(family?.location?.country)
    );
  }
  return (
    asLocale(profile?.languagePref)
    ?? asLocale(family?.primaryLanguage)
    ?? localeForCountry(family?.location?.country)
  );
}

/** Parent action: set (or clear with null) one person's language default.
 *  Key = childId for kids, auth uid for helpers. */
export async function setMemberLanguageDefault(
  familyId: string,
  memberKey: string,
  locale: Locale | null,
): Promise<void> {
  await updateDoc(doc(db, 'families', familyId), {
    [`memberLanguageDefaults.${memberKey}`]: locale ?? deleteField(),
  });
}

/** Set THIS person's language. Pass null to clear (follow the family default). */
export async function setUserLocale(uid: string, locale: Locale | null): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { languagePref: locale ?? deleteField() });
}

/** Set the FAMILY's default language (parent action). */
export async function setFamilyLocale(familyId: string, locale: Locale): Promise<void> {
  await updateDoc(doc(db, 'families', familyId), { primaryLanguage: locale });
}
