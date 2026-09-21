'use client';

// 📴 Kaya Offline · the status kit (O1 · R5, approved 22-Sep-2026).
//
// Three small pieces, one file:
//   <OfflineSyncBoot/>  — mounts once in the (app) layout; wires the outbox
//                         sync engine's wake-ups (back-online, foreground,
//                         interval) and renders nothing.
//   <OfflineBanner/>    — the honest amber strip while there's no internet:
//                         "Kaya keeps everything safe on this phone."
//   <OutboxChip/>       — "📤 N photos waiting for internet" for a business
//                         (or the whole family), and the joy moment when the
//                         outbox drains: "Your photos made it to the Hive!"

import { useEffect, useRef, useState } from 'react';
import { initOutboxSync, subscribeOutbox, countQueuedPhotos, syncOutbox } from '@/lib/offlineOutbox';
import { useCelebrate } from '@/components/celebrate/CelebrationProvider';

export function OfflineSyncBoot() {
  useEffect(() => {
    initOutboxSync();
    // 📴 O3 — register the Kaya service worker for EVERYONE (it used to
    // register only when push was enabled). One worker, root scope: push
    // handlers + the offline app shell live in the same file, so this never
    // fights the push registration in lib/push.ts (same path).
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(() => { /* unsupported/blocked — fine */ });
    }
  }, []);
  return null;
}

/** Live navigator.onLine with event wiring. SSR-safe (assumes online). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);
  return online;
}

export function OfflineBanner({ className = '' }: { className?: string }) {
  const online = useOnline();
  if (online) return null;
  return (
    <div className={`bg-[#FCEAD6] border border-[#B25E16]/30 rounded-hive p-3 text-[12.5px] text-[#7a4410] font-nunito font-bold ${className}`.trim()}>
      📴 No internet right now — Kaya keeps everything safe on this phone.
    </div>
  );
}

/** Queued-photo chip + the drain celebration. Scope with businessId for a
 *  per-business count, or omit it for the family-wide number. */
export function OutboxChip({ familyId, businessId, className = '' }: {
  familyId?: string;
  businessId?: string;
  className?: string;
}) {
  const [count, setCount] = useState(0);
  const online = useOnline();
  const celebrate = useCelebrate();
  const sawQueued = useRef(false);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void countQueuedPhotos(familyId, businessId).then((n) => { if (alive) setCount(n); });
    };
    const unsub = subscribeOutbox(refresh);
    return () => { alive = false; unsub(); };
  }, [familyId, businessId]);

  // The joy moment: this surface watched photos wait, then saw them all land.
  useEffect(() => {
    if (count > 0) { sawQueued.current = true; return; }
    if (count === 0 && sawQueued.current) {
      sawQueued.current = false;
      celebrate({ kind: 'milestone', title: 'Your photos made it to the Hive! 📤🐝', subtitle: 'Everything from your offline days is safely up.' });
    }
  }, [count, celebrate]);

  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={() => { void syncOutbox(); }}
      title="Kaya sends these by itself when internet returns — tap to try now"
      className={`inline-flex items-center gap-1.5 bg-[#FFF4E0] border border-hive-honey-soft text-hive-honey-dk rounded-hive-pill px-3 py-1.5 text-[11.5px] font-nunito font-black ${className}`.trim()}
    >
      📤 {count} photo{count === 1 ? '' : 's'} waiting for internet{online ? ' · sending…' : ''}
    </button>
  );
}
