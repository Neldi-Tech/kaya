'use client';

// /admin/tiers — Module Matrix + Tier Limits (premium dark, per design HTML).
// Operator-only (gated by /admin/layout.tsx). Tier limits + module access
// are persisted as patches on top of `DEFAULT_TIERS` (see lib/tiers.ts +
// lib/tiersServer.ts); the defaults are the fallback when no doc exists.
//
// Staged edits queue locally — admin clicks "Publish changes" to commit
// each tier's patch via /api/admin/tiers. "Discard" reverts.

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_TIERS, MODULE_REGISTRY,
  type SubscriptionTierId, type TierConfig, type ModuleId,
} from '@/lib/tiers';
import { getTiers, saveTierPatch, type TierMap } from '@/lib/tiersClient';

const TIER_IDS: SubscriptionTierId[] = ['nest', 'home', 'castle'];

const TIER_DOT_COLOR: Record<SubscriptionTierId, string> = {
  nest:   '#7CE0C8',
  home:   '#D4A847',
  castle: '#E85C5C',
};

export default function AdminTiersPage() {
  const [base, setBase]   = useState<TierMap | null>(null);  // last-saved
  const [draft, setDraft] = useState<TierMap | null>(null);  // staged
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTiers();
        if (cancelled) return;
        setBase(t);
        setDraft(t);
      } catch (e) {
        if (!cancelled) setErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const stagedCount = useMemo(() => {
    if (!base || !draft) return 0;
    let n = 0;
    for (const id of TIER_IDS) {
      if (JSON.stringify(base[id]) !== JSON.stringify(draft[id])) n += 1;
    }
    return n;
  }, [base, draft]);

  function updateTier(tierId: SubscriptionTierId, patch: Partial<TierConfig>) {
    setDraft((prev) => prev ? ({
      ...prev,
      [tierId]: { ...prev[tierId], ...patch },
    }) : prev);
  }

  function toggleModule(tierId: SubscriptionTierId, moduleId: ModuleId) {
    if (!draft) return;
    const cur = draft[tierId].modules;
    const next = cur.includes(moduleId) ? cur.filter((m) => m !== moduleId) : [...cur, moduleId];
    updateTier(tierId, { modules: next });
  }

  function toggleAddon(tierId: SubscriptionTierId, moduleId: ModuleId) {
    if (!draft) return;
    const cur = draft[tierId].addonModules;
    const next = cur.includes(moduleId) ? cur.filter((m) => m !== moduleId) : [...cur, moduleId];
    updateTier(tierId, { addonModules: next });
  }

  async function publish() {
    if (!base || !draft) return;
    setBusy(true);
    setErr(null);
    try {
      let latest: TierMap = base;
      for (const id of TIER_IDS) {
        const before = base[id];
        const after  = draft[id];
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        const patch: Partial<TierConfig> = {
          memberLimit: after.memberLimit,
          helperLimit: after.helperLimit,
          householdLimit: after.householdLimit,
          historyRetentionDays: after.historyRetentionDays,
          priceMonthly: after.priceMonthly,
          priceYearly: after.priceYearly,
          modules: after.modules,
          addonModules: after.addonModules,
        };
        latest = await saveTierPatch(id, patch);
      }
      setBase(latest);
      setDraft(latest);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    if (base) setDraft(base);
  }

  function reset(tierId: SubscriptionTierId) {
    if (!draft) return;
    setDraft({ ...draft, [tierId]: DEFAULT_TIERS[tierId] });
  }

  if (!draft) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-white/70 text-sm" style={{ background: 'linear-gradient(180deg,#0F1F44 0%,#162954 100%)' }}>
        Loading tiers…
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white" style={{ background: 'linear-gradient(180deg,#0F1F44 0%,#162954 100%)' }}>
      <div className="max-w-[1240px] mx-auto p-5 sm:p-9 pb-32">
        <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display font-extrabold text-2xl text-white tracking-tight m-0 flex items-center gap-2">
              📐 Tiers &amp; Modules
            </h2>
            <p className="text-white/70 text-sm mt-1">Edit each tier's caps and which modules are included. Coral chip = available as a paid Home add-on.</p>
          </div>
          {err && <p className="text-[12px] text-red-300 font-semibold">{err}</p>}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_2fr] gap-5">
          {/* Tier limits */}
          <section className="rounded-[20px] p-5 border border-white/[0.08]" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <h3 className="font-display font-bold text-lg text-white m-0 mb-1">📐 Tier limits</h3>
            <p className="text-[12px] text-white/60 mb-4">Member &amp; helper caps. Override per tier.</p>
            {TIER_IDS.map((id) => {
              const t = draft[id];
              return (
                <div key={id} className="py-3.5 border-b border-white/[0.08] last:border-b-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 font-display font-bold text-base text-white">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: TIER_DOT_COLOR[id] }} />
                      {t.name}
                      <small className="text-white/60 font-normal text-[12px]">· {t.tagline}</small>
                    </div>
                    <div className="font-display font-bold text-[15px] text-[#D4A847]">${(t.priceMonthly / 100).toFixed(0)}/mo</div>
                  </div>
                  <Limit label="Family members"     value={t.memberLimit}          onChange={(v) => updateTier(id, { memberLimit: v })} />
                  <Limit label="Helper slots"       value={t.helperLimit}          onChange={(v) => updateTier(id, { helperLimit: v })} />
                  <Limit label="History retention"  value={t.historyRetentionDays} onChange={(v) => updateTier(id, { historyRetentionDays: v })} suffix="days" />
                  <Limit label="Households"         value={t.householdLimit}       onChange={(v) => updateTier(id, { householdLimit: v })} />
                  <div className="mt-2 flex items-center justify-end">
                    <button type="button" onClick={() => reset(id)} className="text-[11px] text-white/40 hover:text-white/70">Reset to default</button>
                  </div>
                </div>
              );
            })}
          </section>

          {/* Module matrix */}
          <section className="rounded-[20px] p-5 border border-white/[0.08]" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <h3 className="font-display font-bold text-lg text-white m-0 mb-1">🧩 Module access matrix</h3>
            <p className="text-[12px] text-white/60 mb-4">Tick what's included in each tier. Coral chip = available as a paid add-on.</p>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-white/50 font-bold">
                  <th className="text-left pb-3 border-b border-white/10">Module</th>
                  {TIER_IDS.map((id) => (
                    <th key={id} className="text-center pb-3 border-b border-white/10 text-white">
                      <span className="w-2.5 h-2.5 rounded-full inline-block mr-1" style={{ background: TIER_DOT_COLOR[id] }} />
                      {id[0].toUpperCase() + id.slice(1)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODULE_REGISTRY.map((m) => (
                  <tr key={m.id} className="border-b border-white/[0.06] last:border-b-0 hover:bg-white/[0.03]">
                    <td className="py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg w-8 h-8 grid place-items-center rounded-lg" style={{ background: 'rgba(255,255,255,0.08)' }}>{m.emoji}</span>
                        <span>
                          <span className="font-bold text-white">{m.name}</span>
                          <span className="block text-[11px] text-white/55 font-medium">{m.description}{m.shipped ? '' : ' · stub'}</span>
                        </span>
                      </div>
                    </td>
                    {TIER_IDS.map((tierId) => (
                      <td key={tierId} className="text-center py-2.5">
                        <Cell
                          checked={draft[tierId].modules.includes(m.id)}
                          addon={tierId === 'home' && draft.home.addonModules.includes(m.id)}
                          onToggle={() => toggleModule(tierId, m.id)}
                          onToggleAddon={tierId === 'home' ? () => toggleAddon('home', m.id) : undefined}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-[11px] text-white/50">Click the gold chip to toggle inclusion. On the Home column the small coral chip flags add-on availability — toggle by Shift-clicking.</p>
          </section>
        </div>

        {/* Sticky save bar */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 max-w-[920px] w-[calc(100%-2.5rem)] rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap border border-white/[0.12] shadow-[0_24px_60px_rgba(0,0,0,0.35)]" style={{ background: 'rgba(15,31,68,0.96)', backdropFilter: 'blur(10px)' }}>
          <div className="flex items-center gap-2 text-[12px] text-white/80">
            <span className="w-2 h-2 rounded-full" style={{ background: stagedCount > 0 ? '#D4A847' : '#5BB85B', boxShadow: stagedCount > 0 ? '0 0 12px #D4A847' : 'none' }} />
            {stagedCount > 0 ? <span><b className="text-white">{stagedCount} tier{stagedCount === 1 ? '' : 's'} staged</b> · changes preview locally until you publish.</span> : <span className="text-white/60">No changes staged.</span>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={discard} disabled={stagedCount === 0 || busy} className="bg-transparent text-white border border-white/20 px-3 py-2 rounded-lg font-bold text-[12px] disabled:opacity-40">Discard</button>
            <button type="button" onClick={publish} disabled={stagedCount === 0 || busy} className="bg-[#D4A847] text-[#0F1F44] border-none px-3.5 py-2 rounded-lg font-extrabold text-[12px] disabled:opacity-40 shadow-[0_6px_14px_rgba(212,168,71,0.3)]">
              {busy ? 'Publishing…' : `Publish changes →`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Limit({ label, value, onChange, suffix }: { label: string; value: number | null; onChange: (v: number | null) => void; suffix?: string }) {
  const isUnlimited = value === null;
  return (
    <div className="flex items-center justify-between py-1.5 gap-3">
      <span className="text-[12px] text-white/75 font-semibold flex-1">{label}</span>
      <div className="flex items-center gap-1">
        {isUnlimited ? (
          <span className="text-[11px] font-bold text-[#D4A847] mr-1">Unlimited</span>
        ) : (
          <input
            type="number"
            value={value ?? 0}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-20 bg-white/[0.08] border border-white/[0.12] text-white px-2 py-1 rounded-md text-[12px] font-bold text-right"
          />
        )}
        {suffix && !isUnlimited && <span className="text-[11px] text-white/50">{suffix}</span>}
        <button
          type="button"
          onClick={() => onChange(isUnlimited ? 1 : null)}
          className="text-[10px] text-white/50 hover:text-white/80 ml-1"
          title={isUnlimited ? 'Set numeric limit' : 'Mark unlimited'}
        >
          {isUnlimited ? '#' : '∞'}
        </button>
      </div>
    </div>
  );
}

function Cell({ checked, addon, onToggle, onToggleAddon }: {
  checked: boolean;
  addon: boolean;
  onToggle: () => void;
  onToggleAddon?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        if (e.shiftKey && onToggleAddon) onToggleAddon();
        else onToggle();
      }}
      className={`relative inline-grid place-items-center w-[22px] h-[22px] rounded-[6px] border ${
        checked
          ? 'bg-[#D4A847] border-[#D4A847] text-[#0F1F44]'
          : 'bg-white/[0.08] border-white/20 text-transparent'
      }`}
      aria-checked={checked}
      role="checkbox"
      title={`Shift-click to toggle add-on availability${onToggleAddon ? '' : ' (Home only)'}`}
    >
      <span className="font-black text-[14px] leading-none">✓</span>
      {addon && (
        <span className="absolute -top-1.5 -right-2 bg-[#E85C5C] text-white text-[8px] font-extrabold px-1 py-0.5 rounded-md uppercase tracking-wider">Add-on</span>
      )}
    </button>
  );
}
