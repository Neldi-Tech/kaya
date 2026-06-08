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
  SUBSCRIPTION_PLATFORMS, platformLabel,
  updateSubscription, deleteSubscription, SUBSCRIPTION_SUBCATEGORIES,
  subMonthlyEquivalentCents,
  holdSubscription, resumeSubscription, stopSubscription, reactivateSubscription,
  isPrepaidFrequency,
  type SubscriptionCategory, type SubscriptionStatus, type SubscriptionFrequency,
  type SubscriptionPlatform,
} from '@/lib/subscriptions';
import { Timestamp } from 'firebase/firestore';
import PaidByPicker, { type PaidByValue } from '@/components/household/PaidByPicker';
import { formatCents } from '@/components/pantry/format';
import { toDisplayDate } from '@/lib/dates';
import { StatusBadge, type StatusTone } from '@/components/household/StatusBadge';
import { CurrencyAmountInput, type CurrencyAmountValue } from '@/components/household/CurrencyAmountInput';
import { FrequencyPicker, SUB_FREQUENCY_OPTIONS } from '@/components/household/FrequencyPicker';
import { PostDueCheck } from '@/components/household/PostDueCheck';
import { AdvisoryCard } from '@/components/household/AdvisoryCard';
import { UtilisationCheckIn } from '@/components/household/UtilisationCheckIn';
import {
  subscribeToOpenAdvisories, advisoriesForSub, type WealthAdvisory,
} from '@/lib/wealthAdvisories';

const STATUS_TONE: Record<Subscription['status'], StatusTone> = {
  active:    'green',
  trial:     'gold',
  paused:    'muted',
  cancelled: 'coral',
};

