'use client';

// /pantry/dine-out — Household → Dine Out (parent quick-log).
//
// Eating out is parent-logged as a single amount — no itemised basket,
// no approve/reconcile ceremony. We create a draft then post it straight
// to budget (closed) so it rolls up into Budget / Pulse / Finances. The
// shared <BudgetBalanceMeter> shows the month's Dine Out balance + what's
// left after this entry, so the parent stays aware.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  DINE_OUT_CATEGORIES, type DineOutCategory,
  createDraftRequest, postDraftToBudget,
} from '@/lib/purchase';
import { formatCents } from '@/components/pantry/format';
import BudgetBalanceMeter from '@/components/pantry/BudgetBalanceMeter';
import BackButton from '@/components/ui/BackButton';

export default function DineOutPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { config } = useHive();
  const currency = config.currency;

  const [amount, setAmount] = useState('');
  const [tag, setTag] = useState<DineOutCategory>('restaurant');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Parent-only surface — bounce helpers back to the Pantry home.
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry');
  }, [profile, router]);

  const amountCents = Math.max(0, Math.round((parseFloat(amount) || 0) * 100));
  const canSave = amountCents > 0 && !saving && !isGuest;

  const save = async () => {
    if (!profile?.familyId || !profile.uid || !canSave) return;
    setSaving(true);
    setJustSaved(false);
    try {
      const tagLabel = DINE_OUT_CATEGORIES.find((c) => c.id === tag)?.label ?? 'Dine Out';
      const context = note.trim() ? `${tagLabel} · ${note.trim()}` : tagLabel;
      const id = await createDraftRequest(profile.familyId, {
        createdBy: profile.uid,
        createdByRole: 'parent',
        module: 'dineOut',
        context,
      });
      await postDraftToBudget(profile.familyId, id, profile.uid, amountCents);
      setAmount(''); setNote(''); setJustSaved(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[dine-out] save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  if (profile && profile.role !== 'parent') return null;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-[#C2562E]">Household · Dine Out</p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">Log a meal out</h1>
        <p className="text-hive-muted text-sm mt-1">Just the amount — restaurants, takeaway, delivery, coffee. It counts toward your Dine Out budget.</p>
      </div>

      <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 lg:p-5">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">Amount</span>
          <div className="mt-1 flex items-center gap-2 border-2 border-hive-line rounded-hive px-3 py-2 focus-within:border-[#C2562E]">
            <span className="text-hive-muted font-bold text-sm">{currency}</span>
            <input
              type="number" inputMode="decimal" min="0" autoFocus
              value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent font-nunito font-black text-2xl focus:outline-none w-full"
            />
          </div>
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          {DINE_OUT_CATEGORIES.map((c) => (
            <button
              key={c.id} type="button" onClick={() => setTag(c.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                tag === c.id ? 'bg-[#C2562E] text-white border-transparent' : 'border-hive-line bg-white text-hive-muted hover:border-[#C2562E]'
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>

        <input
          type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={60}
          placeholder="Where? (optional) · e.g. Lunch at Mama's"
          className="mt-3 w-full border border-hive-line rounded-hive px-3 py-2 text-sm font-bold"
        />

        {/* Live budget meter — the awareness piece (shared component). */}
        <BudgetBalanceMeter module="dineOut" pendingAmountCents={amountCents} className="mt-4" />

        <button
          type="button" onClick={save} disabled={!canSave}
          className="mt-4 w-full bg-[#C2562E] text-white rounded-hive py-3 font-nunito font-black text-sm shadow-lg shadow-[#C2562E]/30 disabled:opacity-50"
        >
          {saving ? 'Logging…' : amountCents > 0 ? `✓ Log ${formatCents(amountCents, currency)}` : 'Enter an amount'}
        </button>
        {justSaved && <p className="text-center text-xs text-pantry-leaf-dk font-bold mt-2">✓ Logged · meter updated.</p>}
        {isGuest && <p className="text-center text-xs text-hive-muted mt-2">Guest mode — sign in to log spend.</p>}
      </div>
    </div>
  );
}
