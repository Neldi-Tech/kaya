'use client';

// Kaya Business · New business (kid screen 2). PR2 ships the structured
// version — pick a type, name it, choose customers, set a starting price.
// The AI conversational intake + auto-drafted Business Plan Card layer on
// top of this same createBusiness() call in PR5.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  BUSINESS_TYPES, BusinessType, CustomerChannel, PHASE1_BUSINESS_TYPES,
  CUSTOMER_CHANNELS, createBusiness, readBusinessConfig,
} from '@/lib/business';

export default function NewBusinessPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const { activeKidId, config } = useHive();
  const isParent = profile?.role === 'parent';
  const bizConfig = useMemo(() => readBusinessConfig(family), [family]);

  const [type, setType] = useState<BusinessType | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [mission, setMission] = useState('');
  const [channels, setChannels] = useState<CustomerChannel[]>(['family']);
  const [unitLabel, setUnitLabel] = useState('');
  const [price, setPrice] = useState('');
  const [forKid, setForKid] = useState<string | null>(activeKidId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Only Goods / Service / Advice / Sport / Learning / Ad-hoc in the picker
  // (co-op is Phase 2 and created differently). Phase-2 types render disabled.
  const pickable = BUSINESS_TYPES.filter((t) => t.key !== 'coop');
  const ownerId = isParent ? forKid : (profile?.childId ?? null);

  const toggleChannel = (c: CustomerChannel) => {
    setChannels((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  };

  const canSubmit = !!type && name.trim().length > 1 && !!ownerId && channels.length > 0 && !saving;

  const submit = async () => {
    if (!profile?.familyId || !type || !ownerId) return;
    setError('');
    setSaving(true);
    try {
      const cents = price.trim() ? Math.round(parseFloat(price.replace(/,/g, '')) * 100) : undefined;
      const id = await createBusiness(
        profile.familyId,
        {
          type,
          name: name.trim(),
          emoji: emoji.trim() || BUSINESS_TYPES.find((t) => t.key === type)?.emoji || '💼',
          mission: mission.trim() || undefined,
          customerChannels: channels,
          unitLabel: unitLabel.trim() || undefined,
          unitPriceCents: typeof cents === 'number' && !Number.isNaN(cents) && cents > 0 ? cents : undefined,
          hiveSplit: bizConfig.defaultHiveSplit,
        },
        { uid: profile.uid, ownerId, isParent },
      );
      router.push(id.startsWith('guest') ? '/business' : `/business/${id}`);
    } catch (e: any) {
      setError(e?.message || 'Could not create the business.');
      setSaving(false);
    }
  };

  const label = 'text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5 mt-3';
  const seg = (active: boolean) =>
    `px-3 py-2 rounded-hive-pill text-[12.5px] font-nunito font-extrabold border transition ${
      active ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'
    }`;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="rounded-hive p-3.5 mb-4 flex items-center gap-3 bg-hive-navy text-hive-honey">
        <div className="text-[22px]">✨</div>
        <div>
          <div className="font-nunito font-black text-[16px]">New business</div>
          <div className="text-[11px] text-hive-honey-soft/80">Shape an idea into something real</div>
        </div>
      </div>

      {isParent && children.length > 0 && (
        <>
          <div className={label}>Whose business?</div>
          <div className="flex flex-wrap gap-2">
            {children.map((c) => (
              <button key={c.id} type="button" onClick={() => setForKid(c.id)} className={seg(forKid === c.id)}>
                {c.avatarEmoji} {c.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className={label}>Pick a type</div>
      <div className="grid grid-cols-3 gap-2">
        {pickable.map((t) => {
          const enabled = PHASE1_BUSINESS_TYPES.includes(t.key);
          const active = type === t.key;
          return (
            <button
              key={t.key}
              type="button"
              disabled={!enabled}
              onClick={() => setType(t.key)}
              className={`relative rounded-hive p-3 text-center border transition ${
                active ? 'border-hive-navy bg-hive-paper' : 'border-hive-line bg-hive-paper'
              } ${enabled ? 'hover:border-hive-honey' : 'opacity-45 cursor-not-allowed'}`}
            >
              <div className="text-[22px] leading-none">{t.emoji}</div>
              <div className="text-[11px] font-nunito font-extrabold mt-1">{t.label}</div>
              {!enabled && (
                <span className="absolute top-1 right-1 text-[8px] font-black uppercase tracking-wider px-1 py-0.5 rounded-full bg-hive-cream text-hive-muted">
                  Soon
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className={label}>Name it</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Saturday Car Wash"
        maxLength={50}
        className="w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
      />

      <div className={label}>Icon (optional)</div>
      <input
        value={emoji}
        onChange={(e) => setEmoji(e.target.value)}
        placeholder={type ? BUSINESS_TYPES.find((t) => t.key === type)?.emoji : '💼'}
        maxLength={2}
        className="w-20 h-11 px-3 text-center text-xl bg-hive-paper rounded-hive border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
      />

      <div className={label}>Mission (optional)</div>
      <textarea
        value={mission}
        onChange={(e) => setMission(e.target.value)}
        placeholder="What does this business do, in one line?"
        maxLength={140}
        rows={2}
        className="w-full px-3 py-2 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
      />

      <div className={label}>Who can buy?</div>
      <div className="flex flex-wrap gap-2">
        {CUSTOMER_CHANNELS.map((ch) => {
          const enabled = !ch.gated; // Phase 1: family + relatives only
          const active = channels.includes(ch.key);
          return (
            <button
              key={ch.key}
              type="button"
              disabled={!enabled}
              onClick={() => toggleChannel(ch.key)}
              className={`${seg(active)} ${enabled ? '' : 'opacity-45 cursor-not-allowed'}`}
            >
              {ch.label}{ch.gated ? ' · soon' : ''}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={label}>Unit (optional)</div>
          <input
            value={unitLabel}
            onChange={(e) => setUnitLabel(e.target.value)}
            placeholder="fruit, wash, session"
            maxLength={20}
            className="w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
          />
        </div>
        <div>
          <div className={label}>Price / unit ({config.currency})</div>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
          />
        </div>
      </div>

      {error && <p className="text-hive-rose text-[12px] font-bold mt-3">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="w-full mt-5 h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition"
      >
        {saving ? 'Creating…' : isParent ? 'Create business' : 'Start as Pilot →'}
      </button>
      {!isParent && (
        <p className="text-[11px] text-hive-muted text-center mt-2 leading-relaxed">
          Pilots run free. When you&apos;re ready to go <b>Active</b>, you&apos;ll send a quick launch request
          to a parent from the business page.
        </p>
      )}
    </div>
  );
}
