'use client';

// /settings/subscription — Plan & Billing page (Stripe self-serve, PR 4-Pay).
//
// Paid tiers go through Stripe Checkout (hosted); the webhook is what
// actually flips the family's tier. A family that already pays gets a
// "Manage billing" button into Stripe's Customer Portal (change card,
// switch plan, cancel). Renders the same 3-tier matrix the admin matrix
// configures, shows the family's current plan (resolved by useTierAccess),
// and shows prices in the household's currency with USD as the source of
// truth. The redeem-code card stays as the operator escape hatch.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useTierAccess } from '@/lib/tierAccess';
import { formatBytes, tierCapBytes, usagePercent, usageState } from '@/lib/storage';
import { isProbablyTierCode } from '@/lib/tierCodes';
import { auth } from '@/lib/firebase';
import type { Family } from '@/lib/firestore';
import {
  DEFAULT_ADDONS, MODULE_REGISTRY, isAddonReleased,
  type SubscriptionTierId, type TierConfig,
} from '@/lib/tiers';
import { usdFxRate } from '@/lib/pricing';
import { neatPriceCents } from '@/lib/format';
import { formatCents } from '@/components/pantry/format';

type BillingCycle = 'monthly' | 'yearly';

const NAVY = '#0F1F44';
const GOLD = '#D4A847';
const CREAM = '#FBF7EE';
const MUTED = '#6E7791';

