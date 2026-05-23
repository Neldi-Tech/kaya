'use client';

// UpdatePrompt — fixes "my installed phone app doesn't get new features".
//
// An installed PWA (esp. iOS) keeps its web view alive in the background;
// reopening resumes the SAME in-memory page instead of fetching the new
// deploy — so freshly-shipped features never appear until it's force-
// killed. This compares the build baked into the running bundle
// (NEXT_PUBLIC_BUILD_ID) against the live deployment (/api/version) when
// the app regains focus, and offers a one-tap refresh when they differ.
//
// Safe by design: only a banner (never an auto-reload), and it no-ops
// unless BOTH ids are real and different — so it never nags in dev or
// when offline.

import { useEffect, useState } from 'react';

const RUNNING_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
const POLL_MS = 5 * 60 * 1000;

export default function UpdatePrompt() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (RUNNING_BUILD === 'dev') return; // local / unknown build — don't nag
    let cancelled = false;

    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { build?: string };
        const live = typeof data.build === 'string' ? data.build : '';
        if (!cancelled && live && live !== 'dev' && live !== RUNNING_BUILD) {
          setStale(true);
        }
      } catch {
        /* offline or transient — ignore */
      }
    };

    check();
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    const id = window.setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(id);
    };
  }, []);

  if (!stale) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-[100] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 bg-hive-navy text-white rounded-hive-pill pl-4 pr-2 py-2 shadow-2xl">
        <span className="text-[13px] font-nunito font-extrabold">✨ New version of Kaya is ready</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-white text-hive-navy rounded-hive-pill px-3 py-1.5 text-[12px] font-nunito font-black"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
