'use client';

// Household → Subscriptions → Add form.
//
// AutoManualToggle is THE field that drives behaviour (spec §3.7) —
// reminder defaults flip from [] (Auto) to [7,2,0] (Manual). Catalogue
// search pre-fills category + currency when the user picks a known item.
// FX locks at submit time and never reconverts.
//
// On submit: POST /api/subscriptions/create writes the entry + seeds
// the first cycle row in one transaction.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  SUBSCRIPTION_CATEGORIES, SUBSCRIPTION_SUBCATEGORIES,
  type SubscriptionCategory, type SubscriptionFrequency,
  type SubscriptionBillingMode, type SubscriptionPlatform,
  createSubscription,
} from '@/lib/subscriptions';
import {
  subscribeToCatalogueSubs, recordSubCatalogueUse,
  type CatalogueSubItem,
} from '@/lib/householdCatalogue';
import { filterGlobalSubsForCountry } from '@/lib/globalCatalogue';
import { Timestamp } from 'firebase/firestore';
import { AutoManualToggle } from '@/components/household/AutoManualToggle';
import PaidByPicker, { type PaidByValue } from '@/components/household/PaidByPicker';
import { CatalogueSearch, type CatalogueSelection } from '@/components/household/CatalogueSearch';
import { CurrencyAmountInput, type CurrencyAmountValue } from '@/components/household/CurrencyAmountInput';
import { FrequencyPicker, SUB_FREQUENCY_OPTIONS } from '@/components/household/FrequencyPicker';

const PLATFORMS: { id: SubscriptionPlatform; label: string }[] = [
  { id: 'ios',     label: 'iOS' },
  { id: 'android', label: 'Android' },
  { id: 'web',     label: 'Web / SaaS' },
  { id: 'other',   label: 'Other' },
];

