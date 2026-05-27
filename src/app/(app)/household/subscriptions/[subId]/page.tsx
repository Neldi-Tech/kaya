'use client';

// Household → Subscriptions → Detail.
//
// Read-only in P3. Branches per spec §2:
//   Auto                            — passive tracking. Shows next billing
//                                     date, payment, reminder setting.
//   Manual                          — adds the "did you pay?" placeholder
//                                     (button wired in P4 to /api/cycles/close)
//                                     and the utilisation check-in placeholder.
//   Manual-from-Wealth              — sourceModule='wealth'. Edits happen
//                                     in Wealth; this surface is fully
//                                     read-only except for receipt capture
//                                     (P4) and the post-due check (P4).
//
// PostDueCheck + UtilisationCheckIn + ReceiptCard land in P4.

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  Subscription, SubscriptionCycle, getSubscription, subscribeToCycles,
  SUBSCRIPTION_CATEGORIES, subCategoryEmoji, subCategoryLabel,
} from '@/lib/subscriptions';
import { formatCents } from '@/components/pantry/format';
import { toDisplayDate } from '@/lib/dates';
import { StatusBadge, type StatusTone } from '@/components/household/StatusBadge';
import { PostDueCheck } from '@/components/household/PostDueCheck';

const STATUS_TONE: Record<Subscription['status'], StatusTone> = {
  active:    'green',
  trial:     'gold',
  paused:    'muted',
  cancelled: 'coral',
};