export default function SubscriptionPage() {
  const access = useTierAccess();
  const { config, fxUsdToFamily } = useHive();
  const { family } = useFamily();
  const [cycle, setCycle] = useState<BillingCycle>('yearly');
  const [busy, setBusy] = useState<SubscriptionTierId | 'portal' | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(id);
  }, [toast]);

  // Manage billing / cancel — opens Stripe's Customer Portal for the
  // family's existing customer. On success we navigate away (keep busy).
  const openPortal = async () => {
    try {
      setBusy('portal');
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'no-customer') {
          setToast({ kind: 'err', msg: 'No billing set up yet — choose a plan to get started. 🌻' });
          setBusy(null);
          return;
        }
        throw new Error(data.error || 'portal-failed');
      }
      if (!data.url) throw new Error('no-portal-url');
      window.location.href = data.url as string;
    } catch (e) {
      setToast({ kind: 'err', msg: `Couldn't open billing: ${String(e instanceof Error ? e.message : e)}` });
      setBusy(null);
    }
  };

  // Paid upgrade → Stripe Checkout (hosted). The webhook flips the tier on
  // success; here we just hand off to Stripe's URL. Nest is a downgrade, so
  // it routes through the portal's cancel instead.
  const startCheckout = async (tierId: SubscriptionTierId) => {
    if (tierId === 'nest') return openPortal();
    try {
      setBusy(tierId);
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tierId, cycle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.usePortal) return openPortal();
        throw new Error(data.error || 'checkout-failed');
      }
      if (!data.url) throw new Error('no-session-url');
      window.location.href = data.url as string;
    } catch (e) {
      setToast({ kind: 'err', msg: `Couldn't start checkout: ${String(e instanceof Error ? e.message : e)}` });
      setBusy(null);
    }
  };

  const redeemCode = async (code: string): Promise<{ ok: boolean; message: string }> => {
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch('/api/tier-codes/redeem', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: data.message ?? data.error ?? 'Redeem failed.' };
      return { ok: true, message: `Welcome to ${(data.tier as string).toUpperCase()} — your new plan is live!` };
    } catch (e) {
      return { ok: false, message: String(e instanceof Error ? e.message : e) };
    }
  };

  // ── Add-on selection + request (mode A: operator approves) ──────────
  // Released add-ons can be selected → "Request" lands in the operator's
  // upgrade-requests queue. Unreleased ("coming soon") ones aren't selectable
  // and are rejected server-side too, so they can never be requested/charged.
  const ownedAddons = useMemo(
    () => new Set(family?.subscription?.addons ?? []),
    [family],
  );
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());
  const [requestingAddons, setRequestingAddons] = useState(false);

  const toggleAddon = (id: string) => {
    setSelectedAddons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedAddonTotalCents = useMemo(() => {
    let sum = 0;
    for (const id of selectedAddons) {
      const a = DEFAULT_ADDONS.find((x) => x.id === id);
      if (a) sum += a.priceMonthly;
    }
    return sum;
  }, [selectedAddons]);

  const requestAddons = async () => {
    if (selectedAddons.size === 0 || requestingAddons) return;
    setRequestingAddons(true);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch('/api/upgrade-requests', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requestedTier: access.tierId, requestedAddons: [...selectedAddons] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'request-failed');
      setSelectedAddons(new Set());
      setToast({ kind: 'ok', msg: 'Add-ons requested — your operator will set them up shortly. 🎉' });
    } catch (e) {
      setToast({ kind: 'err', msg: `Couldn't send request: ${String(e instanceof Error ? e.message : e)}` });
    } finally {
      setRequestingAddons(false);
    }
  };

  const currency = config.currency || 'USD';
  // Live FX is preferred; fall back to the static table in pricing.ts;
  // last-ditch fall back to 1 so we never crash if both are missing.
  const fx = fxUsdToFamily ?? usdFxRate(currency) ?? 1;

  // Local helper: USD-cents → family-currency formatted string. Uses
  // neatPriceCents (NOT roundNeatCents) so small subscription prices
  // survive: the USD base shows exactly ($6, $14, $7.20, $1–$4) while
  // FX conversions still read cleanly (KSh 936 → KSh 950). roundNeatCents'
  // fixed $10 floor used to flatten Home/Castle both to "$10" and every
  // add-on to "$0".
  const toLocal = useMemo(() => {
    return (usdCents: number): string => {
      if (usdCents === 0) return formatCents(0, currency);
      const localCents = Math.round(usdCents * fx);
      return formatCents(neatPriceCents(localCents, fx), currency);
    };
  }, [currency, fx]);

  // Per-month price for a tier given the billing cycle, in USD cents.
  // Read from access.tiers — the LIVE merged config (defaults + any
  // overrides published from /admin/tiers + /admin/pricing) — NOT from
  // DEFAULT_TIERS, so operator edits reflect here without a deploy.
  const perMonthCents = (tierId: SubscriptionTierId): number => {
    const t = access.tiers[tierId];
    return cycle === 'yearly' ? Math.round(t.priceYearly / 12) : t.priceMonthly;
  };
  const yearlyTotalCents = (tierId: SubscriptionTierId): number =>
    access.tiers[tierId].priceYearly;

  // Biggest annual saving across paid tiers — drives the "Save up to X%"
  // badge on the Yearly toggle. Computed from the LIVE prices so it can
  // never drift from the real numbers (it used to be a hardcoded "17%").
  const maxYearlyDiscountPct = useMemo(() => {
    let best = 0;
    for (const id of ['home', 'castle'] as SubscriptionTierId[]) {
      const t = access.tiers[id];
      const annualized = t.priceMonthly * 12;
      if (annualized > 0 && t.priceYearly > 0) {
        const pct = Math.round((1 - t.priceYearly / annualized) * 100);
        if (pct > best) best = pct;
      }
    }
    // Round to the nearest 5% for a clean headline (e.g. 29% → 30%).
    return Math.round(best / 5) * 5;
  }, [access.tiers]);

  const isCurrent = (tierId: SubscriptionTierId) => access.tierId === tierId;
  const currentTier = access.tiers[access.tierId];

  // Whether to surface "Manage billing": the family has a real Stripe
  // customer and isn't on an operator/founding grant (those have no
  // subscription to manage).
  const hasStripeCustomer = !!family?.subscription?.stripeCustomerId;
  const isBypass = access.isOperatorBypass || access.isFoundingBypass;

  // Human-friendly limit copy for the comparison table (live).
  const memberCopy = (t: TierConfig) => t.memberLimit === null ? '∞' : String(t.memberLimit);
  const helperCopy = (t: TierConfig) => t.helperLimit === null ? '∞' : String(t.helperLimit);
  const historyCopy = (t: TierConfig) => {
    if (t.historyRetentionDays === null) return 'Forever';
    if (t.historyRetentionDays >= 365)   return `${Math.round(t.historyRetentionDays / 365)} year`;
    if (t.historyRetentionDays >= 30)    return `${t.historyRetentionDays} days`;
    return `${t.historyRetentionDays} days`;
  };
  const nestT = access.tiers.nest;
  const homeT = access.tiers.home;
  const castleT = access.tiers.castle;

  return (
    <div style={{ background: CREAM, minHeight: '100vh', color: NAVY }}>
      {/* Top nav */}
      <nav
        className="sticky top-0 z-40 flex items-center px-5 backdrop-blur-md"
        style={{
          background: 'rgba(251,247,238,0.88)',
          borderBottom: '1px solid rgba(15,31,68,0.07)',
          height: 56,
        }}
      >
        <Link
          href="/settings"
          className="text-[13px] font-extrabold"
          style={{ color: MUTED }}
        >
          ← Settings
        </Link>
        <span
          className="absolute left-1/2 -translate-x-1/2 text-[15px] font-black"
          style={{ color: NAVY }}
        >
          Your Kaya Plan
        </span>
      </nav>

      <div className="max-w-[980px] mx-auto px-5 pt-12 pb-20">
        {/* Current plan banner */}
        <div
          className="flex items-center gap-3 mb-11 rounded-2xl px-5 py-3.5"
          style={{
            background: 'white',
            border: '1.5px solid rgba(15,31,68,0.08)',
            boxShadow: '0 2px 12px rgba(15,31,68,0.04)',
          }}
        >
          <div className="text-[26px] leading-none flex-shrink-0">{currentTier.emoji}</div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-extrabold tracking-wider uppercase" style={{ color: MUTED }}>
              Active plan
            </div>
            <div className="text-[16px] font-black truncate" style={{ color: NAVY }}>
              {currentTier.name}
            </div>
            <div className="text-[12px] font-semibold" style={{ color: MUTED }}>
              {currentTier.tagline} ·{' '}
              {currentTier.memberLimit === null ? 'Unlimited members' : `${currentTier.memberLimit} members`}
              {' · '}
              {currentTier.historyRetentionDays === null
                ? 'Forever history'
                : currentTier.historyRetentionDays >= 365
                  ? '1-year history'
                  : `${currentTier.historyRetentionDays}-day history`}
            </div>
          </div>
          {(access.isOperatorBypass || access.isFoundingBypass) && (
            <div
              className="rounded-full text-[11px] font-extrabold px-3 py-1 flex-shrink-0"
              style={{
                background: 'rgba(212,168,71,0.15)',
                color: '#B8860B',
                border: '1px solid rgba(212,168,71,0.35)',
              }}
            >
              {access.isOperatorBypass ? '✨ Operator' : '🌟 Founding family'}
            </div>
          )}
          {!access.isOperatorBypass && !access.isFoundingBypass && (
            <div
              className="rounded-full text-[11px] font-extrabold px-3 py-1 flex-shrink-0"
              style={{
                background: 'rgba(91,184,91,0.12)',
                color: '#4CAF50',
                border: '1px solid rgba(91,184,91,0.25)',
              }}
            >
              ✓ Active
            </div>
          )}
        </div>

        {/* Storage usage bar */}
        <StorageUsageBar
          tier={currentTier}
          family={family}
          isBypass={access.isOperatorBypass || access.isFoundingBypass}
          bypassLabel={access.isOperatorBypass ? 'Operator · uncapped' : 'Founding family · uncapped'}
        />

        {/* Redeem code */}
        <RedeemCard onRedeem={redeemCode} onSuccess={(msg) => setToast({ kind: 'ok', msg })} />

        {/* Hero */}
        <div className="text-center mb-11">
          <h1 className="text-[32px] sm:text-[34px] font-black leading-[1.22] mb-2" style={{ color: NAVY }}>
            Grow your family&apos;s Kaya<br />to the next level.
          </h1>
          <p className="text-[15px] font-semibold" style={{ color: MUTED }}>
            Simple, transparent pricing. Upgrade any time. Cancel any time.
          </p>

          {/* Billing toggle */}
          <div
            className="inline-flex items-center rounded-full p-1 mt-6"
            style={{ background: 'rgba(15,31,68,0.06)' }}
          >
            <BillingButton active={cycle === 'monthly'} onClick={() => setCycle('monthly')}>
              Monthly
            </BillingButton>
            <BillingButton active={cycle === 'yearly'} onClick={() => setCycle('yearly')}>
              <span>Yearly</span>
              {maxYearlyDiscountPct > 0 && (
                <span
                  className="ml-2 rounded-full text-[10px] font-black tracking-wide px-2 py-0.5"
                  style={{ background: GOLD, color: 'white' }}
                >
                  SAVE UP TO {maxYearlyDiscountPct}%
                </span>
              )}
            </BillingButton>
          </div>
        </div>

        {/* Three tier cards */}
        <div className="grid md:grid-cols-[1fr_1.08fr_1fr] gap-3.5 items-start mb-14">
          <TierCard
            tierId="nest"
            tier={nestT}
            isCurrent={isCurrent('nest')}
            perMonthLocal={toLocal(perMonthCents('nest'))}
            perMonthUsdCents={perMonthCents('nest')}
            yearlyTotalLocal={toLocal(yearlyTotalCents('nest'))}
            yearlyTotalUsdCents={yearlyTotalCents('nest')}
            cycle={cycle}
            onCheckout={startCheckout}
            onManage={openPortal}
            busy={busy}
            hasStripeCustomer={hasStripeCustomer}
            isBypass={isBypass}
            currency={currency}
          />
          <TierCard
            tierId="home"
            tier={homeT}
            isCurrent={isCurrent('home')}
            perMonthLocal={toLocal(perMonthCents('home'))}
            perMonthUsdCents={perMonthCents('home')}
            yearlyTotalLocal={toLocal(yearlyTotalCents('home'))}
            yearlyTotalUsdCents={yearlyTotalCents('home')}
            cycle={cycle}
            onCheckout={startCheckout}
            onManage={openPortal}
            busy={busy}
            hasStripeCustomer={hasStripeCustomer}
            isBypass={isBypass}
            currency={currency}
          />
          <TierCard
            tierId="castle"
            tier={castleT}
            isCurrent={isCurrent('castle')}
            perMonthLocal={toLocal(perMonthCents('castle'))}
            perMonthUsdCents={perMonthCents('castle')}
            yearlyTotalLocal={toLocal(yearlyTotalCents('castle'))}
            yearlyTotalUsdCents={yearlyTotalCents('castle')}
            cycle={cycle}
            onCheckout={startCheckout}
            onManage={openPortal}
            busy={busy}
            hasStripeCustomer={hasStripeCustomer}
            isBypass={isBypass}
            currency={currency}
          />
        </div>

        {/* Comparison table */}
        <div
          className="rounded-2xl mb-12 px-7 py-6"
          style={{
            background: 'white',
            border: '1.5px solid rgba(15,31,68,0.07)',
            boxShadow: '0 2px 16px rgba(15,31,68,0.04)',
          }}
        >
          <h3 className="text-[16px] font-black mb-4" style={{ color: NAVY }}>
            Plan comparison at a glance
          </h3>

          <CompareHeader />
          <CompareRow label="Members" nest={memberCopy(nestT)} home={memberCopy(homeT)} castle={memberCopy(castleT)} />
          <CompareRow
            label="Helpers"
            sublabel="nanny, tutor, grandparent"
            nest={helperCopy(nestT)}
            home={helperCopy(homeT)}
            castle={helperCopy(castleT)}
          />
          <CompareRow label="Activity history" nest={historyCopy(nestT)} home={historyCopy(homeT)} castle={historyCopy(castleT)} />
          <CompareRow label="Storage" nest="200 MB" home="2 GB" castle="Plenty" />
          {/* Every shipped module from MODULE_REGISTRY — iterate so adding a
              new module in lib/tiers.ts surfaces it here without UI work. */}
          {MODULE_REGISTRY.filter((m) => m.shipped).map((m, i, arr) => {
            const addon = DEFAULT_ADDONS.find((a) => a.moduleId === m.id);
            return (
              <CompareRow
                key={m.id}
                label={`${m.emoji} ${m.name}`}
                sublabel={m.description}
                nest={nestT.modules.includes(m.id) ? 'yes' : 'no'}
                home={
                  homeT.modules.includes(m.id)
                    ? 'yes'
                    : addon
                      ? `Add-on ${toLocal(addon.priceMonthly)}/mo`
                      : 'no'
                }
                castle={castleT.modules.includes(m.id) ? 'yes' : 'no'}
                last={i === arr.length - 1}
              />
            );
          })}
        </div>

        {/* Add-ons */}
        <div className="mb-5">
          <h2 className="text-[22px] font-black mb-1" style={{ color: NAVY }}>
            Power up with Home add-ons
          </h2>
          <p className="text-[14px] font-semibold" style={{ color: MUTED }}>
            Add exactly what your family needs.{' '}
            <strong style={{ color: GOLD }}>All included free in Castle.</strong>
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {DEFAULT_ADDONS.map((addon) => {
            const released = isAddonReleased(addon);
            const owned = ownedAddons.has(addon.id);
            const isCastle = access.tierId === 'castle';
            const eligible = addon.eligibleTiers.includes(access.tierId);
            const selected = selectedAddons.has(addon.id);
            // Selectable only when released, not already owned, not Castle
            // (everything's included), and the tier can buy it (Home today).
            const selectable = released && !owned && !isCastle && eligible;

            let footer: React.ReactNode;
            if (isCastle) {
              footer = <AddonTag tone="included">Included ✓</AddonTag>;
            } else if (owned) {
              footer = <AddonTag tone="active">Active ✓</AddonTag>;
            } else if (!released) {
              footer = <AddonTag tone="soon">Coming soon</AddonTag>;
            } else if (!eligible) {
              footer = <AddonTag tone="muted">On Home plan</AddonTag>;
            } else {
              footer = (
                <div
                  className="mt-2.5 w-full text-center text-[12.5px] font-black rounded-[11px] py-2 transition-colors"
                  style={
                    selected
                      ? { background: GOLD, color: 'white', border: `1.5px solid ${GOLD}` }
                      : { background: 'white', color: GOLD, border: `1.5px solid ${GOLD}` }
                  }
                >
                  {selected ? 'Added ✓' : '+ Add'}
                </div>
              );
            }

            return (
              <div
                key={addon.id}
                role={selectable ? 'button' : undefined}
                tabIndex={selectable ? 0 : undefined}
                onClick={selectable ? () => toggleAddon(addon.id) : undefined}
                onKeyDown={selectable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAddon(addon.id); } } : undefined}
                className="rounded-2xl p-4 transition-all flex flex-col"
                style={{
                  background: 'white',
                  border: selected ? `1.5px solid ${GOLD}` : '1.5px solid rgba(15,31,68,0.08)',
                  boxShadow: selected ? '0 0 0 3px rgba(212,168,71,0.18)' : 'none',
                  cursor: selectable ? 'pointer' : 'default',
                  opacity: !released && !owned && !isCastle ? 0.72 : 1,
                }}
              >
                <div
                  className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center text-[20px] mb-2.5"
                  style={{ background: addon.emojiBg }}
                >
                  {addon.emoji}
                </div>
                <div className="text-[13px] font-black mb-1" style={{ color: NAVY }}>
                  {addon.name}
                </div>
                <p className="text-[11px] font-semibold leading-[1.45] mb-2.5 flex-1" style={{ color: MUTED }}>
                  {addon.description}
                </p>
                <div className="text-[14px] font-black" style={{ color: NAVY }}>
                  {toLocal(addon.priceMonthly)}
                  <span className="text-[11px] font-semibold ml-1" style={{ color: MUTED }}>
                    /month
                  </span>
                </div>
                {currency !== 'USD' && (
                  <div className="text-[10px] font-semibold mt-0.5" style={{ color: MUTED, opacity: 0.7 }}>
                    ≈ ${(addon.priceMonthly / 100).toFixed(addon.priceMonthly % 100 === 0 ? 0 : 2)} USD
                  </div>
                )}
                {footer}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          className="text-center text-[13px] font-semibold leading-[1.65] pt-6 mt-12"
          style={{ color: MUTED, borderTop: '1px solid rgba(15,31,68,0.08)' }}
        >
          Prices billed in USD; shown in your home currency ({currency}) for reference.
          <br />
          Yearly plans billed as a single annual charge.
          <br />
          Questions about upgrading?{' '}
          <a
            href="mailto:hello@ourkaya.com?subject=Question%20about%20Kaya%20plans"
            style={{ color: GOLD, fontWeight: 800, textDecoration: 'none' }}
          >
            hello@ourkaya.com
          </a>{' '}
          — we respond same day. 🌻
        </div>
      </div>

      {/* Add-on request cart bar — appears once at least one add-on is picked */}
      {selectedAddons.size > 0 && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl"
          style={{ background: NAVY, color: 'white', boxShadow: '0 18px 44px rgba(15,31,68,0.32)', width: 640, maxWidth: '92vw' }}
        >
          <div>
            <div className="text-[12px] font-extrabold" style={{ color: 'rgba(255,255,255,0.72)' }}>
              {selectedAddons.size} add-on{selectedAddons.size === 1 ? '' : 's'} selected
            </div>
            <div className="text-[17px] font-black leading-tight">
              +{toLocal(selectedAddonTotalCents)}
              <span className="text-[12px] font-semibold ml-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>/mo</span>
            </div>
            <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Your operator approves new add-ons during early access.
            </div>
          </div>
          <div className="flex-1" />
          <button
            onClick={requestAddons}
            disabled={requestingAddons}
            className="text-[14px] font-black rounded-xl px-5 py-2.5 disabled:opacity-60 whitespace-nowrap"
            style={{ background: GOLD, color: NAVY }}
          >
            {requestingAddons ? 'Sending…' : 'Request add-ons →'}
          </button>
        </div>
      )}

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl text-[13px] font-black shadow-lg max-w-[480px]"
          style={toast.kind === 'ok'
            ? { background: '#0F1F44', color: 'white', boxShadow: '0 14px 32px rgba(15,31,68,0.25)' }
            : { background: '#E85C5C', color: 'white', boxShadow: '0 14px 32px rgba(232,92,92,0.25)' }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function AddonTag({ tone, children }: { tone: 'included' | 'active' | 'soon' | 'muted'; children: React.ReactNode }) {
  const style =
    tone === 'included' ? { background: 'rgba(212,168,71,0.14)', color: '#B8860B' }
    : tone === 'active' ? { background: 'rgba(91,184,91,0.14)', color: '#3F9B3F' }
    : tone === 'soon' ? { background: 'rgba(15,31,68,0.06)', color: '#6E7791' }
    : { background: 'rgba(15,31,68,0.04)', color: '#8A93A8' };
  return (
    <div className="mt-2.5 w-full text-center text-[11px] font-black py-2 rounded-[11px]" style={style}>
      {children}
    </div>
  );
}

function BillingButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-full text-[13px] font-extrabold px-5 py-2 transition-all"
      style={{
        background: active ? 'white' : 'transparent',
        color: active ? NAVY : MUTED,
        boxShadow: active ? '0 2px 10px rgba(15,31,68,0.1)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

function TierCard({
  tierId,
  isCurrent,
  perMonthLocal,
  perMonthUsdCents,
  yearlyTotalLocal,
  yearlyTotalUsdCents,
  cycle,
  currency,
  tier,
  onCheckout,
  onManage,
  busy,
  hasStripeCustomer,
  isBypass,
}: {
  tierId: SubscriptionTierId;
  tier: TierConfig;
  isCurrent: boolean;
  perMonthLocal: string;
  perMonthUsdCents: number;
  yearlyTotalLocal: string;
  yearlyTotalUsdCents: number;
  cycle: BillingCycle;
  currency: string;
  onCheckout: (tierId: SubscriptionTierId) => void;
  onManage: () => void;
  busy: SubscriptionTierId | 'portal' | null;
  hasStripeCustomer: boolean;
  isBypass: boolean;
}) {
  const isFree = tier.priceMonthly === 0;

  // Style variants per tier
  const variant = tierId === 'home' ? 'home' : tierId === 'castle' ? 'castle' : 'nest';

  const cardStyle: React.CSSProperties = {
    nest: {
      background: 'white',
      border: '1.5px solid rgba(15,31,68,0.09)',
      boxShadow: '0 4px 20px rgba(15,31,68,0.04)',
      color: NAVY,
    },
    home: {
      background: NAVY,
      color: 'white',
      transform: 'translateY(-10px)',
      boxShadow: '0 28px 72px rgba(15,31,68,0.22)',
    },
    castle: {
      background: 'linear-gradient(148deg, #14255a 0%, #0F1F44 55%, #0a1837 100%)',
      color: 'white',
      border: '1.5px solid rgba(212,168,71,0.28)',
      boxShadow: '0 4px 24px rgba(212,168,71,0.08)',
    },
  }[variant];

  const textOpacity = variant === 'nest' ? 0.55 : 0.55;

  return (
    <div
      className="rounded-3xl px-5 pt-7 pb-6 relative"
      style={cardStyle}
    >
      {/* Top badge slot */}
      <div className="min-h-[28px] mb-4 flex items-center">
        {isCurrent && (
          <span
            className="inline-flex items-center gap-1 rounded-full text-[11px] font-extrabold px-3 py-1"
            style={{
              background: 'rgba(91,184,91,0.12)',
              color: '#4CAF50',
              border: '1px solid rgba(91,184,91,0.3)',
            }}
          >
            ✓ Your current plan
          </span>
        )}
        {!isCurrent && variant === 'home' && (
          <span
            className="inline-flex items-center gap-1 rounded-full text-[11px] font-extrabold px-3 py-1"
            style={{ background: 'rgba(212,168,71,0.18)', color: GOLD }}
          >
            ⭐ Most families
          </span>
        )}
        {!isCurrent && variant === 'castle' && (
          <span
            className="inline-flex items-center gap-1 rounded-full text-[11px] font-extrabold px-3 py-1"
            style={{ background: 'rgba(212,168,71,0.12)', color: '#C89F3A' }}
          >
            🏰 Full access
          </span>
        )}
      </div>

      <span className="text-[30px] mb-2 block leading-none">{tier.emoji}</span>
      <div className="text-[19px] font-black mb-0.5">{tier.name}</div>
      <div className="text-[12px] font-semibold mb-5" style={{ opacity: textOpacity }}>
        {tier.tagline}
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-[32px] sm:text-[36px] font-black leading-none break-words">
          {isFree ? formatCents(0, currency) : perMonthLocal}
        </span>
        <span className="text-[14px] font-bold" style={{ opacity: 0.55 }}>
          /month
        </span>
      </div>
      {/* Subtext: USD reference + yearly billed total */}
      <div className="text-[11px] font-bold min-h-[34px] mb-5" style={{ opacity: 0.45 }}>
        {!isFree && currency !== 'USD' && (
          <div>
            ≈ ${(perMonthUsdCents / 100).toFixed(perMonthUsdCents % 100 === 0 ? 0 : 2)} USD
          </div>
        )}
        {!isFree && cycle === 'yearly' && (
          <div>
            billed {yearlyTotalLocal}/year
            {currency !== 'USD' && (
              <> · ${(yearlyTotalUsdCents / 100).toFixed(yearlyTotalUsdCents % 100 === 0 ? 0 : 2)} USD</>
            )}
          </div>
        )}
      </div>

      {/* Divider */}
      <div
        className="h-px my-4"
        style={{
          background: variant === 'nest' ? 'rgba(15,31,68,0.07)' : 'rgba(255,255,255,0.1)',
        }}
      />

      {/* Features */}
      <Features tierId={tierId} variant={variant} />

      {/* CTA */}
      <CtaButton
        tierId={tierId}
        variant={variant}
        isCurrent={isCurrent}
        isBypass={isBypass}
        hasStripeCustomer={hasStripeCustomer}
        busy={busy}
        onCheckout={onCheckout}
        onManage={onManage}
      />
    </div>
  );
}

function Features({ tierId, variant }: { tierId: SubscriptionTierId; variant: 'nest' | 'home' | 'castle' }) {
  const items: { yes: boolean; text: string }[] =
    tierId === 'nest'
      ? [
          { yes: true, text: '4 family members' },
          { yes: true, text: '1 helper (nanny, tutor)' },
          { yes: true, text: '30-day activity history' },
          { yes: true, text: 'Kaya core, Moments, Fun' },
          { yes: true, text: 'Kaya Buzz community' },
          { yes: false, text: 'The Hive (coins & vault)' },
          { yes: false, text: 'Household, Business, Wealth…' },
        ]
      : tierId === 'home'
        ? [
            { yes: true, text: '8 members · 3 helpers' },
            { yes: true, text: '1-year activity history' },
            { yes: true, text: 'The Hive — Honey Coins & vault' },
            { yes: true, text: 'Household, Pages & Dreams' },
            { yes: true, text: 'Everything in Nest' },
            { yes: true, text: 'À-la-carte add-ons available' },
          ]
        : [
            { yes: true, text: 'Unlimited members & helpers' },
            { yes: true, text: 'History forever' },
            { yes: true, text: 'All 15 modules unlocked' },
            { yes: true, text: 'All add-ons included free' },
            { yes: true, text: 'Priority support from us' },
          ];

  return (
    <ul className="flex flex-col gap-2.5 mb-6 list-none">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2 text-[12.5px] font-bold leading-[1.4]">
          <span
            className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-black mt-0.5 flex-shrink-0"
            style={
              it.yes
                ? variant === 'nest'
                  ? { background: 'rgba(91,184,91,0.13)', color: '#4CAF50' }
                  : { background: 'rgba(212,168,71,0.2)', color: GOLD }
                : variant === 'nest'
                  ? { background: 'rgba(15,31,68,0.06)', color: 'rgba(15,31,68,0.25)' }
                  : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.25)' }
            }
          >
            {it.yes ? '✓' : '✗'}
          </span>
          <span style={{ opacity: it.yes ? 0.88 : 0.3 }}>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

function CtaButton({
  tierId,
  variant,
  isCurrent,
  isBypass,
  hasStripeCustomer,
  busy,
  onCheckout,
  onManage,
}: {
  tierId: SubscriptionTierId;
  variant: 'nest' | 'home' | 'castle';
  isCurrent: boolean;
  isBypass: boolean;
  hasStripeCustomer: boolean;
  busy: SubscriptionTierId | 'portal' | null;
  onCheckout: (tierId: SubscriptionTierId) => void;
  onManage: () => void;
}) {
  const loadingThis = busy === tierId;
  const loadingPortal = busy === 'portal';

  if (isCurrent) {
    // A real paying family (not an operator/founding grant) manages their
    // plan in the Stripe portal. Free Nest and bypass grants have nothing
    // to manage, so they keep the static "current plan" pill.
    if (variant !== 'nest' && hasStripeCustomer && !isBypass) {
      return (
        <button
          onClick={onManage}
          disabled={loadingPortal}
          className="block w-full text-center rounded-2xl text-[13.5px] font-black py-3.5 transition-all disabled:opacity-60"
          style={{ background: 'rgba(255,255,255,0.14)', color: 'white', border: '1px solid rgba(255,255,255,0.28)' }}
        >
          {loadingPortal ? 'Opening…' : 'Manage billing'}
        </button>
      );
    }
    return (
      <button
        disabled
        className="w-full rounded-2xl text-[13.5px] font-black py-3.5 cursor-default"
        style={
          variant === 'nest'
            ? { background: 'rgba(15,31,68,0.06)', color: 'rgba(15,31,68,0.4)' }
            : { background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.65)' }
        }
      >
        ✓ Your current plan
      </button>
    );
  }

  if (variant === 'home') {
    return (
      <button
        onClick={() => onCheckout(tierId)}
        disabled={loadingThis}
        className="block w-full text-center rounded-2xl text-[13.5px] font-black py-3.5 transition-all disabled:opacity-60"
        style={{ background: GOLD, color: NAVY }}
      >
        {loadingThis ? 'Starting…' : 'Upgrade to Home →'}
      </button>
    );
  }

  if (variant === 'castle') {
    return (
      <button
        onClick={() => onCheckout(tierId)}
        disabled={loadingThis}
        className="block w-full text-center rounded-2xl text-[13.5px] font-black py-3.5 transition-all disabled:opacity-60"
        style={{
          background: 'rgba(212,168,71,0.12)',
          color: GOLD,
          border: '1px solid rgba(212,168,71,0.32)',
        }}
      >
        {loadingThis ? 'Starting…' : 'Upgrade to Castle →'}
      </button>
    );
  }

  // Nest CTA (not current) — shown when the family is on a paid tier and
  // viewing the free option. A downgrade is a cancel, handled in the portal.
  return (
    <button
      onClick={onManage}
      disabled={loadingPortal}
      className="block w-full text-center rounded-2xl text-[13.5px] font-black py-3.5 transition-all disabled:opacity-60"
      style={{ background: 'rgba(15,31,68,0.07)', color: NAVY }}
    >
      {loadingPortal ? 'Opening…' : 'Switch to Nest'}
    </button>
  );
}

// ── Compare table parts ────────────────────────────────────────────

function CompareHeader() {
  return (
    <div
      className="grid items-center gap-2 pb-1"
      style={{ gridTemplateColumns: '1fr 90px 90px 90px' }}
    >
      <div />
      <div className="text-center text-[11px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
        Nest
      </div>
      <div className="text-center text-[11px] font-black uppercase tracking-wider" style={{ color: GOLD }}>
        Home
      </div>
      <div className="text-center text-[11px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
        Castle
      </div>
    </div>
  );
}

function CompareRow({
  label,
  sublabel,
  nest,
  home,
  castle,
  last = false,
}: {
  label: string;
  sublabel?: string;
  nest: string;
  home: string;
  castle: string;
  last?: boolean;
}) {
  const cellRender = (val: string, prominent = false) => {
    if (val === 'yes') return <span className="text-[14px]" style={{ color: '#4CAF50' }}>✓</span>;
    if (val === 'no')  return <span className="text-[14px]" style={{ color: 'rgba(15,31,68,0.2)' }}>—</span>;
    if (val.startsWith('Add-on') || val.startsWith('From')) {
      return <span className="text-[10px] font-black" style={{ color: GOLD }}>{val}</span>;
    }
    return (
      <span className="text-[12.5px] font-extrabold" style={{ color: prominent ? GOLD : NAVY }}>
        {val}
      </span>
    );
  };

  return (
    <div
      className="grid items-center gap-2 py-2.5"
      style={{
        gridTemplateColumns: '1fr 90px 90px 90px',
        borderBottom: last ? 'none' : '1px solid rgba(15,31,68,0.05)',
      }}
    >
      <div>
        <div className="text-[12px] font-black" style={{ color: NAVY }}>
          {label}
        </div>
        {sublabel && (
          <div className="text-[11px] font-semibold" style={{ color: MUTED }}>
            {sublabel}
          </div>
        )}
      </div>
      <div className="text-center">{cellRender(nest)}</div>
      <div className="text-center">{cellRender(home, true)}</div>
      <div className="text-center">{cellRender(castle)}</div>
    </div>
  );
}

// ── Redeem code card ───────────────────────────────────────────────
//
// Sits between the storage bar and the hero. Hidden if the user is on
// Castle (no upgrade left to redeem) or in operator/founding bypass.

function RedeemCard({
  onRedeem,
  onSuccess,
}: {
  onRedeem: (code: string) => Promise<{ ok: boolean; message: string }>;
  onSuccess: (msg: string) => void;
}) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const formatted = code.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const valid = isProbablyTierCode(formatted);

  const submit = async () => {
    setSubmitting(true); setErr(null);
    const r = await onRedeem(formatted);
    setSubmitting(false);
    if (r.ok) {
      onSuccess(r.message);
      setCode('');
    } else {
      setErr(r.message);
    }
  };

  return (
    <div className="mb-11 rounded-2xl px-5 py-4" style={{
      background: 'white',
      border: '1.5px solid rgba(15,31,68,0.08)',
      boxShadow: '0 2px 12px rgba(15,31,68,0.04)',
    }}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] font-extrabold tracking-wider uppercase" style={{ color: MUTED }}>
          🎟 Have an upgrade code?
        </div>
        {err && (
          <div className="text-[11px] font-extrabold" style={{ color: '#E85C5C' }}>{err}</div>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={formatted}
          onChange={(e) => { setCode(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && valid && !submitting) submit(); }}
          placeholder="HOME-X4K9B2"
          className="flex-1 bg-[#FBF7EE] border-[1.5px] rounded-xl px-3 py-2.5 outline-none font-mono text-[15px] font-extrabold tracking-widest uppercase"
          style={{ borderColor: 'rgba(15,31,68,0.1)', color: NAVY }}
          maxLength={11}
        />
        <button
          onClick={submit}
          disabled={!valid || submitting}
          className="text-[13px] font-black px-4 rounded-xl disabled:opacity-40"
          style={{ background: GOLD, color: NAVY }}
        >
          {submitting ? '…' : 'Redeem'}
        </button>
      </div>
      <div className="text-[11px] font-semibold mt-1.5" style={{ color: MUTED }}>
        Paste the code we emailed you. It unlocks your new plan instantly.
      </div>
    </div>
  );
}

// ── Storage usage bar ──────────────────────────────────────────────
//
// Sits under the current-plan banner. Hidden while the family doc is
// still loading. Operator/founding bypass renders an "uncapped" pill,
// not a number. Castle gets "Plenty of room" copy on the right side
// so the impression stays "you have plenty" without exposing 50 GB.

function StorageUsageBar({
  tier,
  family,
  isBypass,
  bypassLabel,
}: {
  tier: { id: string; storageGB: number };
  family: Family | null;
  isBypass: boolean;
  bypassLabel: string;
}) {
  if (!family) return null;

  const usedBytes = family.storage?.bytes ?? 0;
  const extraGB = family.storage?.extraGB ?? 0;
  const capBytes = tierCapBytes(tier as never, extraGB);
  const pct = isBypass ? 0 : usagePercent(usedBytes, capBytes);
  const state = usageState(pct);

  // Brand mapping for the 3 states.
  const barColor =
    isBypass ? '#D4A847'
    : state === 'over'     ? '#E85C5C'
    : state === 'warning'  ? '#D4A847'
    :                        '#5BB85B';
  const numColor = isBypass ? '#B8860B'
    : state === 'over'     ? '#E85C5C'
    : state === 'warning'  ? '#B8860B'
    :                        '#6E7791';

  const rightCopy = isBypass
    ? bypassLabel
    : tier.id === 'castle'
      ? 'Plenty of room'
      : `${formatBytes(usedBytes)} of ${formatBytes(capBytes)}`;

  return (
    <div
      className="mb-11 rounded-2xl px-5 py-3.5"
      style={{
        background: 'white',
        border: '1.5px solid rgba(15,31,68,0.08)',
        boxShadow: '0 2px 12px rgba(15,31,68,0.04)',
      }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] font-extrabold tracking-wider uppercase" style={{ color: '#6E7791' }}>
          Storage
        </div>
        <div className="text-[12px] font-extrabold" style={{ color: numColor }}>
          {rightCopy}
        </div>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(15,31,68,0.08)' }}>
        <div
          className="h-full transition-all"
          style={{ width: `${isBypass ? 6 : pct}%`, background: barColor }}
        />
      </div>
      {!isBypass && state === 'warning' && (
        <div className="text-[11px] font-bold mt-2" style={{ color: '#B8860B' }}>
          ⚠ Approaching cap — consider upgrading for more space.
        </div>
      )}
      {!isBypass && state === 'over' && (
        <div className="text-[11px] font-bold mt-2" style={{ color: '#E85C5C' }}>
          🚫 Storage full — uploads are paused. Upgrade or contact us for more space.
        </div>
      )}
    </div>
  );
}
