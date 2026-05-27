'use client';

// Household → Contributions → Add form.
//
// Single-screen form. Required fields cover the must-haves from spec §4.3;
// the rest (anonymity, tax-deductible, receipt-held, etc.) sit under a
// "More options" disclosure to keep the default path clean. Tithe gets a
// shortcut row that auto-fills amount from incomeBasis × percentRate.
//
// On submit:
//   1. Resolve FX rate (locked at submit time)
//   2. POST /api/contributions/create with a fresh clientToken (UUID)
//   3. Server writes contributions/{id} + spend_ledger/{id} atomically
//   4. Redirect to /household/contributions/{id}

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  CONTRIBUTION_CATEGORIES, CONTRIBUTION_SUBCATEGORIES,
  type ContributionCategory, type ContributionFrequency,
  type ContributionPaymentMethod, type ContributionRecipientType,
  type ContributionVisibility,
  createContribution,
} from '@/lib/contributions';
import { CurrencyAmountInput, type CurrencyAmountValue } from '@/components/household/CurrencyAmountInput';
import { FrequencyPicker, CONTRIB_FREQUENCY_OPTIONS } from '@/components/household/FrequencyPicker';
import { OccasionPicker, type OccasionValue } from '@/components/household/OccasionPicker';

const PAYMENT_METHODS: { id: ContributionPaymentMethod; label: string }[] = [
  { id: 'mpesa',   label: 'M-Pesa / mobile money' },
  { id: 'bank',    label: 'Bank transfer' },
  { id: 'cash',    label: 'Cash' },
  { id: 'cheque',  label: 'Cheque' },
  { id: 'in_kind', label: 'In-kind (non-cash)' },
  { id: 'other',   label: 'Other' },
];

