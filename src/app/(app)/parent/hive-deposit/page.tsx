'use client';

// /parent/hive-deposit — manual cash deposit. Parent picks a kid, picks a
// category (allowance / gift / business / other), enters an amount, and
// hits Deposit. Goes through depositCash(), which writes the wallet and
// the ledger entry in one transaction. No approval needed because the
// parent IS the approver here.

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { depositCash } from '@/lib/hive';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';
import { formatCash } from '@/components/hive/format';

const CATEGORIES = [
  { id: 'allowance' as const, emoji: '💵', label: 'Allowance',     desc: 'Regular pocket money' },
  { id: 'gift'      as const, emoji: '🎁', label: 'Gift',          desc: 'Birthday, holiday, milestone' },
  { id: 'business'  as const, emoji: '🌳', label: 'Business',      desc: 'Earnings from a side hustle' },
  { id: 'other'     as const, emoji: '✨', label: 'Other',         desc: 'Anything else' },
];

export default function HiveDepositPage() {
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  const { config } = useHive();

  const [kidId, setKidId] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<typeof CATEGORIES[number]['id']>('allowance');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ kidName: string; cents: number } | null>(null);
  const [error, setError] = useState('');

  const cents = Math.round(parseFloat(amount.replace(/[^0-9.]/g, '')) * 100) || 0;

  const submit = async () => {
    if (!profile?.familyId || isGuest) return;
    setError('');
    if (!kidId) { setError('Pick a kid.'); return; }
    if (cents <= 0) { setError('Pick an amount.'); return; }
    const kid = children.find((c) => c.id === kidId);
    setSubmitting(true);
    try {
      await depositCash(
        profile.familyId,
        kidId,
        cents,
        category,
        description.trim() || CATEGORIES.find((c) => c.id === category)!.label,
        profile.uid,
      );
      setSuccess({ kidName: kid?.name || 'kid', cents });
      setAmount('');
      setDescription('');
      setTimeout(() => setSuccess(null), 3500);
    } catch (e: any) {
      setError(e?.message || 'Deposit failed.');
    }
    setSubmitting(false);
  };

  if (success) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 lg:pt-24 text-center">
        <div className="text-6xl mb-4">💸</div>
        <h2 className="font-nunito font-black text-3xl mb-2">Deposited!</h2>
        <p className="text-hive-muted text-sm">
          {success.kidName} got{' '}
          <span className="text-hive-green font-bold">+{formatCash(success.cents, config.currency)}</span>{' '}
          in their Cash balance.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Parent · The Hive</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">Deposit cash 💸</h1>
        <p className="text-sm text-hive-muted mt-2">
          Allowance, gifts, or business income — credits the kid&apos;s Cash balance instantly.
        </p>
      </div>

      <div className="space-y-4">
        {/* Kid picker */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">For who?</p>
          <div className="grid grid-cols-2 gap-2">
            {children.map((c) => {
              const sel = kidId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setKidId(c.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-hive border transition-all ${
                    sel ? 'bg-hive-honey text-white border-transparent shadow-sm' : 'bg-hive-paper border-hive-line text-hive-muted hover:border-hive-honey/50'
                  }`}
                >
                  <KidAvatar child={c} size="sm" />
                  <span className="font-nunito font-extrabold text-[13px]">{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Amount */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">How much?</p>
          <div className="flex items-baseline gap-2">
            <span className="font-nunito font-black text-4xl text-hive-muted">$</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              placeholder="0.00"
              className="font-nunito font-black text-4xl bg-transparent outline-none flex-1 placeholder:text-hive-muted/30"
            />
          </div>
        </div>

        {/* Category */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">Category</p>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => {
              const sel = category === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`flex items-start gap-2 p-2.5 rounded-hive border-2 text-left transition-all ${
                    sel ? 'border-hive-honey bg-hive-honey-soft/50' : 'border-hive-line bg-hive-paper hover:border-hive-honey/40'
                  }`}
                >
                  <span className="text-xl shrink-0">{c.emoji}</span>
                  <div className="min-w-0">
                    <p className="font-nunito font-extrabold text-[13px] leading-tight">{c.label}</p>
                    <p className="text-[10px] text-hive-muted leading-snug">{c.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Optional note */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">Note (optional)</p>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={`e.g. Birthday gift from Auntie Sarah`}
            maxLength={120}
            className="w-full h-11 px-3 bg-hive-cream rounded-[12px] text-sm border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
          />
        </div>

        {error && (
          <p className="text-hive-rose text-sm font-bold">{error}</p>
        )}

        <button
          onClick={submit}
          disabled={submitting || isGuest}
          className="w-full h-12 rounded-hive bg-hive-green hover:brightness-110 text-white font-nunito font-black text-sm disabled:opacity-40 transition shadow-[0_8px_20px_-8px_rgba(63,175,108,0.5)]"
        >
          {submitting
            ? 'Depositing…'
            : `Deposit ${cents > 0 ? formatCash(cents, config.currency) : ''}`}
        </button>
      </div>
    </div>
  );
}
