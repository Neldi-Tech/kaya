'use client';

// /hive/cash-out — pending-spend banner (kid can cancel) + summary tiles
// + ledger of outgoing cash + "Request a spend" inline form. Section 2
// right-most phone in the v2 mockup.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  cancelOwnRequest, requestOrAutoSpend, TxCategory, PLAN_CATEGORIES,
  effectiveAutoApproveCents, currencySymbol,
} from '@/lib/hive';
import { Business, subscribeToKidBusinesses, requestBusinessReinvest } from '@/lib/business';
import { useFamily } from '@/contexts/FamilyContext';
import KidSwitcher from '@/components/hive/KidSwitcher';
import TransactionRow from '@/components/hive/TransactionRow';
import PlanProgressStrip from '@/components/hive/PlanProgressStrip';
import BackButton from '@/components/ui/BackButton';
import { formatCash } from '@/components/hive/format';
import NumberInput from '@/components/hive/NumberInput';

// Use the same finer category set as the plan (PLAN_CATEGORIES) — but
// drop "Savings" because that's not a thing you spend money on, it's a
// budget allocation choice on /hive/plan.
const SPEND_CHIPS = PLAN_CATEGORIES.filter((c) => c.id !== 'savings');

export default function CashOutPage() {
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  const {
    activeKidId, transactions, myRequests, config, wallet,
    monthlyPlan, monthSpending,
  } = useHive();
  // Per-child override beats family default. Recomputed when the kid's
  // child doc updates via the FamilyContext live subscription.
  const activeKid = children.find((c) => c.id === activeKidId);
  const effectiveThresholdCents = effectiveAutoApproveCents(activeKid as any, config);
  const usingPerKidOverride = activeKid && typeof (activeKid as any).spendAutoApproveBelowCents === 'number';
  // "[Auto-approved] Lego candy bar" flash — surfaces for ~3s after a
  // small spend that posted directly without going to the parent inbox.
  const [autoApproveFlash, setAutoApproveFlash] = useState<{ amount: number; desc: string } | null>(null);

  const outgoing = useMemo(
    () => transactions.filter((t) => t.layer === 'cash' && t.direction === 'out'),
    [transactions],
  );
  const pendingSpends = useMemo(
    () => myRequests.filter((r) => r.type === 'spend' && r.status === 'pending'),
    [myRequests],
  );

  // Stats per the mockup: this month spent + save rate.
  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let inMonth = 0, outMonth = 0;
    for (const t of transactions) {
      if (t.layer !== 'cash') continue;
      const ts = (t.createdAt as any)?.toMillis?.();
      if (typeof ts !== 'number' || ts < monthStart) continue;
      if (t.direction === 'in') inMonth += t.amount;
      else outMonth += t.amount;
    }
    const total = inMonth + outMonth;
    const saveRate = total === 0 ? null : Math.round((inMonth / total) * 100);
    return { spentMonth: outMonth, saveRate };
  }, [transactions]);

  // Spend request inline form
  const [showForm, setShowForm] = useState(false);
  const [amountInput, setAmountInput] = useState<number>(0);
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState<TxCategory>('shopping');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Kaya Business reinvest mode — spend from the Honey Pot into a business
  // (one parent approval, no double cash-out loop). Picks a business below.
  const [mode, setMode] = useState<'spend' | 'business'>('spend');
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [bizFlash, setBizFlash] = useState(false);

  useEffect(() => {
    if (!profile?.familyId || !activeKidId) { setBusinesses([]); return; }
    return subscribeToKidBusinesses(profile.familyId, activeKidId, setBusinesses);
  }, [profile?.familyId, activeKidId]);

  const submit = async () => {
    if (!profile?.familyId || !activeKidId || isGuest) return;
    setError('');
    const cents = Math.round(amountInput * 100);
    if (!Number.isFinite(cents) || cents <= 0) { setError('Pick an amount.'); return; }
    if (!desc.trim()) { setError('Tell us what the money is for.'); return; }

    // ── Kaya Business reinvest — from the Honey Pot, one parent approval ──
    if (mode === 'business') {
      if (!selectedBusinessId) { setError('Pick which business.'); return; }
      if (cents > (wallet.treasuryCents || 0)) {
        setError(`Your Honey Pot only has ${formatCash(wallet.treasuryCents || 0, config.currency)}.`);
        return;
      }
      setSubmitting(true);
      try {
        const biz = businesses.find((b) => b.id === selectedBusinessId);
        await requestBusinessReinvest(profile.familyId, {
          businessId: selectedBusinessId, ownerId: activeKidId, amountCents: cents,
          costType: 'supplies', description: `${desc.trim()}${biz ? ' · ' + biz.name : ''}`,
        }, profile.uid);
        setShowForm(false);
        setAmountInput(0); setDesc(''); setSelectedBusinessId(''); setMode('spend'); setCategory('shopping');
        setBizFlash(true); setTimeout(() => setBizFlash(false), 4000);
      } catch (e: any) {
        setError(e?.message || 'Failed to submit.');
      }
      setSubmitting(false);
      return;
    }

    // ── Normal cash spend ──
    if (cents > wallet.cashCents) {
      setError(`You only have ${formatCash(wallet.cashCents, config.currency)} in Cash.`);
      return;
    }
    setSubmitting(true);
    try {
      const result = await requestOrAutoSpend(
        profile.familyId, activeKidId, cents, desc.trim(), category,
        effectiveThresholdCents,
        profile.uid,
      );
      const wasAuto = result.kind === 'auto';
      setShowForm(false);
      if (wasAuto) {
        setAutoApproveFlash({ amount: cents, desc: desc.trim() });
        setTimeout(() => setAutoApproveFlash(null), 3500);
      }
      setAmountInput(0); setDesc(''); setCategory('shopping');
    } catch (e: any) {
      setError(e?.message || 'Failed to submit.');
    }
    setSubmitting(false);
  };

  const cancel = async (requestId: string) => {
    if (!profile?.familyId || isGuest) return;
    await cancelOwnRequest(profile.familyId, requestId, profile.uid);
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Cash · Out</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">What I spent</h1>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="h-10 px-4 rounded-hive-pill bg-hive-honey hover:bg-hive-honey-dk text-white font-nunito font-extrabold text-[12px] shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)]"
        >
          {showForm ? 'Close' : '+ Request spend'}
        </button>
      </div>

      <KidSwitcher />

      {/* Plan progress strip — keeps the budget visible while spending. */}
      <PlanProgressStrip />

      {/* Auto-approve confirmation flash — kid sees "Bought it · auto-approved" */}
      {autoApproveFlash && (
        <div className="rounded-hive bg-hive-green/15 border border-hive-green/40 p-3 mb-3 flex items-center gap-3">
          <div className="text-2xl shrink-0">⚡</div>
          <div className="flex-1 min-w-0">
            <p className="font-nunito font-extrabold text-[13px] text-hive-green">
              Bought it · auto-approved
            </p>
            <p className="text-[11px] text-hive-muted truncate">
              −{formatCash(autoApproveFlash.amount, config.currency)} · {autoApproveFlash.desc}
            </p>
          </div>
        </div>
      )}

      {/* Kaya Business reinvest sent — one-approval fast lane confirmation. */}
      {bizFlash && (
        <div className="rounded-hive bg-hive-green/15 border border-hive-green/40 p-3 mb-3 flex items-center gap-3">
          <div className="text-2xl shrink-0">🌳</div>
          <div className="flex-1 min-w-0">
            <p className="font-nunito font-extrabold text-[13px] text-hive-green">Sent to your parent</p>
            <p className="text-[11px] text-hive-muted">One approval and it leaves your Honey Pot into the business.</p>
          </div>
        </div>
      )}

      {/* Pending spend requests */}
      {pendingSpends.map((r) => (
        <div key={r.id} className="rounded-hive p-4 mb-3 border-2 border-dashed border-hive-honey bg-gradient-to-br from-[#FFF3D9] to-white">
          <p className="font-nunito font-black text-[14px]">🛒 Spend request — pending parent</p>
          <p className="text-[12px] text-hive-muted mt-1 leading-relaxed">{r.description}</p>
          <div className="mt-2.5 flex items-center justify-between">
            <p className="font-nunito font-black text-lg text-hive-honey-dk">
              {formatCash(r.amountCents || 0, config.currency)}
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={() => cancel(r.id)}
                className="px-3 py-1.5 rounded-[10px] bg-[#FCEAEA] text-hive-rose font-nunito font-extrabold text-[11px]"
              >
                Cancel
              </button>
              <span className="px-3 py-1.5 rounded-[10px] bg-hive-green/15 text-hive-green font-nunito font-extrabold text-[11px]">
                Awaiting…
              </span>
            </div>
          </div>
        </div>
      ))}

      {/* Inline spend request form */}
      {showForm && (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 mb-4 space-y-3">
          <div>
            <label className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">Amount</label>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-nunito font-black text-3xl text-hive-muted">{currencySymbol(config.currency)}</span>
              <NumberInput
                value={amountInput}
                onChange={setAmountInput}
                allowDecimal
                min={0}
                ariaLabel="Spend amount"
                placeholder="0.00"
                autoFocus
                className="font-nunito font-black text-3xl bg-transparent outline-none w-full max-w-[200px] placeholder:text-hive-muted/30 min-w-0"
              />
            </div>
            <p className="text-[11px] text-hive-muted mt-1">
              {mode === 'business'
                ? <>From 🍯 Honey Pot · {formatCash(wallet.treasuryCents || 0, config.currency)}</>
                : <>Available: {formatCash(wallet.cashCents, config.currency)}</>}
            </p>
          </div>

          <div>
            <label className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">What for?</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="e.g. Lego City set from the toy store"
              maxLength={120}
              className="w-full mt-1 h-11 px-3 bg-hive-cream rounded-[12px] text-sm border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
            />
          </div>

          <div>
            <label className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted block mb-1.5">Category</label>
            <div className="flex flex-wrap gap-1.5">
              {SPEND_CHIPS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setMode('spend'); setCategory(c.id); }}
                  className={`px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border transition-colors ${
                    mode === 'spend' && category === c.id ? 'bg-hive-honey text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                  }`}
                >
                  {c.emoji} {c.label}
                </button>
              ))}
              <button
                onClick={() => setMode('business')}
                className={`px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border transition-colors ${
                  mode === 'business' ? 'bg-hive-green text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                }`}
              >
                🌳 Kaya Business
              </button>
            </div>
          </div>

          {/* Business picker — only in reinvest mode. Spends from the Honey Pot. */}
          {mode === 'business' && (
            <div className="rounded-hive border border-hive-green/40 bg-[#EAF7F0] p-3">
              <label className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted block mb-1.5">Which business or project?</label>
              {businesses.length === 0 ? (
                <p className="text-[12px] text-hive-muted">No business yet — start one in <Link href="/business" className="text-hive-honey-dk font-bold hover:underline">Kaya Business</Link>.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {businesses.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setSelectedBusinessId(b.id)}
                      className={`px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border transition-colors ${
                        selectedBusinessId === b.id ? 'bg-hive-green text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                      }`}
                    >
                      {b.emoji || '🌳'} {b.name}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-hive-muted mt-2 leading-relaxed">
                🍯 Paid from your Honey Pot — <b>one</b> parent approval, then it&apos;s done (no extra cash-out step).
              </p>
            </div>
          )}

          {/* Soft over-budget warning — only when the kid actually has a
              plan budget for this category and adding the requested amount
              would push them past it. We never block; this is a nudge.
              (Cash spends only — business reinvest draws from the Pot.) */}
          {mode === 'spend' && (() => {
            const cents = Math.round(amountInput * 100) || 0;
            if (cents <= 0) return null;
            const budget = (monthlyPlan?.budget as any)?.[category] as number | undefined;
            if (!budget || budget <= 0) return null;
            const spent = (monthSpending as any)[category] || 0;
            const after = spent + cents;
            const overBy = after - budget;
            if (overBy <= 0) {
              const left = budget - after;
              return (
                <p className="text-[12px] text-hive-muted leading-relaxed">
                  ✅ Within plan — <strong className="text-hive-green">{formatCash(left, config.currency)}</strong> would be left for {SPEND_CHIPS.find((c) => c.id === category)?.label || category} this month.
                </p>
              );
            }
            return (
              <div className="rounded-hive border border-hive-rose/40 bg-[#FCEAEA] p-3 text-[12px] text-hive-navy leading-relaxed">
                ⚠️ This would put you{' '}
                <strong className="text-hive-rose">{formatCash(overBy, config.currency)} over</strong>{' '}
                your <strong>{SPEND_CHIPS.find((c) => c.id === category)?.label || category}</strong> plan
                ({formatCash(spent, config.currency)} spent of {formatCash(budget, config.currency)} planned).{' '}
                You can still ask — your parent decides.{' '}
                <Link href="/hive/plan" className="text-hive-honey-dk font-bold hover:underline">Tweak plan ↗</Link>
              </div>
            );
          })()}

          {/* Auto-approve hint — only when there's a non-zero threshold for
              this kid AND the entered amount qualifies. Per-child override
              beats family default; we tweak the copy so the kid knows
              whether it's "your limit" vs "your family's limit".
              (Cash spends only — a business reinvest always needs a parent OK.) */}
          {mode === 'spend' && (() => {
            const cents = Math.round(amountInput * 100) || 0;
            const threshold = effectiveThresholdCents;
            if (cents <= 0 || threshold <= 0 || cents >= threshold) return null;
            return (
              <p className="text-[12px] text-hive-green leading-relaxed">
                ⚡ Auto-approved · under your{usingPerKidOverride ? '' : ' family’s'} {formatCash(threshold, config.currency)} limit. No need to wait.
              </p>
            );
          })()}

          {error && <p className="text-hive-rose text-sm font-bold">{error}</p>}

          {(() => {
            const cents = Math.round(amountInput * 100) || 0;
            const threshold = effectiveThresholdCents;
            const isBiz = mode === 'business';
            const willAuto = !isBiz && cents > 0 && threshold > 0 && cents < threshold;
            const green = isBiz || willAuto;
            return (
              <button
                onClick={submit}
                disabled={submitting}
                className={`w-full h-12 rounded-hive font-nunito font-black text-[13px] disabled:opacity-40 transition-colors text-white ${
                  green
                    ? 'bg-hive-green hover:brightness-110 shadow-[0_8px_20px_-8px_rgba(63,175,108,0.5)]'
                    : 'bg-hive-honey hover:bg-hive-honey-dk'
                }`}
              >
                {submitting
                  ? 'Sending…'
                  : isBiz
                    ? 'Send to parent · 1 approval ⚡'
                    : willAuto
                      ? 'Buy it now ⚡'
                      : 'Send request to parent'}
              </button>
            );
          })()}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <div className="rounded-hive border bg-[#FCEAEA] border-[#E8B5B5] p-4">
          <p className="text-[10px] uppercase tracking-[1.5px] font-bold text-hive-muted">This month</p>
          <p className="font-nunito font-black text-2xl mt-1 text-hive-rose">−{formatCash(stats.spentMonth, config.currency)}</p>
        </div>
        <div className="rounded-hive border border-hive-line bg-hive-paper p-4">
          <p className="text-[10px] uppercase tracking-[1.5px] font-bold text-hive-muted">Save rate</p>
          <p className="font-nunito font-black text-2xl mt-1">
            {stats.saveRate === null ? '—' : `${stats.saveRate}%`}
          </p>
        </div>
      </div>

      <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
        {outgoing.length === 0 ? (
          <p className="text-hive-muted text-sm py-6 text-center">
            No spending yet. Approved spends will show up here.
          </p>
        ) : (
          outgoing.map((t) => (
            <TransactionRow key={t.id} tx={t} currency={config.currency} />
          ))
        )}
      </div>

      <p className="mt-3 text-center text-[11px] text-hive-muted">
        Every spend needs parent approval. Categories tracked.
      </p>
    </div>
  );
}
