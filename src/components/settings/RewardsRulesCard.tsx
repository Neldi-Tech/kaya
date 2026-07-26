'use client';

// 🎁 Rewards rules (RWD PR1 · R8/R9) — Settings card for the store's two
// family rules, per the approved v2 FINAL design:
//   🛡 Min-points floor — points that must SURVIVE every redemption
//     (family default + per-kid overrides). Spendable = balance − floor,
//     enforced again inside the redemption transaction.
//   ⚡ Auto-approve threshold — kid redemptions at/below N points redeem
//     instantly (0 = always ask a parent; the default).

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily } from '@/lib/firestore';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function RewardsRulesCard() {
  const { profile } = useAuth();
  const { family, children, refresh } = useFamily();
  const cfg = family?.rewardsConfig;
  const [floor, setFloor] = useState<string>('');
  const [auto, setAuto] = useState<string>('');
  const [perKid, setPerKid] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setFloor(cfg?.minPointsFloor ? String(cfg.minPointsFloor) : '');
    setAuto(cfg?.autoApproveBelowPoints ? String(cfg.autoApproveBelowPoints) : '');
    const pk: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg?.minPointsFloorPerKid ?? {})) pk[k] = String(v);
    setPerKid(pk);
  }, [cfg?.minPointsFloor, cfg?.autoApproveBelowPoints, cfg?.minPointsFloorPerKid]);

  const save = async () => {
    if (!profile?.familyId || busy) return;
    setBusy(true);
    try {
      const perKidClean: Record<string, number> = {};
      for (const [k, v] of Object.entries(perKid)) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) perKidClean[k] = n;
      }
      const floorN = parseInt(floor, 10);
      const autoN = parseInt(auto, 10);
      await updateFamily(profile.familyId, {
        rewardsConfig: {
          ...(Number.isFinite(floorN) && floorN > 0 ? { minPointsFloor: floorN } : {}),
          ...(Object.keys(perKidClean).length ? { minPointsFloorPerKid: perKidClean } : {}),
          ...(Number.isFinite(autoN) && autoN > 0 ? { autoApproveBelowPoints: autoN } : {}),
        },
      } as any);
      await refresh?.();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally { setBusy(false); }
  };

  const input = 'w-24 rounded-kaya-sm border border-kaya-warm-dark/70 px-3 py-2 text-[13px] font-bold text-right';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold">🛡 Minimum points to keep</p>
          <p className="text-[11px] text-kaya-sand leading-relaxed">Must survive every redemption. Spendable = balance − this. Empty = no floor.</p>
        </div>
        <input type="number" min={0} value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="0" className={input} />
      </div>
      {children.length > 0 && (
        <div className="rounded-kaya-sm border border-dashed border-kaya-warm-dark/60 p-3 space-y-2">
          <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider">Per-kid floor overrides (optional)</p>
          {children.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-3">
              <p className="text-[12.5px] font-semibold truncate">{k.avatarEmoji || '🧒'} {k.name}</p>
              <input
                type="number" min={0}
                value={perKid[k.id] ?? ''}
                onChange={(e) => setPerKid((p) => ({ ...p, [k.id]: e.target.value }))}
                placeholder={floor || 'family'}
                className={input}
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold">⚡ Auto-approve small redemptions</p>
          <p className="text-[11px] text-kaya-sand leading-relaxed">Kid requests at/below this many points redeem instantly. Empty = always ask a parent.</p>
        </div>
        <input type="number" min={0} value={auto} onChange={(e) => setAuto(e.target.value)} placeholder="off" className={input} />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-4 py-2 rounded-kaya-sm bg-kaya-gold text-white text-[12.5px] font-bold hover:bg-kaya-gold-dark disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save rules'}
        </button>
        {saved && <span className="text-[12px] font-bold text-pantry-leaf-dk">✓ Saved</span>}
        {(parseInt(floor, 10) || 0) > 0 && (
          <span className="text-[11px] text-kaya-sand font-semibold">🛡 {fmt(parseInt(floor, 10))} pts protected family-wide</span>
        )}
      </div>
    </div>
  );
}
