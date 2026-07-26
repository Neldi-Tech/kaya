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
import { updateFamily, isKidInFamilyGoals } from '@/lib/firestore';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function RewardsRulesCard() {
  const { profile } = useAuth();
  const { family, children, rewards, refresh } = useFamily();
  // BDG PR1 — ℹ️ meaning sheet + the live share-recalc echo (B1–B4).
  const [whoInfoOpen, setWhoInfoOpen] = useState(false);
  const [echo, setEcho] = useState('');
  const cfg = family?.rewardsConfig;
  const [floor, setFloor] = useState<string>('');
  const [auto, setAuto] = useState<string>('');
  const [perKid, setPerKid] = useState<Record<string, string>>({});
  const [goalsAge, setGoalsAge] = useState<string>('');
  const [goalsOverrides, setGoalsOverrides] = useState<Record<string, boolean>>({});
  // 💡 RWI PR-A — reward-idea quota (0 = off, empty = default 3).
  const [ideas, setIdeas] = useState<string>('');
  const [ideasPerKid, setIdeasPerKid] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setFloor(cfg?.minPointsFloor ? String(cfg.minPointsFloor) : '');
    setAuto(cfg?.autoApproveBelowPoints ? String(cfg.autoApproveBelowPoints) : '');
    const pk: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg?.minPointsFloorPerKid ?? {})) pk[k] = String(v);
    setPerKid(pk);
    setGoalsAge(cfg?.familyGoalsFromAge ? String(cfg.familyGoalsFromAge) : '');
    setGoalsOverrides({ ...(cfg?.familyGoalsOverrides ?? {}) });
    // 0 is meaningful here (feature off), so only empty-string when absent.
    setIdeas(typeof cfg?.proposalsPerMonth === 'number' ? String(cfg.proposalsPerMonth) : '');
    const ipk: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg?.proposalsPerMonthPerKid ?? {})) ipk[k] = String(v);
    setIdeasPerKid(ipk);
  }, [cfg?.minPointsFloor, cfg?.autoApproveBelowPoints, cfg?.minPointsFloorPerKid, cfg?.familyGoalsFromAge, cfg?.familyGoalsOverrides, cfg?.proposalsPerMonth, cfg?.proposalsPerMonthPerKid]);

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
      const ageN = parseInt(goalsAge, 10);
      // 💡 ideas quota: 0 = off (kept), empty = absent (default 3 applies).
      const ideasN = parseInt(ideas, 10);
      const ideasPerKidClean: Record<string, number> = {};
      for (const [k, v] of Object.entries(ideasPerKid)) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n >= 0) ideasPerKidClean[k] = n;
      }
      await updateFamily(profile.familyId, {
        rewardsConfig: {
          ...(Number.isFinite(floorN) && floorN > 0 ? { minPointsFloor: floorN } : {}),
          ...(Object.keys(perKidClean).length ? { minPointsFloorPerKid: perKidClean } : {}),
          ...(Number.isFinite(autoN) && autoN > 0 ? { autoApproveBelowPoints: autoN } : {}),
          ...(Number.isFinite(ageN) && ageN > 0 ? { familyGoalsFromAge: ageN } : {}),
          ...(Object.keys(goalsOverrides).length ? { familyGoalsOverrides: goalsOverrides } : {}),
          ...(Number.isFinite(ideasN) && ideasN >= 0 ? { proposalsPerMonth: ideasN } : {}),
          ...(Object.keys(ideasPerKidClean).length ? { proposalsPerMonthPerKid: ideasPerKidClean } : {}),
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
      {/* 👨‍👩‍👧 RWD PR5 (R27) — family-goals age gate, Little-Stars style. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold">👨‍👩‍👧 Family goals from age</p>
          <p className="text-[11px] text-kaya-sand leading-relaxed">Kids at/above this age owe a share; younger kids cheer 📣. Empty = everyone joins. No birthday = included.</p>
        </div>
        <input type="number" min={0} value={goalsAge} onChange={(e) => setGoalsAge(e.target.value)} placeholder="all" className={input} />
      </div>
      {children.length > 0 && (
        <div className="rounded-kaya-sm border border-dashed border-kaya-warm-dark/60 p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider">Per-kid include/exclude (overrides the age)</p>
            <button
              type="button"
              onClick={() => setWhoInfoOpen((o) => !o)}
              className="text-[11px] font-extrabold text-kaya-gold-dark hover:underline shrink-0"
              aria-expanded={whoInfoOpen}
            >
              ℹ️ what do these mean?
            </button>
          </div>
          {/* BDG PR1 (B1/B2/B4) — the meaning sheet: plain language + the
              retroactivity rule + the 🎂 reward-age system, all in one place. */}
          {whoInfoOpen && (
            <div className="rounded-kaya-sm border border-[#CCD6EA] bg-[#EEF2FA] p-3 space-y-2">
              <p className="text-[12px] font-extrabold">👨‍👩‍👧 Who joins family goals?</p>
              <p className="text-[11.5px] leading-relaxed">
                <b>✨ age</b> — follows your family rule above: this kid joins family goals automatically
                from age {goalsAge || '—'} and cheers before that.<br />
                <b>✓ in</b> — always a contributor, whatever their age. In equal-shares goals they owe a share.<br />
                <b>📣 cheer</b> — supporter, not contributor: never owes a share and can&apos;t chip in —
                they watch the bar grow, cheer, and celebrate at the 🎊.
              </p>
              <p className="text-[11.5px] leading-relaxed border-t border-dashed border-[#CCD6EA] pt-2">
                <b>What changes when you switch?</b> Shares on every <b>open</b> family goal recalculate
                immediately (equal shares always divide by today&apos;s contributors). Points a kid already
                chipped in are <b>never taken back</b> — they stay in the pool and on the kid&apos;s 📜
                statement. Finished goals stay exactly as they were.
              </p>
              <p className="text-[11.5px] leading-relaxed border-t border-dashed border-[#CCD6EA] pt-2">
                <b>🎂 And reward age limits?</b> That&apos;s a separate rule set per reward (the Min-age
                field on each reward below): a younger kid sees the reward greyed &ldquo;🔒 opens from age
                N&rdquo;, can keep saving toward it, and it opens by itself on their birthday. No birthday
                on file = no age limits apply.
              </p>
            </div>
          )}
          {echo && <p className="text-[11px] font-bold text-pantry-leaf-dk">{echo}</p>}
          {children.map((k) => {
            const v = goalsOverrides[k.id];
            return (
              <div key={k.id} className="flex items-center justify-between gap-3">
                <p className="text-[12.5px] font-semibold truncate">{k.avatarEmoji || '🧒'} {k.name}</p>
                <div className="flex gap-1">
                  {([['auto', undefined], ['in', true], ['out', false]] as const).map(([label, val]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        // BDG PR1 (B3) — live echo: show the share effect of
                        // this switch on open family goals, before saving.
                        const nextOverrides = { ...goalsOverrides };
                        if (val === undefined) delete nextOverrides[k.id]; else nextOverrides[k.id] = val;
                        const ageN = parseInt(goalsAge, 10);
                        const cfgNow = { familyGoalsFromAge: Number.isFinite(ageN) && ageN > 0 ? ageN : undefined, familyGoalsOverrides: goalsOverrides };
                        const cfgNext = { ...cfgNow, familyGoalsOverrides: nextOverrides };
                        const countNow = children.filter((c) => isKidInFamilyGoals(cfgNow, c)).length;
                        const countNext = children.filter((c) => isKidInFamilyGoals(cfgNext, c)).length;
                        const openGoals = rewards.filter((r) => r.kind === 'family' && r.active && !r.fulfilled);
                        const first = openGoals[0];
                        if (countNow !== countNext && openGoals.length > 0 && first?.targetPoints && countNow > 0 && countNext > 0) {
                          const before = Math.ceil(first.targetPoints / countNow);
                          const after = Math.ceil(first.targetPoints / countNext);
                          const role = val === false ? 'cheers 📣' : val === true ? 'is in ✓' : 'follows the age rule ✨';
                          setEcho(`${k.name.split(' ')[0]} now ${role} — shares on ${openGoals.length} open goal${openGoals.length > 1 ? 's' : ''} recalculate when you save (${before.toLocaleString('en-US')} → ${after.toLocaleString('en-US')} each). Past chip-ins stay counted.`);
                        } else {
                          setEcho('');
                        }
                        setGoalsOverrides(() => nextOverrides);
                      }}
                      className={`px-2 py-1 rounded-full text-[10.5px] font-extrabold border ${
                        (val === undefined ? v === undefined : v === val)
                          ? 'bg-kaya-gold text-white border-kaya-gold-dark'
                          : 'bg-white border-kaya-warm-dark/60 text-kaya-sand'
                      }`}
                    >
                      {label === 'auto' ? '✨ age' : label === 'in' ? '✓ in' : '📣 cheer'}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* 💡 RWI PR-A — reward ideas from kids: monthly quota + per-kid. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold">💡 Reward ideas from kids</p>
          <p className="text-[11px] text-kaya-sand leading-relaxed">Ideas each kid can send per month (declined ones count). Empty = 3. Set 0 to turn the feature off.</p>
        </div>
        <input type="number" min={0} value={ideas} onChange={(e) => setIdeas(e.target.value)} placeholder="3" className={input} />
      </div>
      {children.length > 0 && (
        <div className="rounded-kaya-sm border border-dashed border-kaya-warm-dark/60 p-3 space-y-2">
          <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider">Per-kid idea quota (optional)</p>
          {children.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-3">
              <p className="text-[12.5px] font-semibold truncate">{k.avatarEmoji || '🧒'} {k.name}</p>
              <input
                type="number" min={0}
                value={ideasPerKid[k.id] ?? ''}
                onChange={(e) => setIdeasPerKid((p) => ({ ...p, [k.id]: e.target.value }))}
                placeholder={ideas || '3'}
                className={input}
              />
            </div>
          ))}
        </div>
      )}
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
