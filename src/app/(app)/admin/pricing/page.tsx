'use client';

// /admin/pricing — operator-only. Live-edit per-tier prices + limits.
// Writes to /config/tiers/plans/{tierId} via PATCH /api/admin/tiers.
// /settings/subscription picks the overrides up live (no deploy).
//
// What this page edits per tier:
//   • priceMonthly  (USD cents, monthly billing)
//   • priceYearly   (USD cents, billed-yearly TOTAL — UI shows
//     per-month-equivalent = priceYearly / 12)
//   • memberLimit, helperLimit, householdLimit
//   • historyRetentionDays
//
// What this page does NOT touch:
//   • Modules + addonModules (those live in /admin/tiers)
//   • Stripe Product/Price IDs (PR 4-Pay)

import { useEffect, useMemo, useState } from 'react';
import { getTiers, saveTierPatch, type TierMap } from '@/lib/tiersClient';
import { DEFAULT_TIERS, type SubscriptionTierId, type TierConfig } from '@/lib/tiers';

type Draft = Record<SubscriptionTierId, Partial<TierConfig>>;

export default function AdminPricingPage() {
  const [live, setLive] = useState<TierMap | null>(null);
  const [draft, setDraft] = useState<Draft>({ nest: {}, home: {}, castle: {} });
  const [err, setErr] = useState<string | null>(null);
  const [savingTier, setSavingTier] = useState<SubscriptionTierId | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTiers();
        if (!cancelled) setLive(t);
      } catch (e) {
        if (!cancelled) setErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Resolved value for a field, preferring the local draft, then live config,
  // then DEFAULT_TIERS fallback.
  const resolved = (tierId: SubscriptionTierId): TierConfig => {
    return {
      ...DEFAULT_TIERS[tierId],
      ...(live?.[tierId] ?? {}),
      ...draft[tierId],
    } as TierConfig;
  };

  const dirty = (tierId: SubscriptionTierId): boolean =>
    Object.keys(draft[tierId] || {}).length > 0;

  const update = (tierId: SubscriptionTierId, patch: Partial<TierConfig>) => {
    setDraft((d) => ({ ...d, [tierId]: { ...d[tierId], ...patch } }));
  };

  const discard = (tierId: SubscriptionTierId) => {
    setDraft((d) => ({ ...d, [tierId]: {} }));
  };

  const save = async (tierId: SubscriptionTierId) => {
    setSavingTier(tierId);
    setErr(null);
    try {
      const next = await saveTierPatch(tierId, draft[tierId]);
      setLive(next);
      setDraft((d) => ({ ...d, [tierId]: {} }));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setSavingTier(null);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(160deg,#0F1F44 0%,#162954 100%)' }}>
      <div className="max-w-[960px] mx-auto px-5 py-10">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-9 h-9 rounded-xl grid place-items-center"
              style={{ background: 'rgba(212,168,71,0.18)', border: '1px solid rgba(212,168,71,0.3)' }}
            >
              <span className="text-base">💰</span>
            </div>
            <h1 className="font-display font-black text-2xl text-white tracking-tight m-0">Pricing</h1>
          </div>
          <p className="text-white/55 text-[13px] font-semibold ml-12">
            Live-editable per-tier prices and limits · saves to <code className="text-[#D4A847]">/config/tiers/plans/&lt;tierId&gt;</code> · families see the change without a code deploy.
          </p>
          <p className="text-white/40 text-[12px] font-semibold ml-12 mt-1">
            These are the prices families <span className="text-white/70">see</span>. Actual charges use Stripe Price IDs provisioned separately — reprovision those to match before billing on annual.
          </p>
        </header>

        {err && (
          <div className="bg-[#FF6B6B]/10 border border-[#FF6B6B]/30 rounded-2xl px-4 py-3 text-[#FF7676] text-[13px] font-bold mb-4">
            {err}
          </div>
        )}

        {!live ? (
          <div className="text-white/55 text-sm py-12 text-center">Loading current pricing…</div>
        ) : (
          <div className="grid gap-4">
            {(['nest', 'home', 'castle'] as SubscriptionTierId[]).map((tierId) => (
              <TierPanel
                key={tierId}
                tierId={tierId}
                resolved={resolved(tierId)}
                dirty={dirty(tierId)}
                saving={savingTier === tierId}
                onUpdate={(p) => update(tierId, p)}
                onSave={() => save(tierId)}
                onDiscard={() => discard(tierId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function TierPanel({
  tierId, resolved, dirty, saving, onUpdate, onSave, onDiscard,
}: {
  tierId: SubscriptionTierId;
  resolved: TierConfig;
  dirty: boolean;
  saving: boolean;
  onUpdate: (patch: Partial<TierConfig>) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  void tierId;
  const perMonthYearly = useMemo(() => Math.round(resolved.priceYearly / 12), [resolved.priceYearly]);
  // Annual saving vs paying monthly for 12 months — shown live so the
  // operator can dial in a target discount (e.g. ~30%) as they type.
  const yearlyDiscountPct = useMemo(() => {
    const annualizedMonthly = resolved.priceMonthly * 12;
    return annualizedMonthly > 0
      ? Math.round((1 - resolved.priceYearly / annualizedMonthly) * 100)
      : 0;
  }, [resolved.priceMonthly, resolved.priceYearly]);

  return (
    <section
      className="rounded-3xl p-5"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{resolved.emoji}</span>
          <div>
            <div className="text-white font-black text-[16px]">{resolved.name}</div>
            <div className="text-white/55 text-[11px] font-semibold">{resolved.tagline}</div>
          </div>
        </div>
        {dirty && (
          <span
            className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full"
            style={{ background: 'rgba(212,168,71,0.18)', color: '#D4A847' }}
          >
            Unsaved
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <DollarsField
          label="Monthly billing"
          hint="Charged each month — typically higher than billed-yearly."
          valueCents={resolved.priceMonthly}
          onChange={(cents) => onUpdate({ priceMonthly: cents })}
        />
        <DollarsField
          label="Yearly total"
          hint={
            yearlyDiscountPct > 0
              ? `Charged once per year. Per-month: $${(perMonthYearly / 100).toFixed(2)} · ${yearlyDiscountPct}% cheaper than monthly.`
              : `Charged once per year. Per-month: $${(perMonthYearly / 100).toFixed(2)}.`
          }
          valueCents={resolved.priceYearly}
          onChange={(cents) => onUpdate({ priceYearly: cents })}
        />
        <LimitField
          label="Members"
          hint="Parents + kids + guests, total. ∞ = unlimited."
          value={resolved.memberLimit}
          onChange={(v) => onUpdate({ memberLimit: v })}
        />
        <LimitField
          label="Helpers"
          hint="Nannies / tutors / grandparents."
          value={resolved.helperLimit}
          onChange={(v) => onUpdate({ helperLimit: v })}
        />
        <LimitField
          label="Households"
          hint="Distinct homes the family can manage."
          value={resolved.householdLimit}
          onChange={(v) => onUpdate({ householdLimit: v })}
        />
        <LimitField
          label="History (days)"
          hint="How far back activity / Moments / receipts are retained. ∞ = forever."
          value={resolved.historyRetentionDays}
          onChange={(v) => onUpdate({ historyRetentionDays: v })}
        />
      </div>

      {dirty && (
        <footer className="flex items-center gap-2 pt-3 border-t border-white/10">
          <button
            onClick={onDiscard}
            disabled={saving}
            className="text-[12px] font-bold px-3 py-2 rounded-lg disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}
          >
            Discard
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="text-[12px] font-black px-3 py-2 rounded-lg disabled:opacity-50"
            style={{ background: '#D4A847', color: '#0F1F44' }}
          >
            {saving ? 'Saving…' : 'Publish'}
          </button>
        </footer>
      )}
    </section>
  );
}

function DollarsField({
  label, hint, valueCents, onChange,
}: {
  label: string; hint: string; valueCents: number; onChange: (cents: number) => void;
}) {
  // Internal string state — lets the input render blank or partial decimals
  // while typing without snapping the value back.
  const [text, setText] = useState((valueCents / 100).toFixed(2));
  useEffect(() => { setText((valueCents / 100).toFixed(2)); }, [valueCents]);

  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <span className="text-white/55 text-sm font-bold">$</span>
        <input
          value={text}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, '');
            setText(v);
            const n = Number(v);
            if (Number.isFinite(n)) onChange(Math.max(0, Math.round(n * 100)));
          }}
          inputMode="decimal"
          placeholder="0.00"
          className="w-full bg-transparent text-white text-[15px] font-extrabold outline-none"
        />
        <span className="text-white/45 text-[11px] font-bold uppercase">USD</span>
      </div>
    </Field>
  );
}

function LimitField({
  label, hint, value, onChange,
}: {
  label: string; hint: string; value: number | null; onChange: (v: number | null) => void;
}) {
  const isUnlimited = value === null;
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          value={isUnlimited ? '' : String(value)}
          disabled={isUnlimited}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9]/g, '');
            if (v === '') onChange(0);
            else onChange(Math.max(0, parseInt(v, 10)));
          }}
          inputMode="numeric"
          placeholder={isUnlimited ? '∞' : '0'}
          className="w-full bg-transparent text-white text-[15px] font-extrabold outline-none disabled:opacity-50"
        />
        <button
          onClick={() => onChange(isUnlimited ? 0 : null)}
          className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full"
          style={
            isUnlimited
              ? { background: 'rgba(212,168,71,0.2)', color: '#D4A847' }
              : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }
          }
        >
          {isUnlimited ? '∞ on' : '∞ off'}
        </button>
      </div>
    </Field>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] font-black text-white/55 uppercase tracking-wider mb-1">{label}</div>
      <div
        className="rounded-xl px-3 py-2.5"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {children}
      </div>
      <div className="text-[10px] text-white/45 font-semibold mt-1 leading-snug">{hint}</div>
    </label>
  );
}
