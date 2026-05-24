'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

const REF_STORAGE_KEY = 'kaya.ref';

// Preserves the referral program when someone lands on the marketing page
// via an invite link (?ref=CODE). Silently stashes the code so onboarding
// can credit the referrer later — same capture the old /welcome page did.
// Must be rendered inside <Suspense> (useSearchParams). Renders nothing.
export default function RefCapture() {
  const searchParams = useSearchParams();
  const refCode = searchParams.get('ref');

  useEffect(() => {
    if (!refCode) return;
    try {
      window.localStorage.setItem(REF_STORAGE_KEY, refCode.toUpperCase());
    } catch {
      /* private mode / storage disabled — non-critical */
    }
  }, [refCode]);

  return null;
}
