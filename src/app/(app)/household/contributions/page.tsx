'use client';

// Household → Contributions list view.
//
// P1 ships the layout, KPI strip + live read of /families/{f}/contributions.
// Almost every family will land here empty — that's the design intent. The
// Add flow + tithe % + occasion grouping + ledger writes land in P2.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { subscribeToContributions, Contribution } from '@/lib/contributions';
import { KpiStrip } from '@/components/household/KpiStrip';

export default function ContributionsListPage() {
  const { profile, loading: authLoading } = useAuth();
  const { family } = useFamily();
  const router = useRouter();
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!profile) {
      router.replace('/login');
      return;
    }
    // Spec §1: parents-only by default.
    if (profile.role !== 'parent') {
      router.replace('/household');
    }
  }, [profile, authLoading, router]);

  useEffect(() => {
    if (!profile?.familyId) return;
    const unsub = subscribeToContributions(profile.familyId, (list) => {
      setContribs(list);
      setLoadingList(false);
    });
    return unsub;
  }, [profile?.familyId]);

  if (authLoading || !profile) {
    return <div className="p-6 text-pulse-navy/60">Loading…</div>;
  }
  if (profile.role !== 'parent') return null;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <div className="text-xs font-bold uppercase tracking-wide text-pulse-gold">
          Household
        </div>
        <h1 className="mt-1 font-display text-3xl font-extrabold text-pulse-navy">
          Contributions
        </h1>
        <p className="mt-1 text-sm font-semibold text-pulse-navy/60">
          Gifts, tithes, msiba, charity. Parents-only by default; mark a single entry
          family-visible to share a teaching moment.
        </p>
      </header>

      <section className="mb-6">
        <KpiStrip
          items={[
            { label: 'YTD total',      value: '—', sub: 'Live in P2' },
            { label: 'This month',     value: '—', sub: 'Live in P2' },
            { label: 'Tithe % of income', value: '—', sub: 'When Wealth income lands' },
          ]}
        />
      </section>

      {loadingList ? (
        <div className="rounded-kaya bg-white border border-pulse-navy/10 p-8 text-center text-pulse-navy/60">
          Loading…
        </div>
      ) : contribs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-kaya bg-white border border-pulse-navy/10 p-8 text-center text-pulse-navy/60">
          {contribs.length} entries — list rendering ships with the Add flow in P2.
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-kaya bg-pulse-cream border border-pulse-navy/10 px-6 py-10 text-center">
      <div className="text-4xl">🤝</div>
      <h2 className="mt-3 font-display text-xl font-extrabold text-pulse-navy">
        No contributions logged yet
      </h2>
      <p className="mt-2 max-w-md mx-auto text-sm font-semibold text-pulse-navy/65">
        Adding a contribution — with tithe %, occasion grouping (Jane &amp; Mark&apos;s wedding,
        Mama Asha&apos;s msiba) and an instant household-currency lock — comes in the next release.
      </p>
    </div>
  );
}
