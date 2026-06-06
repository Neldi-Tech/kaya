'use client';

// /pantry/utility/setup — Utilities setup hub (Utilities v2, 2026-05-20).
//
// The single, clear entry point for configuring utilities. Replaces the
// confusion of two separate config routes (/pantry/utilities for
// recurring bills + /pantry/utility-meters for meters) by framing them
// as TWO CATEGORIES with plain-English explainers:
//
//   🔁 Recurring bills  — fixed amount + fixed date. Kaya auto-creates
//                         the payment request + emails you. Parent-managed.
//   🔌 Regular top-ups  — variable amount the helper buys on a frequency
//                         (power LUKU, water, gas). Helper-requested.
//
// Each card deep-links into the existing management page (which now wears
// a matching category banner + a back-link here). Parent-only.

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import BillsActivity from '@/components/pantry/BillsActivity';

export default function UtilitySetupHub() {
  const router = useRouter();
  const { profile } = useAuth();
  const { config } = useHive();

  // Parent-only — same policy as the two config pages it fronts.
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry/utility');
  }, [profile, router]);

  if (profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg">Utility setup is parent-only</h2>
        <p className="text-hive-muted text-sm mt-2 mb-4">
          Helpers request top-ups against the utilities parents have set up.
        </p>
        <Link href="/pantry/utility" className="text-hive-honey-dk font-nunito font-bold text-sm underline">
          ← Back to Utility
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <Link href="/pantry/utility" className="text-hive-honey-dk font-nunito font-extrabold text-xs">
        ← Back to Utility
      </Link>
      <h1 className="font-nunito font-black text-2xl lg:text-3xl tracking-tight mt-2">
        ⚙ Set up utilities
      </h1>
      <p className="text-hive-muted text-sm mt-1">
        Two kinds of utility. Pick which one you're adding — the difference is who pays and when.
      </p>

      {/* Recurring bills card */}
      <Link
        href="/pantry/utilities"
        className="block mt-4 rounded-hive border-2 border-hive-honey bg-[#FFF3D9] p-4 no-underline"
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔁</span>
          <span className="font-nunito font-black text-lg text-hive-honey-dk">Recurring bills</span>
          <span className="ml-auto font-nunito font-black text-hive-honey-dk text-lg">→</span>
        </div>
        <p className="text-[13px] text-hive-ink mt-1.5 leading-snug">
          Fixed amount, fixed date — rent, internet, insurance, school fees.
          Kaya creates the payment request automatically and emails you to pay.
        </p>
        <p className="text-[11px] font-nunito font-extrabold text-hive-honey-dk uppercase tracking-[1px] mt-2">
          You manage these
        </p>
      </Link>

      {/* Regular top-ups card */}
      <Link
        href="/pantry/utility-meters"
        className="block mt-3 rounded-hive border-2 border-pantry-leaf bg-[#E6F2EC] p-4 no-underline"
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔌</span>
          <span className="font-nunito font-black text-lg text-pantry-leaf-dk">Regular top-ups</span>
          <span className="ml-auto font-nunito font-black text-pantry-leaf-dk text-lg">→</span>
        </div>
        <p className="text-[13px] text-hive-ink mt-1.5 leading-snug">
          Variable amount the helper buys as they run low — power LUKU, water,
          gas, airtime. You set how often; the helper requests each top-up.
        </p>
        <p className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk uppercase tracking-[1px] mt-2">
          Helpers request these
        </p>
      </Link>

      {/* Quick reference on the difference */}
      <div className="mt-5 bg-hive-paper border border-hive-line rounded-hive p-4">
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">
          Which one?
        </p>
        <div className="space-y-2 text-[12px] text-hive-ink">
          <div className="flex gap-2">
            <span className="font-nunito font-black w-20 flex-shrink-0 text-hive-honey-dk">Recurring</span>
            <span className="text-hive-muted">Same amount every period, due on a date. Kaya reminds + auto-requests.</span>
          </div>
          <div className="flex gap-2">
            <span className="font-nunito font-black w-20 flex-shrink-0 text-pantry-leaf-dk">Top-ups</span>
            <span className="text-hive-muted">Amount changes each time. Helper buys when low, you set the rhythm.</span>
          </div>
        </div>
      </div>

      {/* Bills activity — sent register + reminder-engine status */}
      {profile?.familyId && (
        <BillsActivity familyId={profile.familyId} byUid={profile.uid} currency={config.currency} isParent />
      )}
    </div>
  );
}
