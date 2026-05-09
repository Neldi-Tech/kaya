'use client';

// /pantry/list/active — convenience redirect. Sends the user to the
// currently-open list, or to /pantry to start one if nothing's active.
// Used by the "List" tab in the bottom nav so kids/helpers don't have
// to know the list id.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePantry } from '@/contexts/PantryContext';

export default function ActiveListRedirect() {
  const router = useRouter();
  const { currentList, loading } = usePantry();
  useEffect(() => {
    if (loading) return;
    if (currentList) router.replace(`/pantry/list/${currentList.id}`);
    else router.replace('/pantry');
  }, [loading, currentList, router]);
  return (
    <div className="mx-auto max-w-md w-full px-4 pt-16 text-center text-hive-muted text-sm">
      Loading…
    </div>
  );
}
