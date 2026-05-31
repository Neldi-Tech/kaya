'use client';

// Household → Subscriptions list view.
//
// P3 wires up the full list: live read of /families/{f}/subscriptions,
// KPIs from computeSubscriptionKpis (this month due / monthly equiv /
// annualized), category filter chips, and the EntryRow rendering per
// subscription. Add button routes to /new.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  subscribeToSubscriptions, computeSubscriptionKpis,
  SUBSCRIPTION_CATEGORIES, subCategoryEmoji, subCategoryLabel,
  Subscription, SubscriptionCategory,
} from '@/lib/subscriptions';
import { formatCents } from '@/components/pantry/format';
import { toDisplayDate } from '@/lib/dates';
import { KpiStrip } from '@/components/household/KpiStrip';
import { FilterChips } from '@/components/household/FilterChips';
import { EntryRow } from '@/components/household/EntryRow';
import { StatusBadge } from '@/components/household/StatusBadge';
import PaidByFilterRow, { PaidByTag } from '@/components/household/PaidByFilterRow';
import { type PaidByValue } from '@/components/household/PaidByPicker';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';

function tsToIso(ts: Subscription['nextBillingDate']): string {
  if (!ts) return '';
  const d = ts.toDate();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function SubscriptionsListPage() {
  const { profile, loading: authLoading } = useAuth();
  const { family } = useFamily();
  const router = useRouter();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeCategory, setActiveCategory] = useState<SubscriptionCategory | null>(null);
  // 'all' = no parent filter; null = Shared; uid = that parent
  const [paidByFilter, setPaidByFilter] = useState<PaidByValue | 'all'>('all');
  const [parents, setParents] = useState<UserProfile[]>([]);
  useEffect(() => {
    if (!profile?.familyId) return;
    let alive = true;
    (async () => {
      const members = await getFamilyMembers(profile.familyId);
      if (!alive) return;
      setParents(members.filter((m) => m.role === 'parent'));
    })();
    return () => { alive = false; };
  }, [profile?.familyId]);

  useEffect(() => {
    if (authLoading) return;
    if (!profile) { router.replace('/login'); return; }
    if (profile.role === 'kid') router.replace('/home');
  }, [profile, authLoading, router]);

  useEffect(() => {
    if (!profile?.familyId) return;
    return subscribeToSubscriptions(profile.familyId, (list) => {
      setSubs(list);
      setLoadingList(false);
    });
  }, [profile?.familyId]);

  const householdCurrency = family?.hiveConfig?.currency ?? 'USD';

  // KPIs reflect the active Paid-by scope (all / Shared / a parent) so the
  // hero cards change with the filter. Category chips still narrow the LIST
  // only — the hero stays at the attribution level so "this parent's monthly
  // commitment" reads true regardless of which category you're browsing.
  const paidByScopedSubs = useMemo(
    () => subs.filter((s) => paidByFilter === 'all' || (s.paidByUid ?? null) === paidByFilter),
    [subs, paidByFilter],
  );
  const kpis = useMemo(() => computeSubscriptionKpis(paidByScopedSubs), [paidByScopedSubs]);
  const filtered = useMemo(
    () => paidByScopedSubs.filter((s) => !activeCategory || s.category === activeCategory),
    [paidByScopedSubs, activeCategory],
  );

  // Label + tone for the hero so it's obvious whose numbers these are.
  const scopeMeta = useMemo(() => {
    if (paidByFilter === 'all') return { label: 'Everyone', tone: 'all' as const };
    if (paidByFilter === null) return { label: 'Shared only', tone: 'shared' as const };
    const p = parents.find((x) => x.uid === paidByFilter);
    const nm = (p?.displayName || p?.email || 'Parent').split(' ')[0];
    return { label: `${nm} only`, tone: 'parent' as const };
  }, [paidByFilter, parents]);
  // Counts per attribution bucket — live from the unfiltered subs.
  const paidByCounts = useMemo(() => {
    const c: Record<string, number> = { all: subs.length, shared: 0 };
    for (const s of subs) {
      const uid = s.paidByUid ?? null;
      if (uid === null) c.shared = (c.shared ?? 0) + 1;
      else c[uid] = (c[uid] ?? 0) + 1;
    }
    return c;
  }, [subs]);
  const chips = useMemo(() => {
    return SUBSCRIPTION_CATEGORIES
      .filter((c) => kpis.byCategory.has(c.id))
      .map((c) => ({ id: c.id, emoji: c.emoji, label: c.label.split(' ')[0], count: kpis.byCategory.get(c.id) }));
  }, [kpis]);

  if (authLoading || !profile) {
    return <div className="p-6 text-pulse-navy/60">Loading…</div>;
  }
  if (profile.role === 'kid') return null;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
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
        </div>
        {profile.role === 'parent' && (
          <Link
            href="/household/subscriptions/new"
            className="shrink-0 rounded-full bg-pulse-navy px-4 py-2 font-display font-extrabold text-pulse-cream hover:bg-pulse-navy/90 transition-colors text-sm"
          >
            + Add
          </Link>
        )}
      </header>

      <section className="mb-4">
        {/* Scope pill — makes it obvious the hero numbers below follow the
            Paid-by filter (Everyone / Shared / a specific parent). */}
        <div className="mb-2 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold ${
              scopeMeta.tone === 'all'
                ? 'bg-pulse-navy/8 text-pulse-navy/70'
                : 'bg-pulse-gold/15 text-pulse-navy border border-pulse-gold/40'
            }`}
          >
            {scopeMeta.tone === 'all' ? '👪' : scopeMeta.tone === 'shared' ? '👪' : '👤'} {scopeMeta.label}
          </span>
          {paidByFilter !== 'all' && (
            <button
              onClick={() => setPaidByFilter('all')}
              className="text-[11px] font-bold uppercase tracking-wide text-pulse-gold hover:underline"
            >
              Show everyone
            </button>
          )}
        </div>
        <KpiStrip
          items={[
            {
              label: 'This month due',
              value: formatCents(kpis.thisMonthDueCents, householdCurrency),
              sub: `${kpis.activeCount} active subscription${kpis.activeCount === 1 ? '' : 's'}`,
            },
            {
              label: 'Monthly equivalent',
              value: formatCents(kpis.monthlyEquivalentCents, householdCurrency),
              sub: scopeMeta.tone === 'all' ? 'Annualised smoothing' : `${scopeMeta.label} · smoothed`,
            },
            {
              label: 'Annualized',
              value: formatCents(kpis.annualizedCents, householdCurrency),
              sub: 'Locked-in commitment',
            },
          ]}
        />
      </section>

      {/* Filter by who's paying — sits above category chips so parents
          slice by attribution first, then by Netflix-vs-Disney etc. */}
      {profile.familyId && parents.length > 0 && (
        <section className="mb-3">
          <PaidByFilterRow
            familyId={profile.familyId}
            selected={paidByFilter}
            onChange={setPaidByFilter}
            counts={paidByCounts}
          />
        </section>
      )}

      {chips.length > 1 && (
        <section className="mb-4">
          <FilterChips
            chips={chips}
            activeId={activeCategory}
            onChange={(id) => setActiveCategory(id as SubscriptionCategory | null)}
          />
        </section>
      )}

      {loadingList ? (
        <div className="rounded-kaya bg-white border border-pulse-navy/10 p-8 text-center text-pulse-navy/60">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        subs.length === 0 ? <EmptyState canAdd={profile.role === 'parent'} /> : <NoMatchesState onClear={() => setActiveCategory(null)} />
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <EntryRow
              key={s.id}
              href={`/household/subscriptions/${s.id}`}
              emoji={subCategoryEmoji(s.category)}
              title={s.name}
              subtitle={
                <>
                  <span>{subCategoryLabel(s.category)}</span>
                  <span className="text-pulse-navy/35"> · </span>
                  <span>{s.subCategory}</span>
                </>
              }
              rightTop={formatCents(s.amountHousehold, householdCurrency)}
              rightBottom={`Next ${toDisplayDate(tsToIso(s.nextBillingDate))}`}
              badges={
                <>
                  <PaidByTag uid={s.paidByUid ?? null} parents={parents} />
                  {s.status === 'trial'  && <StatusBadge tone="gold">Trial</StatusBadge>}
                  {s.status === 'paused' && <StatusBadge tone="muted">Paused</StatusBadge>}
                  {s.billingMode === 'manual' && <StatusBadge tone="gold">Manual</StatusBadge>}
                  {s.sourceModule === 'wealth' && <StatusBadge tone="muted">Wealth</StatusBadge>}
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ canAdd }: { canAdd: boolean }) {
  return (
    <div className="rounded-kaya bg-pulse-cream border border-pulse-navy/10 px-6 py-10 text-center">
      <div className="text-4xl">🔁</div>
      <h2 className="mt-3 font-display text-xl font-extrabold text-pulse-navy">
        No subscriptions yet
      </h2>
      <p className="mt-2 max-w-md mx-auto text-sm font-semibold text-pulse-navy/65">
        Log everything that bills you on a cycle — apps, memberships, streaming, land rent.
        Each entry locks at today&apos;s FX rate.
      </p>
      {canAdd && (
        <Link
          href="/household/subscriptions/new"
          className="mt-4 inline-block rounded-full bg-pulse-navy px-5 py-2 font-display font-extrabold text-pulse-cream hover:bg-pulse-navy/90 transition-colors text-sm"
        >
          + Add the first one
        </Link>
      )}
    </div>
  );
}

function NoMatchesState({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-kaya bg-pulse-cream border border-pulse-navy/10 px-6 py-8 text-center">
      <p className="text-sm font-semibold text-pulse-navy/70">No subscriptions in this category yet.</p>
      <button
        onClick={onClear}
        className="mt-2 text-xs font-bold uppercase tracking-wide text-pulse-gold hover:underline"
      >
        Show all
      </button>
    </div>
  );
}
