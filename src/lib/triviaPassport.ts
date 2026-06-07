'use client';

// Kaya World Passport — when a family plays Local Trivia for a country, they
// earn its stamp. Stored at families/{fid}/gameMeta/passport (family-owned).

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface Passport { countries: string[]; count: number }

function passportDoc(familyId: string) {
  return doc(db, 'families', familyId, 'gameMeta', 'passport');
}

export async function readPassport(familyId: string): Promise<Passport> {
  try {
    const snap = await getDoc(passportDoc(familyId));
    const d = snap.data() as { countries?: string[]; count?: number } | undefined;
    return { countries: Array.isArray(d?.countries) ? d!.countries! : [], count: Number(d?.count) || 0 };
  } catch { return { countries: [], count: 0 }; }
}

/** Stamp a country (idempotent — re-playing a country doesn't double-count). */
export async function recordCountryPlayed(familyId: string, code: string): Promise<void> {
  const c = (code || '').toUpperCase();
  if (!c) return;
  try {
    const cur = await readPassport(familyId);
    if (cur.countries.includes(c)) return;
    await setDoc(passportDoc(familyId), {
      countries: [...cur.countries, c], count: cur.count + 1, updatedAt: Date.now(),
    }, { merge: true });
  } catch { /* best-effort — the game still plays */ }
}