const STATUS_LABEL: Record<Subscription['status'], string> = {
  active:    'Active',
  trial:     'Trial',
  paused:    'On hold',
  cancelled: 'Stopped',
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
  const [advisories, setAdvisories] = useState<WealthAdvisory[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [actionSheet, setActionSheet] = useState<'hold' | 'stop' | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

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

  // Open advisories — filtered to this sub when rendered.
  useEffect(() => {
    if (!profile?.familyId) return;
    return subscribeToOpenAdvisories(profile.familyId, setAdvisories);
  }, [profile?.familyId]);

  // Re-fetch the sub after a status action so the page reflects the new
  // state (banner, badges, action row) immediately.
  const refreshSub = async () => {
    if (!profile?.familyId || !subId) return;
    const fresh = await getSubscription(profile.familyId, subId);
    if (fresh) setSub(fresh);
  };

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

  const householdCurrency = family?.hiveConfig?.currency ?? 'USD';
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
          <StatusBadge tone={STATUS_TONE[sub.status]}>{STATUS_LABEL[sub.status]}</StatusBadge>
          <StatusBadge tone={sub.billingMode === 'auto' ? 'neutral' : 'gold'}>
            {sub.billingMode === 'auto' ? 'Auto' : 'Manual'}
          </StatusBadge>
          {fromWealth && <StatusBadge tone="muted">From Wealth · read-only</StatusBadge>}
          {sub.isProfessionalExpense && <StatusBadge tone="neutral">Pro expense</StatusBadge>}
          <StatusBadge tone="neutral">{SUBSCRIPTION_PLATFORMS.find((p) => p.id === (sub.platform ?? 'other'))?.emoji} {platformLabel(sub.platform)}</StatusBadge>
        </div>
      </header>

      {/* Status banner — only when held or stopped, so the parent sees at a
          glance what's happening to the cost. */}
      {sub.status === 'paused' && (
        <div className="mb-4 flex items-start gap-2.5 rounded-kaya bg-pulse-navy/5 border border-pulse-navy/12 px-4 py-3">
          <span className="text-lg leading-none">⏸</span>
          <p className="text-sm font-semibold text-pulse-navy/75">
            <b className="font-extrabold">On hold.</b> Not counted in your monthly or annual totals, and
            reminders are paused.
            {sub.autoResumeOn
              ? ` Auto-resumes ${toDisplayDate(tsToIso(sub.autoResumeOn))}.`
              : ' Resume it any time below.'}
          </p>
        </div>
      )}
      {sub.status === 'cancelled' && (() => {
        const prepaidStillCounting =
          isPrepaidFrequency(sub.frequency, sub.customMonths) &&
          (sub.nextBillingDate?.toMillis?.() ?? 0) > Date.now();
        return (
          <div className="mb-4 flex items-start gap-2.5 rounded-kaya bg-pulse-coral/8 border border-pulse-coral/30 px-4 py-3">
            <span className="text-lg leading-none">⏹</span>
            <p className="text-sm font-semibold text-pulse-navy/75">
              <b className="font-extrabold">Stopped{sub.endedOn ? ` on ${toDisplayDate(tsToIso(sub.endedOn))}` : ''}.</b>{' '}
              {prepaidStillCounting
                ? `Already paid for, so it stays in your monthly & annual totals until ${toDisplayDate(tsToIso(sub.nextBillingDate))}, then drops off automatically.`
                : 'Removed from your spend totals. History &amp; receipts are kept — you can reactivate it any time.'}
            </p>
          </div>
        );
      })()}

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

      {/* Advisory cards — surface any open redirection_opportunity citing this sub */}
      {profile?.uid && advisoriesForSub(advisories, sub.id).map((adv) => (
        <div key={adv.id} className="mt-4">
          <AdvisoryCard
            familyId={profile.familyId!}
            uid={profile.uid}
            advisory={adv}
            householdCurrency={householdCurrency}
          />
        </div>
      ))}

      {/* Utilisation check-in — surfaces when this sub hasn't been touched
          in `utilisationCheckDays` days (sticky for Manual subs at 30/60d
          per cost band). */}
      {profile?.role === 'parent' && (() => {
        const lastTouched = (sub.updatedAt?.toMillis?.() ?? sub.createdAt?.toMillis?.() ?? 0);
        if (!lastTouched) return null;
        const daysSinceTouch = Math.floor((Date.now() - lastTouched) / 86_400_000);
        if (daysSinceTouch < sub.utilisationCheckDays) return null;
        return (
          <div className="mt-4">
            <UtilisationCheckIn
              familyId={profile.familyId!}
              subId={sub.id}
              daysSinceTouch={daysSinceTouch}
              threshold={sub.utilisationCheckDays}
            />
          </div>
        );
      })()}

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

      {/* Parent actions — status-aware. Hold / Stop for live subs, Resume /
          Reactivate for held / stopped. Hidden for from-Wealth subs since the
          canonical edit happens in Kaya Wealth. */}
      {!fromWealth && profile?.role === 'parent' && (
        <div className="mt-5 space-y-2">
          {/* Primary status actions */}
          {(sub.status === 'active' || sub.status === 'trial') && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="flex-1 rounded-kaya bg-pulse-gold/15 border border-pulse-gold/30 text-pulse-navy font-extrabold text-sm py-2.5 hover:bg-pulse-gold/25 transition"
              >
                ✏️ Edit
              </button>
              <button
                type="button"
                onClick={() => setActionSheet('hold')}
                className="flex-1 rounded-kaya bg-pulse-navy/5 border border-pulse-navy/15 text-pulse-navy font-extrabold text-sm py-2.5 hover:bg-pulse-navy/10 transition"
              >
                ⏸ Hold
              </button>
              <button
                type="button"
                onClick={() => setActionSheet('stop')}
                className="flex-1 rounded-kaya bg-pulse-coral/10 border border-pulse-coral/35 text-pulse-coral font-extrabold text-sm py-2.5 hover:bg-pulse-coral/20 transition"
              >
                ⏹ Stop
              </button>
            </div>
          )}

          {sub.status === 'paused' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={actionBusy}
                onClick={async () => {
                  if (!profile?.familyId || !subId) return;
                  setActionBusy(true);
                  try { await resumeSubscription(profile.familyId, subId); await refreshSub(); }
                  catch (e) { window.alert(`Resume failed: ${(e as Error).message || 'unknown error'}`); }
                  finally { setActionBusy(false); }
                }}
                className="flex-1 rounded-kaya bg-pulse-green text-white font-extrabold text-sm py-2.5 hover:opacity-90 transition disabled:opacity-50"
              >
                ▶ Resume now
              </button>
              <button
                type="button"
                onClick={() => setActionSheet('stop')}
                className="flex-1 rounded-kaya bg-pulse-coral/10 border border-pulse-coral/35 text-pulse-coral font-extrabold text-sm py-2.5 hover:bg-pulse-coral/20 transition"
              >
                ⏹ Stop
              </button>
            </div>
          )}

          {sub.status === 'cancelled' && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={async () => {
                if (!profile?.familyId || !subId) return;
                setActionBusy(true);
                try { await reactivateSubscription(profile.familyId, subId); await refreshSub(); }
                catch (e) { window.alert(`Reactivate failed: ${(e as Error).message || 'unknown error'}`); }
                finally { setActionBusy(false); }
              }}
              className="w-full rounded-kaya bg-pulse-green/12 border border-pulse-green/40 text-pulse-green font-extrabold text-sm py-2.5 hover:bg-pulse-green/20 transition disabled:opacity-50"
            >
              ▶ Reactivate
            </button>
          )}

          {/* Secondary — Edit (when not shown above) + Delete */}
          <div className="flex items-center gap-2 pt-1">
            {sub.status !== 'active' && sub.status !== 'trial' && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="flex-1 rounded-kaya bg-white border border-pulse-navy/15 text-pulse-navy/70 font-bold text-sm py-2 hover:bg-pulse-navy/5 transition"
              >
                ✏️ Edit details
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                if (!profile?.familyId || !subId) return;
                const ok = typeof window !== 'undefined' && window.confirm(
                  `Delete "${sub.name}"?\n\nThis removes the entry entirely. To just stop it counting, use Hold or Stop instead — those keep the history. Delete can’t be undone.`,
                );
                if (!ok) return;
                try {
                  await deleteSubscription(profile.familyId, subId);
                  router.replace('/household/subscriptions');
                } catch (e) {
                  window.alert(`Delete failed: ${(e as Error).message || 'unknown error'}`);
                }
              }}
              className="rounded-kaya bg-white border border-pulse-navy/12 text-pulse-navy/45 font-bold text-[13px] py-2 px-4 hover:text-pulse-coral hover:border-pulse-coral/30 transition"
            >
              🗑 Delete
            </button>
          </div>
        </div>
      )}

      {fromWealth && (
        <p className="mt-3 text-xs text-pulse-navy/50">
          Edit happens in Kaya Wealth — this subscription mirrors the property asset there.
        </p>
      )}

      {/* Inline edit sheet — opens above the detail card when Edit is tapped. */}
      {editOpen && !fromWealth && profile?.familyId && subId && (
        <SubscriptionEditSheet
          sub={sub}
          familyId={profile.familyId}
          subId={subId}
          householdCurrency={householdCurrency}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            const fresh = await getSubscription(profile.familyId!, subId);
            if (fresh) setSub(fresh);
            setEditOpen(false);
          }}
        />
      )}

      {/* Hold confirm sheet */}
      {actionSheet === 'hold' && !fromWealth && profile?.familyId && subId && (
        <HoldSheet
          subName={sub.name}
          onClose={() => setActionSheet(null)}
          onConfirm={async (resumeOn) => {
            await holdSubscription(profile.familyId!, subId, resumeOn);
            await refreshSub();
            setActionSheet(null);
          }}
        />
      )}

      {/* Stop confirm sheet */}
      {actionSheet === 'stop' && !fromWealth && profile?.familyId && subId && (
        <StopSheet
          subName={sub.name}
          prepaid={isPrepaidFrequency(sub.frequency, sub.customMonths)}
          paidThroughIso={tsToIso(sub.nextBillingDate)}
          onClose={() => setActionSheet(null)}
          onConfirm={async (endedOn) => {
            await stopSubscription(profile.familyId!, subId, endedOn);
            await refreshSub();
            setActionSheet(null);
          }}
        />
      )}
    </div>
  );
}