function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function nextMonthIso(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function newClientToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'tok_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function NewSubscriptionPage() {
  const { profile, loading: authLoading } = useAuth();
  const { family } = useFamily();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    if (!profile) { router.replace('/login'); return; }
    if (profile.role !== 'parent') router.replace('/household');
  }, [profile, authLoading, router]);

  // ── Catalogue live read for the search dropdown ──
  const [catalogue, setCatalogue] = useState<CatalogueSubItem[]>([]);
  useEffect(() => {
    if (!profile?.familyId) return;
    return subscribeToCatalogueSubs(profile.familyId, setCatalogue);
  }, [profile?.familyId]);

  // ── Form state ──
  const householdCurrency = family?.hiveConfig?.currency ?? 'USD';
  const country = family?.location?.country || 'TZ';

  // Merge family catalogue with the global curated library so users see
  // common services (Netflix, Spotify, DStv…) on first add. Globals are
  // tagged with `global:<id>` so the submit handler treats them as new
  // family entries rather than passing the synthetic id to Firestore.
  const mergedCatalogue = useMemo<CatalogueSubItem[]>(() => {
    const familyNames = new Set(catalogue.map((c) => c.name.toLowerCase()));
    const epoch = Timestamp.fromMillis(0);
    const globals = filterGlobalSubsForCountry(country)
      .filter((g) => !familyNames.has(g.name.toLowerCase()))
      .map<CatalogueSubItem>((g) => ({
        id: `global:${g.id}`,
        name: g.name,
        category: g.category,
        subCategory: g.subCategory,
        defaultPlatform: g.defaultPlatform,
        defaultCurrency: householdCurrency,
        iconKey: g.emoji,
        hideFromSuggestions: false,
        usageCount: 0,
        createdAt: epoch,
      }));
    return [...catalogue, ...globals];
  }, [catalogue, country, householdCurrency]);
  const [selection, setSelection]   = useState<CatalogueSelection>({ id: null, name: '' });
  const [category, setCategory]     = useState<SubscriptionCategory>('mobile_apps');
  const [subCategory, setSubCategory] = useState<string>(SUBSCRIPTION_SUBCATEGORIES.mobile_apps[0]);
  const [platform, setPlatform]     = useState<SubscriptionPlatform | null>(null);

  const [billingMode, setBillingMode] = useState<SubscriptionBillingMode>('auto');
  // 2026-05-30 — `notifyAutoRenewal` retired in favour of an explicit
  // chip picker (any combination of 0 / 1 / 2 / 3 / 7 / 14 / 30 days
  // before billing). Defaults seed with the old behaviour so existing
  // flows don't regress: Manual = [7, 2, 0]; Auto = [] (no reminders).
  const [reminderDaysPicked, setReminderDaysPicked] = useState<number[]>(
    billingMode === 'manual' ? [7, 2, 0] : [],
  );
  // When the parent flips Manual ↔ Auto, refresh the default unless
  // they've already touched the chips (touched flag below).
  const [reminderTouched, setReminderTouched] = useState(false);
  // 2026-05-30 — per-parent attribution. Defaults to current user
  // (the parent who's creating the entry) so the common case of "I
  // just signed up for Netflix" tags as my cost without an extra tap.
  // Parents flip to Shared / the other parent via the picker.
  const [paidByUid, setPaidByUid] = useState<PaidByValue>(null);
  useEffect(() => {
    // Seed once the auth profile loads.
    if (profile?.uid && paidByUid === null) {
      setPaidByUid(profile.uid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

  const [amount, setAmount] = useState<CurrencyAmountValue>({
    amountCents: 0,
    currency: householdCurrency,
    fxRate: 1,
    amountHouseholdCents: 0,
    fxResolved: true,
  });

  const [frequency, setFrequency]   = useState<SubscriptionFrequency>('monthly');
  const [customMonths, setCustomMonths] = useState<number | null>(null);
  const [nextBillingIso, setNextBillingIso] = useState(nextMonthIso());
  const [startedOnIso, setStartedOnIso]     = useState(todayIso());

  const [isProfessionalExpense, setIsProfessionalExpense] = useState(false);

  // Apply catalogue defaults when user picks an existing item
  useEffect(() => {
    if (!selection.id) return;
    if (selection.category) {
      const cat = SUBSCRIPTION_CATEGORIES.find((c) => c.id === selection.category as SubscriptionCategory);
      if (cat) setCategory(cat.id);
    }
    if (selection.subCategory) setSubCategory(selection.subCategory);
    if (selection.defaultCurrency) {
      setAmount((a) => ({ ...a, currency: selection.defaultCurrency! }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.id]);

  // Keep sub-category list synced with category
  useEffect(() => {
    const opts = SUBSCRIPTION_SUBCATEGORIES[category];
    if (!opts.includes(subCategory)) setSubCategory(opts[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const showPlatformField = category === 'mobile_apps';

  // ── Submit ──
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (!profile?.familyId) return false;
    if (!selection.name.trim()) return false;
    if (amount.amountCents <= 0) return false;
    if (!amount.fxResolved) return false;
    return true;
  }, [profile?.familyId, selection.name, amount]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !profile?.familyId || !profile.uid) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1. Record catalogue use (best-effort, before parent write).
      // A `global:` id means the user picked a curated global suggestion
      // that doesn't exist in the family catalogue yet — treat it as a
      // fresh entry (no existingId).
      const existingId = selection.id && !selection.id.startsWith('global:')
        ? selection.id
        : undefined;
      const catId = await recordSubCatalogueUse(
        profile.familyId,
        {
          name: selection.name.trim(),
          category,
          subCategory,
          defaultCurrency: amount.currency,
        },
        existingId,
      );

      // 2. Server write of the subscription + first cycle. Picker is the
      // single source of truth; legacy hardcoded defaults retired.
      const reminderDaysBefore = [...reminderDaysPicked].sort((a, b) => b - a);
      const paidByUidPayload = paidByUid;
      const { subId } = await createSubscription({
        familyId: profile.familyId,
        name: selection.name.trim(),
        catalogueRef: catId ?? null,
        category,
        subCategory,
        platform: showPlatformField ? platform : null,
        billingMode,
        status: 'active',
        amountOriginalCents: amount.amountCents,
        currencyOriginal: amount.currency,
        fxRate: amount.fxRate,
        frequency,
        customMonths: frequency === 'custom' ? customMonths : null,
        nextBillingDateIso: nextBillingIso,
        startedOnIso,
        accountHolderUid: profile.uid,
        beneficiaryUids: [],
        paidByUid: paidByUidPayload,
        isProfessionalExpense,
        reminderDaysBefore,
        createdByUid: profile.uid,
        clientToken: newClientToken(),
      });
      router.replace(`/household/subscriptions/${subId}`);
    } catch (e) {
      setError((e as Error).message || 'Save failed');
      setSubmitting(false);
    }
  }

  if (authLoading || !profile) return <div className="p-6 text-pulse-navy/60">Loading…</div>;
  if (profile.role !== 'parent') return null;

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <div className="text-xs font-bold uppercase tracking-wide text-pulse-gold">
          <Link href="/household/subscriptions" className="hover:underline">Subscriptions</Link> · New
        </div>
        <h1 className="mt-1 font-display text-2xl font-extrabold text-pulse-navy">
          Add a subscription
        </h1>
        <p className="mt-1 text-sm font-semibold text-pulse-navy/60">
          Auto vs Manual is the key choice — Manual gets pre-due reminders + a post-due
          &ldquo;did you pay?&rdquo; check. Auto just tracks.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-kaya bg-white border border-pulse-navy/10 px-5 py-5 sm:px-6 sm:py-6">

        {/* Catalogue search → name */}
        <CatalogueSearch
          items={mergedCatalogue}
          value={selection}
          onChange={setSelection}
        />

        {/* Auto / Manual */}
        <AutoManualToggle
          value={billingMode}
          onChange={(mode) => {
            setBillingMode(mode);
            // When the parent flips modes, refresh defaults UNTIL they've
            // intentionally edited the chip set.
            if (!reminderTouched) {
              setReminderDaysPicked(mode === 'manual' ? [7, 2, 0] : []);
            }
          }}
        />

        {/* Reminder days picker — applies to both Manual + Auto. */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">
            Remind me before billing
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 7, 14, 30].map((d) => {
              const picked = reminderDaysPicked.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setReminderTouched(true);
                    setReminderDaysPicked((prev) =>
                      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
                    );
                  }}
                  aria-pressed={picked}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-extrabold border-[1.5px] transition ${picked ? 'border-pulse-gold bg-pulse-gold/15 text-pulse-navy' : 'border-pulse-navy/15 bg-white text-pulse-navy/65'}`}
                >
                  {d === 0 ? 'On the day' : `${d} day${d === 1 ? '' : 's'} before`}
                </button>
              );
            })}
          </div>
          <p className="text-[10.5px] text-pulse-navy/50">
            {reminderDaysPicked.length === 0
              ? 'No reminders — you’ll only see this on the dashboard.'
              : `Kaya will nudge you ${reminderDaysPicked.length} time${reminderDaysPicked.length === 1 ? '' : 's'} per cycle.`}
          </p>
        </div>

        {/* Per-parent attribution — used by the list filter + per-parent
            budget views. Default = current user; flip to Shared / the
            other parent as needed. */}
        {profile?.familyId && (
          <PaidByPicker
            familyId={profile.familyId}
            value={paidByUid}
            onChange={setPaidByUid}
          />
        )}

        {/* Taxonomy */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as SubscriptionCategory)}
              className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
            >
              {SUBSCRIPTION_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">Sub-category</label>
            <select
              value={subCategory}
              onChange={(e) => setSubCategory(e.target.value)}
              className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
            >
              {SUBSCRIPTION_SUBCATEGORIES[category].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Platform (mobile apps only) */}
        {showPlatformField && (
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">Platform</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                    platform === p.id
                      ? 'bg-pulse-navy text-pulse-cream border-pulse-navy'
                      : 'bg-white text-pulse-navy/80 border-pulse-navy/15 hover:border-pulse-gold/60'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Money */}
        <CurrencyAmountInput
          value={amount}
          onChange={setAmount}
          householdCurrency={householdCurrency}
        />

        {/* Frequency + next-billing */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FrequencyPicker
            value={frequency}
            customMonths={customMonths}
            onChange={(f, m) => { setFrequency(f); setCustomMonths(m); }}
            options={SUB_FREQUENCY_OPTIONS}
          />
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">Next billing date</label>
            <input
              type="date"
              value={nextBillingIso}
              onChange={(e) => setNextBillingIso(e.target.value)}
              className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">Started on</label>
          <input
            type="date"
            value={startedOnIso}
            onChange={(e) => setStartedOnIso(e.target.value)}
            className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
          />
        </div>

        {category === 'professional' && (
          <label className="flex items-start gap-2 text-sm font-semibold text-pulse-navy cursor-pointer">
            <input
              type="checkbox"
              checked={isProfessionalExpense}
              onChange={(e) => setIsProfessionalExpense(e.target.checked)}
              className="accent-pulse-gold mt-0.5"
            />
            <span>
              Mark as a professional / work expense{' '}
              <span className="text-pulse-navy/55">(excluded from household roll-up by default — spec §5)</span>
            </span>
          </label>
        )}

        {error && (
          <div className="rounded-kaya-sm bg-pulse-coral/10 border border-pulse-coral/40 px-3 py-2 text-sm font-semibold text-pulse-coral">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <Link
            href="/household/subscriptions"
            className="text-sm font-bold uppercase tracking-wide text-pulse-navy/55 hover:text-pulse-navy"
          >
            ← Cancel
          </Link>
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="rounded-full bg-pulse-navy px-6 py-2.5 font-display font-extrabold text-pulse-cream disabled:opacity-50 disabled:cursor-not-allowed hover:bg-pulse-navy/90 transition-colors"
          >
            {submitting ? 'Saving…' : 'Save subscription'}
          </button>
        </div>
      </form>
    </div>
  );
}
