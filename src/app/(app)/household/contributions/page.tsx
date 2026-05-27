'use client';

// Household → Contributions list view.
//
// P2 wires up the full list: live read of /families/{f}/contributions,
// KPI strip + GivingProgress driven by computeContributionKpis (no
// ledger read needed — every contrib doc carries amountHousehold +
// dateGiven), filter chips by category, and the EntryRow rendering for
// each contribution. Add button routes to /new.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  subscribeToContributions, computeContributionKpis,
  CONTRIBUTION_CATEGORIES, categoryEmoji, categoryLabel,
  Contribution, ContributionCategory,
} from '@/lib/contributions';
import { formatCents } from '@/components/pantry/format';
import { toDisplayDate } from '@/lib/dates';
import { KpiStrip } from '@/components/household/KpiStrip';
import { GivingProgress } from '@/components/household/GivingProgress';
import { FilterChips } from '@/components/household/FilterChips';
import { EntryRow } from '@/components/household/EntryRow';
import { StatusBadge } from '@/components/household/StatusBadge';

function tsToIso(ts: Contribution['dateGiven']): string {
  if (!ts) return '';
  const d = ts.toDate();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function ContributionsListPage() {
  const { profile, loading: authLoading } = useAuth();
  const { family } = useFamily();
  const router = useRouter();
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeCategory, setActiveCategory] = useState<ContributionCategory | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!profile) { router.replace('/login'); return; }
    if (profile.role !== 'parent') router.replace('/household');
  }, [profile, authLoading, router]);

  useEffect(() => {
    if (!profile?.familyId) return;
    const unsub = subscribeToContributions(profile.familyId, (list) => {
      setContribs(list);
      setLoadingList(false);
    });
    return unsub;
  }, [profile?.familyId]);

  const householdCurrency = family?.hiveConfig?.currency ?? 'USD';

  // Derived
  const kpis = useMemo(() => computeContributionKpis(contribs), [contribs]);
  const filtered = useMemo(
    () => activeCategory ? contribs.filter((c) => c.category === activeCategory) : contribs,
    [contribs, activeCategory],
  );
  const chips = useMemo(() => {
    const counts = new Map<ContributionCategory, number>();
    for (const c of contribs) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    return CONTRIBUTION_CATEGORIES
      .filter((c) => counts.has(c.id))
      .map((c) => ({ id: c.id, emoji: c.emoji, label: c.label.split(' ')[0], count: counts.get(c.id) }));
  }, [contribs]);

  if (authLoading || !profile) {
    return <div className="p-6 text-pulse-navy/60">Loading…</div>;
  }
  if (profile.role !== 'parent') return null;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
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
        </div>
        <Link
          href="/household/contributions/new"
          className="shrink-0 rounded-full bg-pulse-navy px-4 py-2 font-display font-extrabold text-pulse-cream hover:bg-pulse-navy/90 transition-colors text-sm"
        >
          + Add
        </Link>
      </header>

      {/* KPIs — quick numbers on top, deeper widget below */}
      <section className="mb-4">
        <KpiStrip
          items={[
            {
              label: 'YTD total',
              value: formatCents(kpis.ytdTotalCents, householdCurrency),
              sub: `${contribs.length} entr${contribs.length === 1 ? 'y' : 'ies'}`,
            },
            {
              label: 'This month',
              value: formatCents(kpis.thisMonthCents, householdCurrency),
            },
            {
              label: 'Tithe %',
              value: kpis.tithePercent != null ? `${kpis.tithePercent.toFixed(1)}%` : '—',
              sub: kpis.tithePercent != null ? 'Of recorded income' : 'Add a tithe with income basis',
            },
          ]}
        />
      </section>

      {/* Giving progress — top recipients + tithe header */}
      {contribs.length > 0 && (
        <section className="mb-5">
          <GivingProgress kpis={kpis} householdCurrency={householdCurrency} />
        </section>
      )}

      {/* Filters */}
      {chips.length > 1 && (
        <section className="mb-4">
          <FilterChips
            chips={chips}
            activeId={activeCategory}
            onChange={(id) => setActiveCategory(id as ContributionCategory | null)}
          />
        </section>
      )}

      {/* List */}
      {loadingList ? (
        <div className="rounded-kaya bg-white border border-pulse-navy/10 p-8 text-center text-pulse-navy/60">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        contribs.length === 0 ? <EmptyState /> : <NoMatchesState onClear={() => setActiveCategory(null)} />
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <EntryRow
              key={c.id}
              href={`/household/contributions/${c.id}`}
              emoji={categoryEmoji(c.category)}
              title={c.recipientName}
              subtitle={
                <>
                  <span>{categoryLabel(c.category)}</span>
                  <span className="text-pulse-navy/35"> · </span>
                  <span>{c.subCategory}</span>
                </>
              }
              rightTop={formatCents(c.amountHousehold, householdCurrency)}
              rightBottom={toDisplayDate(tsToIso(c.dateGiven))}
              badges={
                <>
                  {c.visibility === 'family' && <StatusBadge tone="green">Kid-visible</StatusBadge>}
                  {c.taxDeductible            && <StatusBadge tone="gold">Tax</StatusBadge>}
                  {c.anonymousFlag            && <StatusBadge tone="neutral">Anon</StatusBadge>}
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-kaya bg-pulse-cream border border-pulse-navy/10 px-6 py-10 text-center">
      <div className="text-4xl">🤲</div>
      <h2 className="mt-3 font-display text-xl font-extrabold text-pulse-navy">
        No contributions logged yet
      </h2>
      <p className="mt-2 max-w-md mx-auto text-sm font-semibold text-pulse-navy/65">
        Log gifts, tithes, msiba, charity. Each entry locks at today&apos;s FX rate
        and shows up in this month&apos;s and the YTD total.
      </p>
      <Link
        href="/household/contributions/new"
        className="mt-4 inline-block rounded-full bg-pulse-navy px-5 py-2 font-display font-extrabold text-pulse-cream hover:bg-pulse-navy/90 transition-colors text-sm"
      >
        + Add the first one
      </Link>
    </div>
  );
}

function NoMatchesState({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-kaya bg-pulse-cream border border-pulse-navy/10 px-6 py-8 text-center">
      <p className="text-sm font-semibold text-pulse-navy/70">No contributions in this category yet.</p>
      <button
        onClick={onClear}
        className="mt-2 text-xs font-bold uppercase tracking-wide text-pulse-gold hover:underline"
      >
        Show all
      </button>
    </div>
  );
}
