'use client';

// /hive/cash-out — pending-spend banner (kid can cancel) + summary tiles
// + ledger of outgoing cash + "Request a spend" inline form. Section 2
// right-most phone in the v2 mockup.

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  cancelOwnRequest, requestSpend, TxCategory,
} from '@/lib/hive';
import KidSwitcher from '@/components/hive/KidSwitcher';
import TransactionRow from '@/components/hive/TransactionRow';
import BackButton from '@/components/ui/BackButton';
import { formatCash } from '@/components/hive/format';

const SPEND_CATEGORIES: { id: TxCategory; emoji: string; label: string }[] = [
  { id: 'spend',    emoji: '🛒', label: 'Shopping' },
  { id: 'spend',    emoji: '📚', label: 'Books' },
  { id: 'spend',    emoji: '🍦', label: 'Treats' },
  { id: 'donation', emoji: '❤️', label: 'Donation' },
  { id: 'other',    emoji: '✨', label: 'Other' },
];

export default function CashOutPage() {
  const { profile, isGuest } = useAuth();
  const { activeKidId, transactions, myRequests, config, wallet } = useHive();

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
  const [amountInput, setAmountInput] = useState('');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState<TxCategory>('spend');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!profile?.familyId || !activeKidId || isGuest) return;
    setError('');
    const cents = Math.round(parseFloat(amountInput.replace(/[^0-9.]/g, '')) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { setError('Pick an amount.'); return; }
    if (cents > wallet.cashCents) {
      setError(`You only have ${formatCash(wallet.cashCents, config.currency)} in Cash.`);
      return;
    }
    if (!desc.trim()) { setError('Tell us what the money is for.'); return; }
    setSubmitting(true);
    try {
      await requestSpend(profile.familyId, activeKidId, cents, desc.trim(), category, profile.uid);
      setShowForm(false);
      setAmountInput(''); setDesc(''); setCategory('spend');
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
              <span className="font-nunito font-black text-3xl text-hive-muted">$</span>
              <input
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="0.00"
                className="font-nunito font-black text-3xl bg-transparent outline-none w-full max-w-[200px] placeholder:text-hive-muted/30"
                autoFocus
              />
            </div>
            <p className="text-[11px] text-hive-muted mt-1">
              Available: {formatCash(wallet.cashCents, config.currency)}
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
              {SPEND_CATEGORIES.map((c, i) => {
                const sel = i === 0 ? category === 'spend' && c.label === 'Shopping' : false;
                // Multiple "spend" categories share the same id but different labels —
                // we treat the chip as the source of the category id and store the
                // emoji+label in the description for display.
                return (
                  <button
                    key={c.label}
                    onClick={() => {
                      setCategory(c.id);
                      // Prepend the chip's emoji+label to the description if blank.
                      if (!desc.trim()) setDesc(`${c.emoji} ${c.label}: `);
                    }}
                    className={`px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border transition-colors ${
                      category === c.id ? 'bg-hive-honey text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                    }`}
                  >
                    {c.emoji} {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-hive-rose text-sm font-bold">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full h-12 rounded-hive bg-hive-honey hover:bg-hive-honey-dk text-white font-nunito font-black text-[13px] disabled:opacity-40 transition-colors"
          >
            {submitting ? 'Sending…' : 'Send request to parent'}
          </button>
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
