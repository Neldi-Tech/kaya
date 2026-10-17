'use client';

// Kaya · 📱 App mode — "are we running inside the Kaya Android app?"
//
// The Android app is a Trusted Web Activity (android/): Chrome opens
// https://www.ourkaya.com full-screen with no browser bar. It launches with
// `?source=android-app` and Chrome sets `document.referrer` to
// `android-app://com.ourkaya.app/` on that first load.
//
// The flag lives in sessionStorage — NOT localStorage — because a TWA shares
// Chrome's storage for the origin: a persistent flag would leak "app mode"
// into ordinary Chrome tabs. Each app launch re-arms it.
//
// What app mode changes today: in-app purchase screens are replaced by a
// neutral "your plan" view (Google Play requires Play Billing for digital
// goods bought inside a Play app; families pay outside the app for now).

import { useEffect, useState } from 'react';

const KEY = 'kaya:appMode';

export function isAndroidApp(): boolean {
  if (typeof window === 'undefined') return false;
  try { if (window.sessionStorage.getItem(KEY) === 'android') return true; } catch { /* private mode */ }
  let hit = false;
  try {
    const p = new URLSearchParams(window.location.search);
    hit = p.get('source') === 'android-app' || document.referrer.startsWith('android-app://');
  } catch { /* noop */ }
  if (hit) { try { window.sessionStorage.setItem(KEY, 'android'); } catch { /* noop */ } }
  return hit;
}

/** React hook — false on the server and first paint, then the real answer. */
export function useIsAndroidApp(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => { setV(isAndroidApp()); }, []);
  return v;
}
