'use client';

// Household → Subscriptions list view.
//
// P3 wires up the full list: live read of /families/{f}/subscriptions,
// KPIs from computeSubscriptionKpis (this month due / monthly equiv /
// annualized), category filter chips, and the EntryRow rendering per
// subscription. Add button routes to /new.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  subscribeToSubscriptions, computeSubscriptionKpis,
  SUBSCRIPTION_CATEGORIES, subCategoryEmoji, subCategoryLabel,
  SUBSCRIPTION_PLATFORMS, computePlatformBreakdown, platformLabel, subCountsTowardSpend,
  getGmailScanStatus, getGmailState, resolveGmailSuggestions, disconnectGmail,
  Subscription, SubscriptionCategory, type GmailState, type SubscriptionPlatform,
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
import ScanReceiptSheet, { type ReviewDraft } from '@/components/household/ScanReceiptSheet';

function tsToIso(ts: Subscription['nextBillingDate'] | null): string {
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
  // Status view: 'all' shows everything; default 'active' keeps held + stopped
  // out of the way until the parent asks for them. 'paused' = On hold,
  // 'cancelled' = Stopped.
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'cancelled'>('active');
  // Paid-via narrowing — now a primary axis across all subscriptions.
  const [platformFilter, setPlatformFilter] = useState<SubscriptionPlatform | null>(null);
  // Optional "Group by Paid-via" view (default off = flat list).
  const [groupByPlatform, setGroupByPlatform] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanToast, setScanToast] = useState('');
  // Gmail scheduled scan — env-gated. Connection state + pending suggestions.
  const [gmailConfigured, setGmailConfigured] = useState(false);
  const [gmailState, setGmailState] = useState<GmailState>({ connected: false, email: null, lastScanAtMs: null, suggestions: [] });
  const [reviewDrafts, setReviewDrafts] = useState<ReviewDraft[] | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);
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

  // Reload the parent's Gmail connection + pending suggestions.
  const loadGmailState = useCallback(() => {
    getGmailState().then(setGmailState).catch(() => {});
  }, []);

  // Is the Gmail scan available in this environment? (operator sets the
  // Google OAuth client env — until then the entry point stays hidden.)
  // When available, also load this parent's connection + suggestions.
  useEffect(() => {
    if (!profile || profile.role !== 'parent') return;
    let alive = true;
    getGmailScanStatus().then((ok) => {
      if (!alive) return;
      setGmailConfigured(ok);
      if (ok) loadGmailState();
    });
    return () => { alive = false; };
  }, [profile, loadGmailState]);

  // Returning from a connect (?gmailScan=…)? Surface the right toast and
  // refresh state so the suggestions banner appears. The flag is stripped
  // immediately so a refresh can't replay it.
  useEffect(() => {
    if (!profile || profile.role !== 'parent') return;
    const status = new URLSearchParams(window.location.search).get('gmailScan');
    if (!status) return;
    window.history.replaceState(null, '', '/household/subscriptions');
    if (status === 'connected') {
      setScanToast('✅ Gmail connected — Kaya found subscriptions for you to review below.');
      loadGmailState();
    } else if (status === 'connected_empty') {
      setScanToast('✅ Gmail connected — nothing new right now. Kaya will keep checking weekly.');
      loadGmailState();
    } else if (status === 'skipped') {
      setScanToast('AI is off in this preview — paste a receipt into “From receipt” instead.');
    } else if (status === 'cancelled') {
      setScanToast('Gmail connect cancelled — nothing was changed.');
    } else {
      setScanToast('Couldn’t complete the Gmail connect — please try again.');
    }
  }, [profile, loadGmailState]);

  // Kick off the read-only OAuth consent (full-page redirect).
  const connectGmail = () => {
    if (!profile?.familyId) return;
    window.location.href =
      `/api/subscriptions/gmail/start?familyId=${encodeURIComponent(profile.familyId)}&uid=${encodeURIComponent(profile.uid)}`;
  };

  const handleDisconnect = async () => {
    if (gmailBusy) return;
    setGmailBusy(true);
    try { await disconnectGmail(); loadGmailState(); setScanToast('Gmail disconnected — Kaya will stop checking.'); }
    finally { setGmailBusy(false); }
  };

  // Open the review sheet seeded with the family's pending Gmail suggestions.
  const reviewSuggestions = () => {
    if (gmailState.suggestions.length === 0) return;
    setReviewDrafts(gmailState.suggestions.map((s) => ({ ...s, suggestionId: s.id })));
    setScanOpen(true);
  };

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

  // Status bucket for a sub: trial folds into Active (both are "live").
  const statusBucket = (s: Subscription): 'active' | 'paused' | 'cancelled' =>
    s.status === 'paused' ? 'paused' : s.status === 'cancelled' ? 'cancelled' : 'active';

  // Counts per status bucket — live from the paid-by-scoped (not yet
  // category/status filtered) set, so the chip numbers stay stable.
  const statusCounts = useMemo(() => {
    const c = { all: paidByScopedSubs.length, active: 0, paused: 0, cancelled: 0 };
    for (const s of paidByScopedSubs) c[statusBucket(s)] += 1;
    return c;
  }, [paidByScopedSubs]);

  // Platform ("Paid via") breakdown across the current category + status scope
  // (before the platform chip narrows further) — drives the Paid-via chips,
  // the group-view section subtotals, and counts. Applies to every sub now,
  // not just Mobile Apps.
  const platformScoped = useMemo(
    () => paidByScopedSubs.filter(
      (s) => (!activeCategory || s.category === activeCategory)
        && (statusFilter === 'all' || statusBucket(s) === statusFilter),
    ),
    [paidByScopedSubs, activeCategory, statusFilter],
  );
  const platformBreakdown = useMemo(
    () => computePlatformBreakdown(platformScoped),
    [platformScoped],
  );

  const filtered = useMemo(
    () => paidByScopedSubs.filter((s) => {
      if (activeCategory && s.category !== activeCategory) return false;
      if (statusFilter !== 'all' && statusBucket(s) !== statusFilter) return false;
      if (platformFilter && (s.platform ?? 'other') !== platformFilter) return false;
      return true;
    }),
    [paidByScopedSubs, activeCategory, statusFilter, platformFilter],
  );

  // Group-view: the filtered list bucketed by Paid-via, ordered like
  // SUBSCRIPTION_PLATFORMS, each with its monthly subtotal.
  const platformGroups = useMemo(() => {
    const order = SUBSCRIPTION_PLATFORMS.map((p) => p.id);
    const groups = order
      .map((pid) => {
        const items = filtered.filter((s) => (s.platform ?? 'other') === pid);
        const monthly = items.reduce(
          (a, s) => a + (subCountsTowardSpend(s) ? (s.monthlyEquivalent || 0) : 0), 0,
        );
        return { platform: pid, items, monthly };
      })
      .filter((g) => g.items.length > 0);
    return groups;
  }, [filtered]);

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

  // One row renderer, shared by the flat list + the grouped view. Every row
  // carries a status pill (incl. ● Active) and leads its subtitle with the
  // Paid-via tag, with category as the detail behind it.
  const renderSubRow = (s: Subscription) => {
    const platEmoji = SUBSCRIPTION_PLATFORMS.find((p) => p.id === (s.platform ?? 'other'))?.emoji;
    return (
      <EntryRow
        key={s.id}
        href={`/household/subscriptions/${s.id}`}
        emoji={subCategoryEmoji(s.category)}
        title={s.name}
        dimmed={s.status === 'paused' || s.status === 'cancelled'}
        subtitle={
          <>
            <span className="font-bold text-pulse-navy/70">{platEmoji} {platformLabel(s.platform)}</span>
            <span className="text-pulse-navy/35"> · </span>
            <span>{subCategoryLabel(s.category)}</span>
          </>
        }
        rightTop={formatCents(s.amountHousehold, householdCurrency)}
        rightBottom={
          s.status === 'paused'
            ? 'On hold'
            : s.status === 'cancelled'
              ? `Ended ${toDisplayDate(tsToIso(s.endedOn)) || '—'}`
              : `Next ${toDisplayDate(tsToIso(s.nextBillingDate))}`
        }
        badges={
          <>
            <PaidByTag uid={s.paidByUid ?? null} parents={parents} />
            {s.status === 'active'    && <StatusBadge tone="green">● Active</StatusBadge>}
            {s.status === 'trial'     && <StatusBadge tone="gold">Trial</StatusBadge>}
            {s.status === 'paused'    && <StatusBadge tone="muted">On hold</StatusBadge>}
            {s.status === 'cancelled' && <StatusBadge tone="coral">Stopped</StatusBadge>}
            {s.billingMode === 'manual' && <StatusBadge tone="gold">Manual</StatusBadge>}
            {s.sourceModule === 'wealth' && <StatusBadge tone="muted">Wealth</StatusBadge>}
          </>
        }
      />
    );
  };

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
          <div className="shrink-0 flex flex-col items-end gap-1.5">
            <Link
              href="/household/subscriptions/new"
              className="rounded-full bg-pulse-navy px-4 py-2 font-display font-extrabold text-pulse-cream hover:bg-pulse-navy/90 transition-colors text-sm"
            >
              + Add
            </Link>
            <button
              type="button"
              onClick={() => { setReviewDrafts(null); setScanOpen(true); }}
              className="rounded-full bg-pulse-gold/15 border border-pulse-gold/40 px-3 py-1.5 font-display font-extrabold text-pulse-navy hover:bg-pulse-gold/25 transition-colors text-[12px]"
              title="Paste or upload an App Store / Play / service receipt — Kaya reads off the subscriptions for you."
            >
              📩 From receipt
            </button>
            {gmailConfigured && profile.familyId && !gmailState.connected && (
              <button
                type="button"
                onClick={connectGmail}
                className="rounded-full bg-white border border-pulse-navy/15 px-3 py-1.5 font-display font-extrabold text-pulse-navy hover:bg-pulse-navy/5 transition-colors text-[12px]"
                title="Connect Gmail (read-only) once — Kaya then checks weekly for new App Store / Play / streaming subscriptions. Nothing is added without your confirmation; disconnect any time."
              >
                ✉️ Connect Gmail
              </button>
            )}
            {gmailConfigured && gmailState.connected && (
              <div className="flex items-center gap-1.5">
                <span
                  title={gmailState.email ? `Connected: ${gmailState.email}` : 'Gmail connected'}
                  className="inline-flex items-center gap-1 rounded-full bg-pulse-green/12 border border-pulse-green/35 px-2.5 py-1 font-display font-extrabold text-pulse-green text-[11px]"
                >
                  ✉️ Gmail on
                </span>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={gmailBusy}
                  className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/45 hover:text-pulse-coral disabled:opacity-40"
                >
                  {gmailBusy ? '…' : 'Disconnect'}
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {scanToast && (
        <div className="mb-4 rounded-kaya bg-pulse-green/12 border border-pulse-green/35 text-pulse-green font-bold text-[13px] px-4 py-2.5">
          {scanToast}
        </div>
      )}

      {/* Gmail found new subscriptions — one tap to review + confirm. */}
      {profile.role === 'parent' && gmailState.suggestions.length > 0 && (
        <button
          type="button"
          onClick={reviewSuggestions}
          className="mb-4 w-full flex items-center justify-between gap-3 rounded-kaya bg-pulse-gold/12 border border-pulse-gold/45 px-4 py-3 text-left hover:bg-pulse-gold/20 transition-colors"
        >
          <span className="font-display font-extrabold text-[13.5px] text-pulse-navy">
            ✨ Kaya found {gmailState.suggestions.length} subscription{gmailState.suggestions.length === 1 ? '' : 's'} in your Gmail
          </span>
          <span className="shrink-0 rounded-full bg-pulse-navy px-3 py-1 font-display font-extrabold text-pulse-cream text-[12px]">
            Review
          </span>
        </button>
      )}

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
        <section className="mb-3">
          <FilterChips
            chips={chips}
            activeId={activeCategory}
            onChange={(id) => {
              const cat = id as SubscriptionCategory | null;
              setActiveCategory(cat);
              if (cat !== 'mobile_apps') setPlatformFilter(null);
            }}
          />
        </section>
      )}

      {/* Status view — All / Active / On hold / Stopped. Default Active keeps
          held + stopped out of the way until asked for. The hero KPIs above
          stay at live commitment regardless of this filter. */}
      <section className="mb-3">
        <FilterChips
          allLabel="All"
          chips={[
            { id: 'active',    label: 'Active',  count: statusCounts.active },
            { id: 'paused',    label: 'On hold', count: statusCounts.paused },
            { id: 'cancelled', label: 'Stopped', count: statusCounts.cancelled },
          ]}
          activeId={statusFilter === 'all' ? null : statusFilter}
          onChange={(id) => setStatusFilter((id as 'active' | 'paused' | 'cancelled' | null) ?? 'all')}
        />
      </section>

      {/* Paid via — the PRIMARY split (iOS / Android / Web / Other), across
          every subscription. Always visible, with a Group-by-Paid-via toggle. */}
      {platformBreakdown.length > 0 && (
        <section className="mb-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55">Paid via</span>
            <button
              type="button"
              onClick={() => setGroupByPlatform((v) => !v)}
              className={`rounded-full px-3 py-1 text-[11px] font-extrabold border transition ${
                groupByPlatform
                  ? 'bg-pulse-navy text-pulse-cream border-pulse-navy'
                  : 'bg-white text-pulse-navy/70 border-pulse-navy/15 hover:border-pulse-gold/60'
              }`}
            >
              ⊞ Group by Paid&nbsp;via
            </button>
          </div>
          {!groupByPlatform && (
            <FilterChips
              allLabel="All"
              chips={platformBreakdown.map((b) => ({
                id: b.platform,
                emoji: SUBSCRIPTION_PLATFORMS.find((p) => p.id === b.platform)?.emoji,
                label: platformLabel(b.platform),
                count: b.count,
              }))}
              activeId={platformFilter}
              onChange={(id) => setPlatformFilter(id as SubscriptionPlatform | null)}
            />
          )}
        </section>
      )}

      {loadingList ? (
        <div className="rounded-kaya bg-white border border-pulse-navy/10 p-8 text-center text-pulse-navy/60">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        subs.length === 0
          ? <EmptyState canAdd={profile.role === 'parent'} />
          : <NoMatchesState onClear={() => { setActiveCategory(null); setStatusFilter('active'); setPlatformFilter(null); }} />
      ) : groupByPlatform ? (
        <div className="space-y-4">
          {platformGroups.map((g) => (
            <div key={g.platform}>
              <div className="flex items-center justify-between gap-2 px-1 mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{SUBSCRIPTION_PLATFORMS.find((p) => p.id === g.platform)?.emoji}</span>
                  <span className="font-display font-extrabold text-pulse-navy text-sm">{platformLabel(g.platform)}</span>
                  <span className="text-[11px] font-semibold text-pulse-navy/50">{g.items.length} sub{g.items.length === 1 ? '' : 's'}</span>
                </div>
                <span className="font-display font-extrabold text-pulse-navy text-sm">
                  {formatCents(g.monthly, householdCurrency)}<span className="text-[11px] font-semibold text-pulse-navy/50"> /mo</span>
                </span>
              </div>
              <div className="space-y-2">{g.items.map(renderSubRow)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(renderSubRow)}
        </div>
      )}

      {profile.role === 'parent' && profile.familyId && (
        <ScanReceiptSheet
          open={scanOpen}
          onClose={() => { setScanOpen(false); setReviewDrafts(null); }}
          familyId={profile.familyId}
          uid={profile.uid}
          currency={householdCurrency}
          initialDrafts={reviewDrafts}
          onResolve={(added, dismissed) => { resolveGmailSuggestions(added, dismissed).then(loadGmailState); }}
          onImported={(n) => {
            setReviewDrafts(null);
            setScanToast(
              n > 0
                ? `✅ Added ${n} subscription${n === 1 ? '' : 's'} from your receipt.`
                : 'Nothing added — none were ticked.',
            );
          }}
        />
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
