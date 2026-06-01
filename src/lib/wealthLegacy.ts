// Kaya Wealth · Legacy & Next of Kin (Phase 2 · PR8 · 2026-06-01).
//
// SETUP ONLY for now (Elia 2026-06-01): the family configures the inactivity
// period, pre-release check-ins, and their next of kin. The ACTUAL release of
// a personal vault on inactivity is deliberately NOT built here — it's legally
// sensitive and waits for a legal-reviewed pass. So nothing here ever transfers
// anything; it only stores intent.
//
// Owner-only: users/{uid}/legacy/config. Min inactivity is 6 months; at least
// two next of kin are recommended before any future release could ever run.

'use client';

import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

export type KinStatus = 'pending' | 'verified';

export interface KinEntry {
  id: string;
  name: string;
  relationship: string;
  contact: string;        // email/phone, optional
  order: number;
  status: KinStatus;      // 'pending' until the (future) verification flow runs
}

export interface LegacyConfig {
  inactivityMonths: number;   // >= 6
  checkInsOn: boolean;
  kin: KinEntry[];
}

export const MIN_INACTIVITY_MONTHS = 6;
const DEFAULTS: LegacyConfig = { inactivityMonths: MIN_INACTIVITY_MONTHS, checkInsOn: true, kin: [] };

const legacyRef = (uid: string) => doc(db, 'users', uid, 'legacy', 'config');

export function subscribeLegacy(uid: string, cb: (c: LegacyConfig) => void): () => void {
  if (isGuestActive()) { cb(DEFAULTS); return () => {}; }
  return onSnapshot(
    legacyRef(uid),
    (snap) => {
      const d = snap.data() as Partial<LegacyConfig> | undefined;
      cb({
        inactivityMonths: Math.max(MIN_INACTIVITY_MONTHS, d?.inactivityMonths ?? MIN_INACTIVITY_MONTHS),
        checkInsOn: d?.checkInsOn ?? true,
        kin: (d?.kin ?? []).slice().sort((a, b) => a.order - b.order),
      });
    },
    () => cb(DEFAULTS),
  );
}

export async function saveLegacy(uid: string, patch: Partial<LegacyConfig>): Promise<void> {
  if (isGuestActive()) return;
  await setDoc(legacyRef(uid), patch, { merge: true });
}

export function newKinId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
