'use client';

// Client-side branding hook. Live-subscribes to /config/branding so any
// admin edit flows through to every app-shell page without a reload.
//
// Reads are allowed for any signed-in user (rules); writes require
// operator role (enforced in /api/admin/branding and in rules).

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { DEFAULT_BRANDING, type BrandingConfig } from './branding';

export function useBranding(): BrandingConfig {
  const [cfg, setCfg] = useState<BrandingConfig>(DEFAULT_BRANDING);
  useEffect(() => {
    const ref = doc(db, 'config', 'branding');
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) { setCfg(DEFAULT_BRANDING); return; }
      const raw = snap.data() as Partial<BrandingConfig>;
      setCfg({ ...DEFAULT_BRANDING, ...raw });
    }, () => setCfg(DEFAULT_BRANDING));
    return () => unsub();
  }, []);
  return cfg;
}
