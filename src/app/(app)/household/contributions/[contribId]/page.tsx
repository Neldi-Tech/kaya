'use client';

// Household → Contributions → Detail (read-only in P2).
// Edit + delete flows ship in a follow-up.

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  Contribution, getContribution, updateContribution, deleteContribution,
  CONTRIBUTION_CATEGORIES, categoryEmoji, categoryLabel,
  type ContributionCategory, type ContributionFrequency,
  type ContributionPaymentMethod, type ContributionVisibility,
} from '@/lib/contributions';
import { Timestamp } from 'firebase/firestore';
import { formatCents } from '@/components/pantry/format';
import { toDisplayDate } from '@/lib/dates';
import { StatusBadge, type StatusTone } from '@/components/household/StatusBadge';

const VISIBILITY_TONE: Record<Contribution['visibility'], StatusTone> = {
  parents_only:     'muted',
  family:           'green',
  private_to_giver: 'neutral',
};
const VISIBILITY_LABEL: Record<Contribution['visibility'], string> = {
  parents_only:     'Parents only',
  family:           'Family visible',
  private_to_giver: 'Private',
};

function tsToIso(ts: Contribution['dateGiven']): string {
  if (!ts) return '';
  const d = ts.toDate();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function ContributionDetailPage() {
  const { profile, loading: authLoading } = useAuth();
  const { family } = useFamily();
  const router = useRouter();
  const params = useParams<{ contribId: string }>();
  const contribId = params?.contribId;

  const [contrib, setContrib] = useState<Contribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!profile) { router.replace('/login'); return; }
    if (profile.role === 'kid') { router.replace('/home'); return; }
    if (!profile.familyId || !contribId) return;
    (async () => {
      const c = await getContribution(profile.familyId!, contribId);
      if (!c) setNotFound(true);
      else setContrib(c);
      setLoading(false);
    })();
  }, [profile, authLoading, contribId, router]);

  if (authLoading || loading) {
    return <div className="p-6 text-pulse-navy/60">Loading…</div>;
  }
  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-10">
        <p className="text-pulse-navy/70 font-semibold">
          This contribution doesn&apos;t exist (or you don&apos;t have access).
        </p>
        <Link href="/household/contributions" className="mt-3 inline-block font-bold text-pulse-gold hover:underline">
          ← Back to all contributions
        </Link>
      </div>
    );
  }
  if (!contrib) return null;

  const householdCurrency = family?.hiveConfig?.currency ?? 'USD';
  const titheBadge = contrib.isPercentOfIncome
    ? `${(contrib.percentRate ?? 0).toFixed(1)}% of income`
    : null;

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <Link href="/household/contributions" className="text-xs font-bold uppercase tracking-wide text-pulse-navy/55 hover:text-pulse-navy">
          ← Contributions
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-3xl">{categoryEmoji(contrib.category)}</span>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-pulse-navy leading-tight">
              {contrib.recipientName}
            </h1>
            <div className="text-xs font-bold uppercase tracking-wide text-pulse-navy/55">
              {categoryLabel(contrib.category)} · {contrib.subCategory}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone={VISIBILITY_TONE[contrib.visibility]}>{VISIBILITY_LABEL[contrib.visibility]}</StatusBadge>
          {titheBadge && <StatusBadge tone="gold">{titheBadge}</StatusBadge>}
          {contrib.taxDeductible && <StatusBadge tone="green">Tax-deductible</StatusBadge>}
          {contrib.anonymousFlag && <StatusBadge tone="neutral">Anonymous</StatusBadge>}
        </div>
      </header>

      <div className="rounded-kaya bg-white border border-pulse-navy/10 px-5 py-5 sm:px-6 sm:py-6 space-y-4">
        {/* Amount block */}
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-extrabold text-pulse-navy">
            {formatCents(contrib.amountHousehold, householdCurrency)}
          </span>
          {contrib.currencyOriginal !== householdCurrency && (
            <span className="text-sm font-semibold text-pulse-navy/55">
              ({formatCents(contrib.amountOriginal, contrib.currencyOriginal)} @ {contrib.fxRate.toFixed(4)})
            </span>
          )}
        </div>
        <div className="text-xs font-semibold text-pulse-navy/60">
          {contrib.frequency === 'one_off'
            ? 'One-off'
            : `Recurring · ${contrib.frequency === 'custom' ? `every ${contrib.customMonths ?? '?'} months` : contrib.frequency}`}
          {' · '}
          {toDisplayDate(tsToIso(contrib.dateGiven))}
        </div>

        <hr className="border-pulse-navy/8" />

        <DetailRow label="Payment" value={paymentLabel(contrib.paymentMethod)} />
        {contrib.paymentMethod === 'in_kind' && contrib.inKindDescription && (
          <DetailRow label="In-kind detail" value={contrib.inKindDescription} />
        )}
        {contrib.givenOnBehalfOf && (
          <DetailRow label="On behalf of" value={contrib.givenOnBehalfOf} />
        )}
        {contrib.occasion && (
          <DetailRow
            label="Occasion"
            value={`${contrib.occasion.name}${contrib.occasion.date ? ' · ' + toDisplayDate(tsToIso(contrib.occasion.date)) : ''}`}
          />
        )}
        {contrib.isPercentOfIncome && contrib.incomeBasis != null && (
          <DetailRow
            label="Income basis"
            value={`${formatCents(contrib.incomeBasis, householdCurrency)} · ${(contrib.percentRate ?? 0).toFixed(1)}%`}
          />
        )}
        {contrib.notes && (
          <div className="pt-2 border-t border-pulse-navy/8">
            <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55 mb-1">Notes</div>
            <p className="text-sm font-semibold text-pulse-navy whitespace-pre-wrap">{contrib.notes}</p>
          </div>
        )}
      </div>

      {/* Parent actions — Edit + Delete. */}
      {profile?.role === 'parent' && (
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="flex-1 rounded-kaya bg-pulse-gold/15 border border-pulse-gold/30 text-pulse-navy font-extrabold text-sm py-2.5 hover:bg-pulse-gold/25 transition"
          >
            ✏️ Edit
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!profile?.familyId || !contribId) return;
              const ok = typeof window !== 'undefined' && window.confirm(
                `Delete "${contrib.recipientName}"?\n\nThis can’t be undone.`,
              );
              if (!ok) return;
              try {
                await deleteContribution(profile.familyId, contribId);
                router.replace('/household/contributions');
              } catch (e) {
                window.alert(`Delete failed: ${(e as Error).message || 'unknown error'}`);
              }
            }}
            className="rounded-kaya bg-pulse-coral/12 border border-pulse-coral/35 text-pulse-coral font-extrabold text-sm py-2.5 px-4 hover:bg-pulse-coral/22 transition"
          >
            🗑 Delete
          </button>
        </div>
      )}

      {editOpen && profile?.familyId && contribId && (
        <ContributionEditSheet
          contrib={contrib}
          familyId={profile.familyId}
          contribId={contribId}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            const fresh = await getContribution(profile.familyId!, contribId);
            if (fresh) setContrib(fresh);
            setEditOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ── Edit sheet ───────────────────────────────────────────────────────

function ContributionEditSheet({
  contrib, familyId, contribId, onClose, onSaved,
}: {
  contrib: Contribution;
  familyId: string;
  contribId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [recipientName, setRecipientName] = useState(contrib.recipientName);
  const [category, setCategory] = useState<ContributionCategory>(contrib.category);
  const [subCategory, setSubCategory] = useState(contrib.subCategory);
  const [amountInput, setAmountInput] = useState(
    (contrib.amountOriginal / 100).toFixed(2),
  );
  const [frequency, setFrequency] = useState<ContributionFrequency>(contrib.frequency);
  const [dateGivenIso, setDateGivenIso] = useState(tsToIso(contrib.dateGiven));
  const [paymentMethod, setPaymentMethod] = useState<ContributionPaymentMethod>(contrib.paymentMethod);
  const [visibility, setVisibility] = useState<ContributionVisibility>(contrib.visibility);
  const [notes, setNotes] = useState(contrib.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      const amountOriginal = Math.round(Number(amountInput) * 100);
      if (!Number.isFinite(amountOriginal) || amountOriginal < 0) {
        throw new Error('Amount must be a positive number.');
      }
      const amountHousehold = Math.round(amountOriginal * contrib.fxRate);
      const ymdToTs = (ymd: string): Timestamp => {
        const [y, m, d] = ymd.split('-').map(Number);
        if (!y || !m || !d) return contrib.dateGiven;
        return Timestamp.fromDate(new Date(y, m - 1, d));
      };
      await updateContribution(familyId, contribId, {
        recipientName: recipientName.trim() || contrib.recipientName,
        category,
        subCategory: subCategory.trim() || contrib.subCategory,
        amountOriginal,
        amountHousehold,
        frequency,
        dateGiven: ymdToTs(dateGivenIso),
        paymentMethod,
        visibility,
        notes,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message || 'Save failed');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/40" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-3xl shadow-2xl p-5 space-y-3.5">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display font-extrabold text-[18px] text-pulse-navy">✏️ Edit contribution</h3>
          <button type="button" onClick={onClose} className="text-xs font-bold text-pulse-navy/55">Cancel</button>
        </div>

        <Field label="Recipient">
          <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold" />
        </Field>

        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value as ContributionCategory)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold">
            {CONTRIBUTION_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
          </select>
        </Field>

        <Field label="Sub-category">
          <input value={subCategory} onChange={(e) => setSubCategory(e.target.value)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold" />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label={`Amount (${contrib.currencyOriginal})`}>
            <input type="number" step="0.01" min="0" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold" />
          </Field>
          <Field label="Frequency">
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as ContributionFrequency)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold">
              <option value="one_off">One-off</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Date given">
            <input type="date" value={dateGivenIso} onChange={(e) => setDateGivenIso(e.target.value)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold" />
          </Field>
          <Field label="Payment">
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as ContributionPaymentMethod)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold">
              <option value="mpesa">M-Pesa</option>
              <option value="bank">Bank</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="in_kind">In-kind</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>

        <Field label="Visibility">
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as ContributionVisibility)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold">
            <option value="parents_only">Parents only</option>
            <option value="family">Family visible</option>
            <option value="private_to_giver">Private</option>
          </select>
        </Field>

        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold resize-none" />
        </Field>

        {err && <div className="text-[12px] font-bold text-pulse-coral">{err}</div>}

        <div className="flex items-center gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-kaya-sm text-sm font-bold text-pulse-navy/65 hover:bg-pulse-navy/5">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="flex-1 rounded-kaya-sm bg-pulse-gold text-pulse-navy font-extrabold text-sm py-2.5 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10.5px] font-bold uppercase tracking-wide text-pulse-navy/65">{label}</label>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55 shrink-0">
        {label}
      </span>
      <span className="font-semibold text-pulse-navy text-right">{value}</span>
    </div>
  );
}

function paymentLabel(p: Contribution['paymentMethod']): string {
  switch (p) {
    case 'mpesa':   return 'M-Pesa / mobile money';
    case 'bank':    return 'Bank transfer';
    case 'cash':    return 'Cash';
    case 'cheque':  return 'Cheque';
    case 'in_kind': return 'In-kind (non-cash)';
    default:        return 'Other';
  }
}
