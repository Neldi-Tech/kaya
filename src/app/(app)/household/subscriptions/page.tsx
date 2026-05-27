'use client';

// Household → Subscriptions list view.
//
// P1 ships the layout, KPI strip + live read of /families/{f}/subscriptions.
// Auto/Manual toggle, catalogue search, the FX-locked currency input + the
// receipts/cycles/reminders all land in P3/P4.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeToSubscriptions, Subscription } from '@/lib/subscriptions';
import { KpiStrip } from '@/components/household/KpiStrip';

export default function SubscriptionsListPage() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!profile) {
      router.replace('/login');
      return;
    }
    // Parents + helpers can read (per Firestore rules); kids cannot.
    if (profile.role === 'kid') {
      router.replace('/home');
    }
  }, [profile, authLoading, router]);

  useEffect(() => {
    if (!profile?.familyId) return;
    const unsub = subscribeToSubscriptions(profile.familyId, (list) => {
      setSubs(list);
      setLoadingList(false);
    });
    return unsub;
  }, [profile?.familyId]);

  if (authLoading || !profile) {
    return <div className="p-6 text-pulse-navy/60">Loading…</div>;
  }
  if (profile.role === 'kid') return null;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <div className="text-xs font-bold uppercase tracking-wide text-pulse-gold">
          Household
        </div>
        <h1 className="mt-1 font-display text-3xl font-extrabold text-pulse-navy">
          Subscriptions
        </h1>
        <p className="mt-1 text-sm font-semibold text-pulse-navy/60">
          Recurring or one-off subscriptions — apps, memberships, streaming, property dues.
          Auto vs Manual is the primary toggle; Manual gets pre-due reminders + post-due check.
        </p>
      </header>

      <section className="mb-6">
        <KpiStrip
          items={[
            { label: 'This month due',         value: '—', sub: 'Live in P3' },
            { label: 'Monthly equivalent',     value: '—', sub: 'Live in P3' },
            { label: 'Annualized commitment',  value: '—', sub: 'Live in P3' },
          ]}
        />
      </section>

      {loadingList ? (
        <div className="rounded-kaya bg-white border border-pulse-navy/10 p-8 text-center text-pulse-navy/60">
          Loading…
        </div>
      ) : subs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-kaya bg-white border border-pulse-navy/10 p-8 text-center text-pulse-navy/60">
          {subs.length} subscriptions — row rendering ships with the Add flow in P3.
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-kaya bg-pulse-cream border border-pulse-navy/10 px-6 py-10 text-center">
      <div className="text-4xl">🔁</div>
      <h2 className="mt-3 font-display text-xl font-extrabold text-pulse-navy">
        No subscriptions yet
      </h2>
      <p className="mt-2 max-w-md mx-auto text-sm font-semibold text-pulse-navy/65">
        Adding a subscription — with the Auto/Manual toggle, catalogue search,
        and the household-currency lock — ships in the next release.
      </p>
    </div>
  );
}
