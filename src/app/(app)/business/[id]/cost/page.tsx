'use client';

// Kaya Business · Log a cost (kid screen 6). Tracked for P&L + margin. Under
// the parent-float default it does NOT come out of the kid's Hive — the parent
// covers costs — so this is bookkeeping that teaches margin, not a Hive debit.
// (Receipt-photo capture is a later PR.)

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { Business, CostType, subscribeToBusiness, logCost } from '@/lib/business';

const TYPES: Array<{ k: CostType; label: string }> = [
  { k: 'supplies', label: 'Supplies' },
  { k: 'tools', label: 'Tools' },
  { k: 'help', label: 'Help' },
  { k: 'other', label: 'Other' },
];

export default function LogCostPage() {
  const params = useParams();
  const router = useRouter();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const { config } = useHive();
  const familyId = profile?.familyId;

  const [business, setBusiness] = useState<Business | null>(null);
  const [costType, setCostType] = useState<CostType>('supplies');
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!familyId || !businessId) return;
    return subscribeToBusiness(familyId, businessId, setBusiness);
  }, [familyId, businessId]);

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === business?.ownerId;
  const canAct = isParent || isOwner;

  const cents = useMemo(() => {
    const n = parseFloat(amount.replace(/,/g, ''));
    return Number.isNaN(n) ? 0 : Math.round(n * 100);
  }, [amount]);

  const submit = async () => {
    if (!familyId || !business || !profile?.uid) return;
    if (cents <= 0) { setError('Enter an amount.'); return; }
    if (desc.trim().length < 1) { setError('What did you buy?'); return; }
    setError(''); setSaving(true);
    try {
      await logCost(familyId, businessId, {
        costType, description: desc.trim(), amountCents: cents,
      }, { uid: profile.uid, ownerId: business.ownerId });
      router.push(`/business/${businessId}`);
    } catch (e: any) {
      setError(e?.message || 'Could not save the cost.');
      setSaving(false);
    }
  };

  const label = 'text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5 mt-3';
  const field = 'w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40';
  const chip = (active: boolean) =>
    `px-3.5 py-2 rounded-hive-pill text-[12.5px] font-nunito font-extrabold border transition ${active ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'}`;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">🧾</div>
        <div className="min-w-0">
          <div className="font-nunito font-black text-[16px]">Log a cost</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">{business?.name || 'Loading…'}</div>
        </div>
      </div>

      {!canAct ? (
        <p className="text-hive-muted text-sm text-center py-8">Only the owner or a parent can log costs.</p>
      ) : (
        <>
          <div className={label}>Cost type</div>
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => (
              <button key={t.k} onClick={() => setCostType(t.k)} className={chip(costType === t.k)}>{t.label}</button>
            ))}
          </div>

          <div className={label}>What did you buy?</div>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={60} placeholder="e.g. Fertilizer · 1 kg" className={field} />

          <div className={label}>Amount ({config.currency})</div>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" className={field} />

          <div className="bg-[#F4ECD8] border border-hive-line rounded-hive p-4 mt-3">
            <p className="text-[12.5px] text-hive-navy/80 leading-relaxed">
              💡 Costs don&apos;t come out of your Hive — they&apos;re tracked so you can see your
              <b> margin</b> (what % of each sale you really keep). Your parent&apos;s float covers them.
            </p>
          </div>

          {error && <p className="text-hive-rose text-[12px] font-bold mt-3">{error}</p>}

          <button onClick={submit} disabled={saving || cents <= 0}
            className="w-full mt-5 h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition">
            {saving ? 'Saving…' : 'Save cost'}
          </button>
        </>
      )}
    </div>
  );
}