function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function newClientToken(): string {
  // Browser-supported; falls back to Math.random for older targets.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'tok_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function NewContributionPage() {
  const { profile, loading: authLoading } = useAuth();
  const { family } = useFamily();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    if (!profile) { router.replace('/login'); return; }
    if (profile.role !== 'parent') router.replace('/household');
  }, [profile, authLoading, router]);

  // ── Form state ──
  const householdCurrency = family?.hiveConfig?.currency ?? 'USD';
  const [recipientName, setRecipientName]   = useState('');
  const [recipientType, setRecipientType]   = useState<ContributionRecipientType>('organization');
  const [category, setCategory]             = useState<ContributionCategory>('faith');
  const [subCategory, setSubCategory]       = useState<string>(CONTRIBUTION_SUBCATEGORIES.faith[0]);
  const [occasion, setOccasion]             = useState<OccasionValue>({ name: '', dateIso: todayIso(), groupId: null });

  const [amount, setAmount] = useState<CurrencyAmountValue>({
    amountCents: 0,
    currency: householdCurrency,
    fxRate: 1,
    amountHouseholdCents: 0,
    fxResolved: true,
  });
  const [frequency, setFrequency]   = useState<ContributionFrequency>('one_off');
  const [customMonths, setCustomMonths] = useState<number | null>(null);
  const [dateGivenIso, setDateGivenIso] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState<ContributionPaymentMethod>('mpesa');
  const [givenOnBehalfOf, setGivenOnBehalfOf] = useState('');

  // Tithe shortcut
  const isTithe = category === 'faith' && subCategory.toLowerCase().includes('tithe');
  const [isPercentOfIncome, setIsPercentOfIncome] = useState(false);
  const [percentRate, setPercentRate]   = useState<number>(10);
  const [incomeBasis, setIncomeBasis]   = useState<number>(0); // displayed in major units
  useEffect(() => {
    if (!isTithe) setIsPercentOfIncome(false);
  }, [isTithe]);
  useEffect(() => {
    if (!isPercentOfIncome) return;
    const computed = Math.round(incomeBasis * 100 * (percentRate / 100));
    setAmount((a) => ({
      ...a,
      amountCents: computed,
      amountHouseholdCents: a.currency === householdCurrency ? computed : Math.round(computed * a.fxRate),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPercentOfIncome, percentRate, incomeBasis]);

  // More-options block
  const [moreOpen, setMoreOpen]   = useState(false);
  const [visibility, setVisibility] = useState<ContributionVisibility>('parents_only');
  const [taxDeductible, setTaxDeductible] = useState(false);
  const [receiptHeld, setReceiptHeld]     = useState(false);
  const [anonymousFlag, setAnonymousFlag] = useState(false);
  const [notes, setNotes]                 = useState('');
  const [inKindDesc, setInKindDesc]       = useState('');

  // Keep sub-category in sync with category
  useEffect(() => {
    const opts = CONTRIBUTION_SUBCATEGORIES[category];
    if (!opts.includes(subCategory)) setSubCategory(opts[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // ── Submit ──
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (!profile?.familyId) return false;
    if (!recipientName.trim()) return false;
    if (amount.amountCents <= 0) return false;
    if (!amount.fxResolved) return false;
    if (paymentMethod === 'in_kind' && !inKindDesc.trim()) return false;
    return true;
  }, [profile?.familyId, recipientName, amount, paymentMethod, inKindDesc]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !profile?.familyId || !profile.uid) return;
    setSubmitting(true);
    setError(null);
    try {
      const { contribId } = await createContribution({
        familyId: profile.familyId,
        recipientName: recipientName.trim(),
        recipientType,
        anonymousFlag,
        category,
        subCategory,
        occasionName:   occasion.name.trim() || undefined,
        occasionDateIso: occasion.name.trim() ? occasion.dateIso : undefined,
        amountOriginalCents: amount.amountCents,
        currencyOriginal:    amount.currency,
        fxRate:              amount.fxRate,
        frequency,
        customMonths: frequency === 'custom' ? customMonths : null,
        dateGivenIso,
        givenByUid: profile.uid,
        givenOnBehalfOf: givenOnBehalfOf.trim() || undefined,
        paymentMethod,
        inKindDescription: paymentMethod === 'in_kind' ? inKindDesc.trim() : undefined,
        isPercentOfIncome,
        percentRate: isPercentOfIncome ? percentRate : null,
        incomeBasisCents: isPercentOfIncome ? Math.round(incomeBasis * 100) : null,
        taxDeductible,
        receiptHeld,
        visibility,
        notes: notes.trim() || undefined,
        createdByUid: profile.uid,
        clientToken: newClientToken(),
      });
      router.replace(`/household/contributions/${contribId}`);
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
          <Link href="/household/contributions" className="hover:underline">Contributions</Link> · New
        </div>
        <h1 className="mt-1 font-display text-2xl font-extrabold text-pulse-navy">
          Add a contribution
        </h1>
        <p className="mt-1 text-sm font-semibold text-pulse-navy/60">
          Gifts, tithes, msiba, charity, family support. Locked in your household currency
          at the rate of today — historic entries never reconvert.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-kaya bg-white border border-pulse-navy/10 px-5 py-5 sm:px-6 sm:py-6">

        {/* Recipient */}
        <div className="space-y-1">
          <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">
            Recipient
          </label>
          <input
            type="text"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="e.g. Holy Family Parish · Jane & Mark · Mama Asha family"
            className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
          />
          <RadioRow
            value={recipientType}
            onChange={setRecipientType}
            options={[
              { id: 'person',       label: 'Person' },
              { id: 'organization', label: 'Organisation' },
              { id: 'cause',        label: 'Cause' },
              { id: 'community',    label: 'Community' },
            ]}
          />
        </div>

        {/* Taxonomy */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ContributionCategory)}
              className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
            >
              {CONTRIBUTION_CATEGORIES.map((c) => (
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
              {CONTRIBUTION_SUBCATEGORIES[category].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tithe shortcut */}
        {isTithe && (
          <div className="rounded-kaya-sm bg-pulse-cream border border-pulse-navy/10 p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPercentOfIncome}
                onChange={(e) => setIsPercentOfIncome(e.target.checked)}
                className="accent-pulse-gold"
              />
              <span className="text-sm font-bold text-pulse-navy">
                Compute as % of income (autofills the amount)
              </span>
            </label>
            {isPercentOfIncome && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-pulse-navy/65">% rate</label>
                  <input
                    type="number" min={0} max={100} step="0.1"
                    value={percentRate}
                    onChange={(e) => setPercentRate(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-pulse-navy/65">Income basis ({householdCurrency})</label>
                  <input
                    type="number" min={0} step="0.01"
                    value={incomeBasis === 0 ? '' : incomeBasis}
                    onChange={(e) => setIncomeBasis(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Money */}
        <CurrencyAmountInput
          value={amount}
          onChange={setAmount}
          householdCurrency={householdCurrency}
        />

        {/* Frequency + date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FrequencyPicker
            value={frequency}
            customMonths={customMonths}
            onChange={(f, m) => { setFrequency(f); setCustomMonths(m); }}
            options={CONTRIB_FREQUENCY_OPTIONS}
          />
          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">Date given</label>
            <input
              type="date"
              value={dateGivenIso}
              onChange={(e) => setDateGivenIso(e.target.value)}
              className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
            />
          </div>
        </div>

        {/* Payment method */}
        <div className="space-y-1">
          <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">Payment method</label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as ContributionPaymentMethod)}
            className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
          >
            {PAYMENT_METHODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          {paymentMethod === 'in_kind' && (
            <input
              type="text"
              value={inKindDesc}
              onChange={(e) => setInKindDesc(e.target.value)}
              placeholder="What was given? (food, clothes, time…)"
              className="mt-2 w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
            />
          )}
        </div>

        {/* Occasion (optional) */}
        <OccasionPicker value={occasion} onChange={setOccasion} />

        {/* More options */}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="block text-xs font-bold uppercase tracking-wide text-pulse-gold hover:underline"
        >
          {moreOpen ? 'Hide more options' : '+ More options'}
        </button>
        {moreOpen && (
          <div className="space-y-4 rounded-kaya-sm bg-pulse-cream border border-pulse-navy/10 p-4">
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">Given on behalf of</label>
              <input
                type="text"
                value={givenOnBehalfOf}
                onChange={(e) => setGivenOnBehalfOf(e.target.value)}
                placeholder="e.g. The family · A child's name"
                className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
              />
            </div>

            <RadioRow
              label="Who can see this"
              value={visibility}
              onChange={setVisibility}
              options={[
                { id: 'parents_only', label: 'Parents only (default)' },
                { id: 'family',       label: 'Show to kids' },
              ]}
            />

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Toggle checked={taxDeductible} onChange={setTaxDeductible} label="Tax-deductible" />
              <Toggle checked={receiptHeld}   onChange={setReceiptHeld}   label="Receipt held" />
              <Toggle checked={anonymousFlag} onChange={setAnonymousFlag} label="Anonymous" />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Context, who attended, why this one…"
                className="w-full rounded-kaya-sm border border-pulse-navy/15 bg-white px-3 py-2 font-semibold text-pulse-navy focus:border-pulse-gold focus:outline-none"
              />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-kaya-sm bg-pulse-coral/10 border border-pulse-coral/40 px-3 py-2 text-sm font-semibold text-pulse-coral">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <Link
            href="/household/contributions"
            className="text-sm font-bold uppercase tracking-wide text-pulse-navy/55 hover:text-pulse-navy"
          >
            ← Cancel
          </Link>
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="rounded-full bg-pulse-navy px-6 py-2.5 font-display font-extrabold text-pulse-cream disabled:opacity-50 disabled:cursor-not-allowed hover:bg-pulse-navy/90 transition-colors"
          >
            {submitting ? 'Saving…' : 'Save contribution'}
          </button>
        </div>
      </form>
    </div>
  );
}

function RadioRow<T extends string>({
  label, value, onChange, options,
}: {
  label?: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="space-y-1">
      {label && (
        <div className="text-xs font-bold uppercase tracking-wide text-pulse-navy/65">{label}</div>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.id}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
              value === o.id
                ? 'bg-pulse-navy text-pulse-cream border-pulse-navy'
                : 'bg-white text-pulse-navy/80 border-pulse-navy/15 hover:border-pulse-gold/60'
            }`}
          >
            <input
              type="radio"
              className="sr-only"
              checked={value === o.id}
              onChange={() => onChange(o.id)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-pulse-navy">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-pulse-gold"
      />
      {label}
    </label>
  );
}
