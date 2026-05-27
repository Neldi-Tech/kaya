'use client';

// Household landing — the entry tile for the two new sub-modules in
// the spec (Contributions + Subscriptions). Sits at /household. The
// existing pantry/utilities/outdoor/drivers/payroll surfaces still
// live under /pantry/* and are reached via the Household section in
// the sidebar. This page is just a quick chooser for people who land
// at the bare /household URL.

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function HouseholdLandingPage() {
  const { profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!profile) router.replace('/login');
    if (profile && profile.role !== 'parent' && profile.role !== 'helper') {
      router.replace('/home');
    }
  }, [profile, loading, router]);

  if (loading || !profile) {
    return <div className="p-6 text-pulse-navy/60">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-extrabold text-pulse-navy">
          Household money
        </h1>
        <p className="mt-1 text-sm font-semibold text-pulse-navy/60">
          What goes out, who it goes to — tracked alongside Pantry, Utilities, Outdoor.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <HouseholdCard
          href="/household/contributions"
          emoji="🤝"
          title="Contributions"
          blurb="Gifts, tithes, condolences (msiba), charity, family support."
        />
        <HouseholdCard
          href="/household/subscriptions"
          emoji="🔁"
          title="Subscriptions"
          blurb="Recurring or one-off subscriptions — apps, memberships, media, property dues."
        />
      </div>

      <p className="mt-6 text-xs text-pulse-navy/50">
        Other Household surfaces (Pantry, Utilities, Outdoor, Drivers, Payroll) live in
        the sidebar under <span className="font-semibold">Household</span>.
      </p>
    </div>
  );
}

function HouseholdCard({
  href, emoji, title, blurb,
}: { href: string; emoji: string; title: string; blurb: string }) {
  return (
    <Link
      href={href}
      className="block rounded-kaya bg-white border border-pulse-navy/10 px-5 py-5 hover:border-pulse-gold/60 hover:shadow-md transition-shadow"
    >
      <div className="text-3xl">{emoji}</div>
      <div className="mt-3 font-display text-xl font-extrabold text-pulse-navy">
        {title}
      </div>
      <div className="mt-1 text-sm font-semibold text-pulse-navy/65">
        {blurb}
      </div>
      <div className="mt-3 text-xs font-bold uppercase tracking-wide text-pulse-gold">
        Open →
      </div>
    </Link>
  );
}
