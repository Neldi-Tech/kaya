'use client';

// /pantry/people — legacy redirect to /pantry/workplan.
//
// The page was renamed in v4-final Step 6 (2026-05-18). Old links
// (browser bookmarks, /helper page entry, anything we missed updating)
// land here and bounce immediately. Keep this around indefinitely —
// it's cheap, and link rot is worse than a redirect file.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PantryPeopleRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/pantry/workplan');
  }, [router]);
  return (
    <div className="mx-auto max-w-md w-full px-4 pt-16 text-center text-hive-muted text-sm">
      Redirecting…
    </div>
  );
}
