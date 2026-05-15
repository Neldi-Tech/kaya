'use client';

// Add Asset — form for adding a new asset to the kid's business.
// Type picker → name/count/stage/price inputs → submit.
// Accessible to both parents and kids; the Firestore rule enforces it.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { BUSINESS_ASSET_TYPES, addAsset, assetType } from '@/lib/business';
import type { AssetTypeKey } from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import BackButton from '@/components/ui/BackButton';

export default function NewAssetPage() {
  const { profile } = useAuth();
  const { activeKidId, config } = useHive();
  const router = useRouter();
  const cur = config.currency;

  const [typeKey, setTypeKey] = useState<AssetTypeKey>('passion_fruit');
  const [name, setName] = useState('');
  const [count, setCount] = useState('');
  const [stage, setStage] = useState('');
  const [unitPrice, setUnitPrice] = useState(''); // user enters currency units, stored ×100
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const type = assetType(typeKey);

  // When the type changes, reset name + stage to sensible defaults.
  function pickType(key: AssetTypeKey) {
    setTypeKey(key);
    setName('');
    setStage('');
    setUnitPrice('');
  }

  // When stage is selected, pre-fill the unit price hint.
  function pickStage(stageKey: string) {
    setStage(stageKey);
    const s = assetType(typeKey).stages.find((st) => st.key === stageKey);
    if (s && s.defaultUnitPriceCents > 0 && unitPrice === '') {
      // Convert cents → currency units for display
      setUnitPrice(String(s.defaultUnitPriceCents / 100));
    }
  }

  const selectedStage = type.stages.find((s) => s.key === stage) || type.stages[0];

  async function submit() {
    if (!profile?.familyId || !activeKidId) return;
    setError('');
    const countNum = parseFloat(count);
    const priceNum = parseFloat(unitPrice) * 100; // convert to cents
    if (!name.trim()) { setError('Give the asset a name.'); return; }
    if (!Number.isFinite(countNum) || countNum <= 0) { setError('Count must be a positive number.'); return; }
    if (!Number.isFinite(priceNum) || priceNum < 0) { setError('Price must be 0 or more.'); return; }
    setSaving(true);
    try {
      await addAsset(profile.familyId, activeKidId, {
        typeKey,
        name: name.trim(),
        count: countNum,
        stage: stage || type.stages[0].key,
        unitPriceCents: Math.round(priceNum),
        notes: notes.trim() || undefined,
      });
      router.replace('/business/assets');
    } catch (e: any) {
      setError(e?.message || 'Failed to add asset.');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4 pb-8">
      <div className="mb-4"><BackButton /></div>

      <div className="mb-5">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-green">My Business</p>
        <h1 className="font-nunito font-black text-2xl mt-1">Add an asset 🌱</h1>
      </div>

      {/* Asset type picker */}
      <section className="mb-5">
        <p className="font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-2">What kind of asset?</p>
        <div className="grid grid-cols-3 gap-2">
          {BUSINESS_ASSET_TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => pickType(t.key)}
              className={`rounded-hive border p-3 flex flex-col items-center gap-1 text-center transition-colors ${
                typeKey === t.key
                  ? 'border-hive-green bg-[#E6F7EE]'
                  : 'border-hive-line bg-hive-paper hover:border-hive-green/50'
              }`}
            >
              <span className="text-2xl">{t.emoji}</span>
              <span className="font-nunito font-extrabold text-[10px] leading-tight">{t.name}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Name */}
      <section className="mb-4">
        <label className="block font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-1">
          Name it
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`e.g. "${type.name} patch A"`}
          maxLength={60}
          className="w-full h-11 px-4 bg-hive-paper border border-hive-line rounded-hive text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-green/40 placeholder:text-hive-muted/50"
        />
      </section>

      {/* Count */}
      <section className="mb-4">
        <label className="block font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-1">
          How many {type.unit}?
        </label>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          placeholder="e.g. 12"
          className="w-full h-11 px-4 bg-hive-paper border border-hive-line rounded-hive text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-green/40 placeholder:text-hive-muted/50"
        />
      </section>

      {/* Stage */}
      <section className="mb-4">
        <label className="block font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-1">
          Current stage
        </label>
        <div className="flex flex-wrap gap-2">
          {type.stages.map((s) => (
            <button
              key={s.key}
              onClick={() => pickStage(s.key)}
              className={`h-9 px-4 rounded-hive-pill font-nunito font-extrabold text-[12px] border transition-colors ${
                (stage || type.stages[0].key) === s.key
                  ? 'border-hive-green bg-hive-green text-white'
                  : 'border-hive-line bg-hive-paper text-hive-navy hover:border-hive-green/50'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      {/* Unit price */}
      <section className="mb-4">
        <label className="block font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-1">
          Value per {type.unit.slice(0, -1) || 'unit'} ({cur})
        </label>
        {selectedStage?.defaultUnitPriceCents > 0 && (
          <p className="text-[11px] text-hive-muted mb-1">
            Suggested: {formatCash(selectedStage.defaultUnitPriceCents, cur)}
          </p>
        )}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          placeholder="0"
          className="w-full h-11 px-4 bg-hive-paper border border-hive-line rounded-hive text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-green/40 placeholder:text-hive-muted/50"
        />
      </section>

      {/* Notes (optional) */}
      <section className="mb-6">
        <label className="block font-nunito font-extrabold text-[12px] text-hive-muted uppercase tracking-[1.5px] mb-1">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={200}
          placeholder="Any extra details…"
          className="w-full px-4 py-3 bg-hive-paper border border-hive-line rounded-hive text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-hive-green/40 placeholder:text-hive-muted/50"
        />
      </section>

      {error && <p className="text-hive-rose font-bold text-[13px] mb-3">{error}</p>}

      <button
        onClick={submit}
        disabled={saving}
        className="w-full bg-hive-green hover:bg-[#2A8553] disabled:opacity-50 text-white rounded-hive py-3.5 font-nunito font-black text-[14px] transition-colors"
      >
        {saving ? 'Adding…' : '+ Add asset'}
      </button>
    </div>
  );
}
