'use client';

// <TierGate moduleId="business">…</TierGate> — wraps a module's content
// and replaces it with a friendly upsell card when the family's tier
// doesn't include access. Operators + founding families bypass.
//
// Lives at the LAYOUT level for each gated module so the entire route
// subtree (children pages, sub-routes) is covered by one gate.

import Link from 'next/link';
import { useTierAccess, moduleMeta } from '@/lib/tierAccess';
import { DEFAULT_ADDONS, type ModuleId } from '@/lib/tiers';

export function TierGate({ moduleId, children }: { moduleId: ModuleId; children: React.ReactNode }) {
  const access = useTierAccess();
  if (access.has(moduleId)) return <>{children}</>;
  return <Upsell moduleId={moduleId} currentTierName={access.tiers[access.tierId].name} />;
}

function Upsell({ moduleId, currentTierName }: { moduleId: ModuleId; currentTierName: string }) {
  const meta = moduleMeta(moduleId);
  const addon = DEFAULT_ADDONS.find((a) => a.moduleId === moduleId);
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-5 py-12 bg-[#FBF7EE]">
      <div className="max-w-md w-full bg-white rounded-[24px] p-8 shadow-[0_24px_60px_rgba(15,31,68,0.08)] border border-[rgba(15,31,68,0.08)] text-center">
        <div
          className="w-16 h-16 rounded-2xl grid place-items-center mx-auto mb-4 text-3xl"
          style={{ background: 'linear-gradient(135deg,#FFF4D6,#FFE8E5)' }}
          aria-hidden
        >
          {meta?.emoji ?? '🔒'}
        </div>
        <h1 className="font-display font-extrabold text-2xl text-[#0F1F44] m-0">
          {meta?.name ?? 'This module'} isn&apos;t in your plan
        </h1>
        <p className="text-[#6E7791] text-[14px] mt-2 leading-relaxed">
          You&apos;re on <b className="text-[#0F1F44]">{currentTierName}</b>. {meta?.description ?? ''}{' '}
          {addon
            ? <>It&apos;s available as a Home add-on (${(addon.priceMonthly / 100).toFixed(0)}/mo) or included in Castle.</>
            : <>Upgrade to Home or Castle to use it.</>}
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <Link
            href="/settings/subscription"
            className="bg-[#D4A847] text-[#0F1F44] px-5 py-3 rounded-xl font-extrabold text-[14px]"
          >
            See plans &amp; upgrade →
          </Link>
          <Link
            href="/home"
            className="text-[#6E7791] font-semibold text-[13px]"
          >
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
