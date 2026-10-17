'use client';

// Arms app mode on the very first load (before a login redirect drops the
// `?source=android-app` param) and tags <html data-app="android"> so CSS
// can adapt if ever needed.
import { useEffect } from 'react';
import { isAndroidApp } from '@/lib/appMode';

export default function AppModeBoot() {
  useEffect(() => {
    if (isAndroidApp()) document.documentElement.dataset.app = 'android';
  }, []);
  return null;
}