// ── Hold sheet ───────────────────────────────────────────────────────
// Pause a subscription. Either hold until the parent resumes, or schedule
// an automatic return on a chosen date (the cron flips it back).
function HoldSheet({
  subName, onClose, onConfirm,
}: {
  subName: string;
  onClose: () => void;
  onConfirm: (resumeOn: Timestamp | null) => Promise<void>;
}) {
  const [mode, setMode] = useState<'manual' | 'date'>('manual');
  const [resumeIso, setResumeIso] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const confirm = async () => {
    setBusy(true);
    setErr('');
    try {
      let resumeOn: Timestamp | null = null;
      if (mode === 'date') {
        const [y, m, d] = resumeIso.split('-').map(Number);
        if (!y || !m || !d) throw new Error('Pick a resume date or switch to “until I resume”.');
        resumeOn = Timestamp.fromDate(new Date(y, m - 1, d));
      }
      await onConfirm(resumeOn);
    } catch (e) {
      setErr((e as Error).message || 'Could not hold');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3 bg-black/40" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md bg-white rounded-3xl shadow-2xl p-5 space-y-3">
        <h3 className="font-display font-extrabold text-[18px] text-pulse-navy">⏸ Hold this subscription?</h3>
        <p className="text-sm font-semibold text-pulse-navy/65">
          <b>{subName}</b> stops counting toward your monthly totals and reminders pause. You can resume any time.
        </p>

        <button
          type="button"
          onClick={() => setMode('manual')}
          className={`w-full text-left rounded-kaya border px-3.5 py-2.5 transition ${mode === 'manual' ? 'border-pulse-gold bg-pulse-gold/8' : 'border-pulse-navy/12'}`}
        >
          <div className="font-display font-extrabold text-[13.5px] text-pulse-navy">Hold until I resume</div>
          <div className="text-[11.5px] font-semibold text-pulse-navy/55">Stays on hold until you tap Resume.</div>
        </button>
        <button
          type="button"
          onClick={() => setMode('date')}
          className={`w-full text-left rounded-kaya border px-3.5 py-2.5 transition ${mode === 'date' ? 'border-pulse-gold bg-pulse-gold/8' : 'border-pulse-navy/12'}`}
        >
          <div className="font-display font-extrabold text-[13.5px] text-pulse-navy">Auto-resume on a date</div>
          <div className="text-[11.5px] font-semibold text-pulse-navy/55">Kaya flips it back to active for you.</div>
        </button>
        {mode === 'date' && (
          <div className="space-y-1">
            <label className="block text-[10.5px] font-bold uppercase tracking-wide text-pulse-navy/65">Resume on</label>
            <input
              type="date"
              value={resumeIso}
              onChange={(e) => setResumeIso(e.target.value)}
              className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold"
            />
          </div>
        )}

        {err && <div className="text-[12px] font-bold text-pulse-coral">{err}</div>}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-kaya-sm text-sm font-bold text-pulse-navy/65 hover:bg-pulse-navy/5">Cancel</button>
          <button type="button" onClick={confirm} disabled={busy} className="flex-1 rounded-kaya-sm bg-pulse-navy text-white font-extrabold text-sm py-2.5 disabled:opacity-50">
            {busy ? 'Holding…' : 'Hold subscription'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stop sheet ───────────────────────────────────────────────────────
// Deactivate a subscription. Stamps an end date (defaults to today). The
// counting note adapts: a prepaid sub keeps counting until paid-through.
function StopSheet({
  subName, prepaid, paidThroughIso, onClose, onConfirm,
}: {
  subName: string;
  prepaid: boolean;
  paidThroughIso: string;
  onClose: () => void;
  onConfirm: (endedOn: Timestamp | null) => Promise<void>;
}) {
  const today = (() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  })();
  const [endedIso, setEndedIso] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const confirm = async () => {
    setBusy(true);
    setErr('');
    try {
      const [y, m, d] = endedIso.split('-').map(Number);
      const endedOn = (y && m && d) ? Timestamp.fromDate(new Date(y, m - 1, d)) : Timestamp.now();
      await onConfirm(endedOn);
    } catch (e) {
      setErr((e as Error).message || 'Could not stop');
      setBusy(false);
    }
  };

  const prepaidStillCounting = prepaid && paidThroughIso &&
    new Date(paidThroughIso).getTime() > Date.now();

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3 bg-black/40" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md bg-white rounded-3xl shadow-2xl p-5 space-y-3">
        <h3 className="font-display font-extrabold text-[18px] text-pulse-navy">⏹ Stop this subscription?</h3>
        <p className="text-sm font-semibold text-pulse-navy/65">
          We&apos;ll mark <b>{subName}</b> ended and {prepaidStillCounting
            ? `keep its cost in your totals until ${toDisplayDate(paidThroughIso)} (you&apos;ve already paid for it), then drop it.`
            : 'remove it from your spend totals straight away.'} Your payment history and receipts are kept, and you can reactivate it later.
        </p>

        <div className="space-y-1">
          <label className="block text-[10.5px] font-bold uppercase tracking-wide text-pulse-navy/65">Ended on</label>
          <input
            type="date"
            value={endedIso}
            onChange={(e) => setEndedIso(e.target.value)}
            className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold"
          />
        </div>

        {err && <div className="text-[12px] font-bold text-pulse-coral">{err}</div>}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-kaya-sm text-sm font-bold text-pulse-navy/65 hover:bg-pulse-navy/5">Cancel</button>
          <button type="button" onClick={confirm} disabled={busy} className="flex-1 rounded-kaya-sm bg-pulse-coral text-white font-extrabold text-sm py-2.5 disabled:opacity-50">
            {busy ? 'Stopping…' : 'Stop subscription'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit sheet ───────────────────────────────────────────────────────
//
// Inline modal for the most-edited fields on a subscription. Cycles +
// ledger history are immutable — changing amount or next-billing-date
// affects FUTURE cycles only, matching the spec's "history is sacred"
// guarantee. Wealth-sourced subs route their edit to Wealth and never
// open this sheet.

function SubscriptionEditSheet({
  sub, familyId, subId, householdCurrency, onClose, onSaved,
}: {
  sub: Subscription;
  familyId: string;
  subId: string;
  householdCurrency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(sub.name);
  const [category, setCategory] = useState<SubscriptionCategory>(sub.category);
  const [subCategory, setSubCategory] = useState(sub.subCategory);
  // Amount + currency + FX in one controlled value, mirroring the New flow so
  // a parent can correct the currency (not just the number) and the household
  // equivalent + monthly-equivalent KPIs recompute on save.
  const [amount, setAmount] = useState<CurrencyAmountValue>({
    amountCents: sub.amountOriginal,
    currency: sub.currencyOriginal,
    fxRate: sub.fxRate,
    amountHouseholdCents: sub.amountHousehold,
    fxResolved: true,
  });
  const [frequency, setFrequency] = useState<SubscriptionFrequency>(sub.frequency);
  const [customMonths, setCustomMonths] = useState<number | null>(sub.customMonths ?? null);
  const [status, setStatus] = useState<SubscriptionStatus>(sub.status);
  const [platform, setPlatform] = useState<SubscriptionPlatform>(sub.platform ?? 'other');
  const [nextBillingIso, setNextBillingIso] = useState(tsToIso(sub.nextBillingDate));
  const [reminderDays, setReminderDays] = useState<number[]>(sub.reminderDaysBefore ?? []);
  const [paidByUid, setPaidByUid] = useState<PaidByValue>(sub.paidByUid ?? null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const toggleDay = (d: number) =>
    setReminderDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      if (amount.amountCents <= 0) {
        throw new Error('Amount must be a positive number.');
      }
      if (!amount.fxResolved) {
        throw new Error('Still resolving the exchange rate — try again in a moment.');
      }
      const effectiveCustomMonths = frequency === 'custom' ? customMonths : null;
      // Recompute the household amount + monthly-equivalent so the detail card
      // AND the list KPIs (monthly equivalent / annualized) stay in sync.
      const monthlyEquivalent = subMonthlyEquivalentCents(
        amount.amountHouseholdCents, frequency, effectiveCustomMonths,
      );
      const ymdToTs = (ymd: string): Timestamp => {
        const [y, m, d] = ymd.split('-').map(Number);
        if (!y || !m || !d) return sub.nextBillingDate;
        return Timestamp.fromDate(new Date(y, m - 1, d));
      };
      await updateSubscription(familyId, subId, {
        name: name.trim() || sub.name,
        category,
        subCategory: subCategory.trim() || sub.subCategory,
        amountOriginal: amount.amountCents,
        currencyOriginal: amount.currency,
        fxRate: amount.fxRate,
        amountHousehold: amount.amountHouseholdCents,
        monthlyEquivalent,
        frequency,
        customMonths: effectiveCustomMonths,
        status,
        platform,
        nextBillingDate: ymdToTs(nextBillingIso),
        reminderDaysBefore: [...reminderDays].sort((a, b) => b - a),
        paidByUid,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message || 'Save failed');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3 bg-black/40" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-3xl shadow-2xl p-5 space-y-3.5">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display font-extrabold text-[18px] text-pulse-navy">✏️ Edit subscription</h3>
          <button type="button" onClick={onClose} className="text-xs font-bold text-pulse-navy/55">Cancel</button>
        </div>

        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold" />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Category">
            <select value={category} onChange={(e) => { setCategory(e.target.value as SubscriptionCategory); setSubCategory(SUBSCRIPTION_SUBCATEGORIES[e.target.value as SubscriptionCategory][0] ?? ''); }} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold">
              {SUBSCRIPTION_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
            </select>
          </Field>
          <Field label="Sub-category">
            <select value={subCategory} onChange={(e) => setSubCategory(e.target.value)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold">
              {SUBSCRIPTION_SUBCATEGORIES[category].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        {/* Amount + currency + live FX — same control as the New flow, so the
            currency itself is editable (not locked to entry) and the household
            equivalent recomputes. */}
        <CurrencyAmountInput
          value={amount}
          onChange={setAmount}
          householdCurrency={householdCurrency}
          label="Amount"
        />

        <FrequencyPicker
          value={frequency}
          customMonths={customMonths}
          onChange={(f, m) => { setFrequency(f); setCustomMonths(m); }}
          options={SUB_FREQUENCY_OPTIONS}
        />

        <div className="grid grid-cols-2 gap-2">
          <Field label="Next billing">
            <input type="date" value={nextBillingIso} onChange={(e) => setNextBillingIso(e.target.value)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold" />
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)} className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-sm font-semibold focus:outline-none focus:border-pulse-gold">
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
        </div>

        <Field label="Paid via">
          <div className="flex flex-wrap gap-1.5">
            {SUBSCRIPTION_PLATFORMS.map((p) => {
              const on = platform === p.id;
              return (
                <button key={p.id} type="button" onClick={() => setPlatform(p.id)}
                  className={`rounded-full px-3 py-1.5 text-[11.5px] font-extrabold border-[1.5px] transition ${on ? 'border-pulse-gold bg-pulse-gold/15 text-pulse-navy' : 'border-pulse-navy/15 bg-white text-pulse-navy/65'}`}
                  aria-pressed={on}
                >
                  {p.emoji} {p.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Remind me before billing">
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 7, 14, 30].map((d) => {
              const picked = reminderDays.includes(d);
              return (
                <button key={d} type="button" onClick={() => toggleDay(d)}
                  className={`rounded-full px-3 py-1.5 text-[11.5px] font-extrabold border-[1.5px] transition ${picked ? 'border-pulse-gold bg-pulse-gold/15 text-pulse-navy' : 'border-pulse-navy/15 bg-white text-pulse-navy/65'}`}
                  aria-pressed={picked}
                >
                  {d === 0 ? 'On the day' : `${d}d`}
                </button>
              );
            })}
          </div>
        </Field>

        <PaidByPicker
          familyId={familyId}
          value={paidByUid}
          onChange={setPaidByUid}
        />

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