function tsToIso(ts: Subscription['nextBillingDate']): string {
  if (!ts) return '';
  const d = ts.toDate();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function SubscriptionDetailPage() {
  const { profile, loading: authLoading } = useAuth();
  const { family } = useFamily();
  const router = useRouter();
  const params = useParams<{ subId: string }>();
  const subId = params?.subId;

  const [sub, setSub] = useState<Subscription | null>(null);
  const [cycles, setCycles] = useState<SubscriptionCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!profile) { router.replace('/login'); return; }
    if (profile.role === 'kid') { router.replace('/home'); return; }
    if (!profile.familyId || !subId) return;
    (async () => {
      const s = await getSubscription(profile.familyId!, subId);
      if (!s) setNotFound(true);
      else setSub(s);
      setLoading(false);
    })();
  }, [profile, authLoading, subId, router]);

  // Cycles are read live so the post-due check disappears the moment
  // we close it (and the recent-cycles strip refreshes status).
  useEffect(() => {
    if (!profile?.familyId || !subId) return;
    return subscribeToCycles(profile.familyId, subId, setCycles);
  }, [profile?.familyId, subId]);

  if (authLoading || loading) {
    return <div className="p-6 text-pulse-navy/60">Loading…</div>;
  }
  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-10">
        <p className="text-pulse-navy/70 font-semibold">
          This subscription doesn&apos;t exist (or you don&apos;t have access).
        </p>
        <Link href="/household/subscriptions" className="mt-3 inline-block font-bold text-pulse-gold hover:underline">
          ← Back to all subscriptions
        </Link>
      </div>
    );
  }
  if (!sub) return null;

  const householdCurrency = (family as { currency?: string } | null)?.currency ?? 'USD';
  const fromWealth = sub.sourceModule === 'wealth';

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <Link href="/household/subscriptions" className="text-xs font-bold uppercase tracking-wide text-pulse-navy/55 hover:text-pulse-navy">
          ← Subscriptions
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-3xl">{subCategoryEmoji(sub.category)}</span>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-pulse-navy leading-tight">
              {sub.name}
            </h1>
            <div className="text-xs font-bold uppercase tracking-wide text-pulse-navy/55">
              {subCategoryLabel(sub.category)} · {sub.subCategory}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone={STATUS_TONE[sub.status]}>{sub.status}</StatusBadge>
          <StatusBadge tone={sub.billingMode === 'auto' ? 'neutral' : 'gold'}>
            {sub.billingMode === 'auto' ? 'Auto' : 'Manual'}
          </StatusBadge>
          {fromWealth && <StatusBadge tone="muted">From Wealth · read-only</StatusBadge>}
          {sub.isProfessionalExpense && <StatusBadge tone="neutral">Pro expense</StatusBadge>}
          {sub.platform && <StatusBadge tone="neutral">{sub.platform}</StatusBadge>}
        </div>
      </header>

      {/* Amount + cadence */}
      <div className="rounded-kaya bg-white border border-pulse-navy/10 px-5 py-5 sm:px-6 sm:py-6 space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-extrabold text-pulse-navy">
            {formatCents(sub.amountHousehold, householdCurrency)}
          </span>
          <span className="text-sm font-semibold text-pulse-navy/60">
            / {sub.frequency === 'custom' ? `${sub.customMonths ?? '?'}mo` : sub.frequency}
          </span>
        </div>
        {sub.currencyOriginal !== householdCurrency && (
          <div className="text-xs font-semibold text-pulse-navy/60 -mt-3">
            ({formatCents(sub.amountOriginal, sub.currencyOriginal)} @ {sub.fxRate.toFixed(4)})
          </div>
        )}

        <hr className="border-pulse-navy/8" />

        <DetailRow label="Monthly equivalent" value={formatCents(sub.monthlyEquivalent, householdCurrency)} />
        <DetailRow label="Annualized"         value={formatCents(sub.monthlyEquivalent * 12, householdCurrency)} />
        <DetailRow label="Next billing"        value={toDisplayDate(tsToIso(sub.nextBillingDate))} />
        <DetailRow label="Started"             value={toDisplayDate(tsToIso(sub.startedOn))} />
        {sub.trialEndsOn && (
          <DetailRow label="Trial ends"        value={toDisplayDate(tsToIso(sub.trialEndsOn))} />
        )}
      </div>

      {/* Post-due check — Manual subs with an open cycle past dueDate */}
      {sub.billingMode === 'manual' && profile?.uid && (() => {
        const now = Date.now();
        const openCycle = cycles.find((c) =>
          (c.status === 'overdue') ||
          (c.status === 'due') ||
          (c.status === 'upcoming' && (c.dueDate?.toMillis?.() ?? 0) < now)
        );
        if (!openCycle) return null;
        return (
          <div className="mt-4">
            <PostDueCheck
              familyId={profile.familyId!}
              subId={sub.id}
              cycle={openCycle}
              householdCurrency={householdCurrency}
              uid={profile.uid}
            />
          </div>
        );
      })()}

      {/* Recent cycles */}
      {cycles.length > 0 && (
        <div className="mt-4 rounded-kaya bg-white border border-pulse-navy/10 px-5 py-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55 mb-2">
            Recent cycles
          </div>
          <ul className="divide-y divide-pulse-navy/8">
            {cycles.slice(0, 6).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <div className="font-display font-bold text-pulse-navy">{c.id}</div>
                  <div className="text-[11px] font-semibold text-pulse-navy/55">
                    Due {toDisplayDate(tsToIso(c.dueDate))}
                    {c.paidOn ? ` · Paid ${toDisplayDate(tsToIso(c.paidOn))}` : ''}
                  </div>
                </div>
                <CycleBadge status={c.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Reminder behaviour summary */}
      <div className="mt-4 rounded-kaya bg-pulse-cream border border-pulse-navy/10 px-5 py-4 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55">
          Reminder behaviour
        </div>
        {sub.billingMode === 'auto' ? (
          <p className="text-sm font-semibold text-pulse-navy/75">
            Auto — system tracks only. {sub.reminderDaysBefore.length > 0
              ? `Renewal heads-up ${sub.reminderDaysBefore[0]} day(s) before.`
              : 'No renewal heads-up.'}
          </p>
        ) : (
          <p className="text-sm font-semibold text-pulse-navy/75">
            Manual — pre-due reminders at {sub.reminderDaysBefore.join('d, ')}d. Post-due
            &ldquo;did you pay?&rdquo; check enabled. Utilisation watch every {sub.utilisationCheckDays} days.
          </p>
        )}
        <p className="text-xs text-pulse-navy/50">
          Reminder delivery + post-due check button + the utilisation nudge land in the
          next release (P4). The configuration is saved on this entry now so they fire as
          soon as cron is wired.
        </p>
      </div>

      <p className="mt-3 text-xs text-pulse-navy/50">
        {fromWealth
          ? 'Edit happens in Kaya Wealth — this subscription mirrors the property asset there.'
          : 'Edit + delete + cycles history ship in a follow-up. Need to fix something? Add a new entry; this one stays as history.'}
      </p>
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

function CycleBadge({ status }: { status: SubscriptionCycle['status'] }) {
  const toneClass = status === 'paid'
    ? 'bg-pulse-green/12 text-pulse-green border-pulse-green/35'
    : status === 'overdue'
      ? 'bg-pulse-coral/12 text-pulse-coral border-pulse-coral/40'
      : status === 'due'
        ? 'bg-pulse-gold/15 text-pulse-gold border-pulse-gold/40'
        : 'bg-pulse-navy/8 text-pulse-navy/70 border-pulse-navy/15';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${toneClass}`}>
      {status}
    </span>
  );
}
