'use client';

// Log a Cost — category + description + amount + funding source.
// Float-funded costs are approved immediately (no parent queue).
// Wallet-funded costs go to the parent approval queue.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { submitCost, COST_CATEGORIES } from '@/lib/business';
import type { CostCategory, CostFundingSource } from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import BackButton from '@/components/ui/BackButton';

export default function NewCostPage() {
  const { profile } = useAuth();
  const { activeKidId, config, wallet } = useHive();
  const { floatBalanceCents } = useBusiness();
  const router = useRouter();
  const cur = config.currency;

  const [category, setCategory]     = useState<CostCategory>('other');
  const [description, setDescription] = useState('');
  const [amount, setAmount]         = useState(''); // user enters currency units
  const [source, setSource]         = useState<CostFundingSource>('float');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const amountCents = Math.round((parseFloat(amount) || 0) * 100);
  const floatOk = source === 'float' && amountCents <= floatBalanceCents;

  async function submit() {
    if (!profile?.familyId || !activeKidId) return;
    setError('');
    if (!description.trim()) { setError('Describe what the cost is for.'); return; }
    if (amountCents <= 0) { setError('Amount must be greater than zero.'); return; }
    if (source === 'float' && amountCents > floatBalanceCents) {
      setError(`Not enough in the float. Balance: ${formatCash(floatBalanceCents, cur)}.`);
      return;
    }
    setSaving(true);
    try {
      await submitCost(profile.familyId, activeKidId, {
        category,
        description: description.trim(),
        amountCents,
        fundingSource: source,
        createdBy: profile.uid,
      });
      router.replace('/business/costs');
    } catch (e: any) {
      setError(e?.message || 'Failed to log cost.');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4 pb-8">
      <div className="mb-4"><BackButton /></div>

      <div className="mb-5">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-green">My Business</p>
        <h1 className="font-nunito font-black text-2xl mt-1">Log a cost 🧾</h1>
      </div>

      {/* Category picker */}
      <section className="mb-4">
        <p className="font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-2">Category</p>
        <div className="grid grid-cols-2 gap-2">
          {COST_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`h-10 px-4 rounded-hive border text-left font-nunito font-extrabold text-[12px] transition-colors flex items-center gap-2 ${
                category === cat.id
                  ? 'border-hive-green bg-[#E6F7EE] text-hive-navy'
                  : 'border-hive-line bg-hive-paper hover:border-hive-green/50'
              }`}
            >
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Description */}
      <section className="mb-4">
        <label className="block font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-1">
          What was it for?
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Chicken feed — 2 kg bag"
          maxLength={100}
          className="w-full h-11 px-4 bg-hive-paper border border-hive-line rounded-hive text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-green/40 placeholder:text-hive-muted/50"
        />
      </section>

      {/* Amount */}
      <section className="mb-4">
        <label className="block font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-1">
          Amount ({cur})
        </label>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="w-full h-11 px-4 bg-hive-paper border border-hive-line rounded-hive text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-green/40 placeholder:text-hive-muted/50"
        />
      </section>

      {/* Funding source */}
      <section className="mb-6">
        <p className="font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-2">
          Pay from
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setSource('float')}
            className={`flex-1 rounded-hive border px-3 py-2.5 text-left transition-colors ${
              source === 'float'
                ? 'border-hive-green bg-[#E6F7EE]'
                : 'border-hive-line bg-hive-paper hover:border-hive-green/50'
            }`}
          >
            <p className="font-nunito font-extrabold text-[12px]">💰 Float</p>
            <p className="text-[10px] text-hive-muted">Balance: {formatCash(floatBalanceCents, cur)}</p>
            <p className="text-[10px] text-hive-muted">Approved instantly</p>
          </button>
          <button
            onClick={() => setSource('wallet')}
            className={`flex-1 rounded-hive border px-3 py-2.5 text-left transition-colors ${
              source === 'wallet'
                ? 'border-hive-green bg-[#E6F7EE]'
                : 'border-hive-line bg-hive-paper hover:border-hive-green/50'
            }`}
          >
            <p className="font-nunito font-extrabold text-[12px]">👛 My wallet</p>
            <p className="text-[10px] text-hive-muted">Needs parent approval</p>
          </button>
        </div>

        {/* Float warning */}
        {source === 'float' && amountCents > 0 && !floatOk && (
          <p className="mt-2 text-[12px] text-hive-rose font-bold">
            ⚠ Not enough in the float — ask a parent to top it up first.
          </p>
        )}
        {source === 'float' && amountCents > 0 && floatOk && (
          <p className="mt-2 text-[11px] text-hive-green font-bold">
            ✓ Float balance after: {formatCash(floatBalanceCents - amountCents, cur)}
          </p>
        )}
      </section>

      {error && <p className="text-hive-rose font-bold text-[13px] mb-3">{error}</p>}

      <button
        onClick={submit}
        disabled={saving || amountCents === 0}
        className="w-full bg-hive-green hover:bg-[#2A8553] disabled:opacity-50 text-white rounded-hive py-3.5 font-nunito font-black text-[14px] transition-colors"
      >
        {saving
          ? 'Logging…'
          : source === 'float'
          ? 'Log cost (approved instantly)'
          : 'Send to parent for approval →'}
      </button>
    </div>
  );
}
