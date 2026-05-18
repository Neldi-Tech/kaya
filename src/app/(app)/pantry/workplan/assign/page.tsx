'use client';

// /pantry/workplan/assign — Assign Work form.
//
// v4-final Step 6 ships this as a coming-soon stub. Step 7 builds the
// actual form (4 fields per the v4-final §04 Phone 2 mock: who · what ·
// when · period) + the WorkplanItem schema extension for ad-hoc tasks.

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

export default function AssignWorkPage() {
  const { profile } = useAuth();
  const isParent = profile?.role === 'parent';
  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">
          Workplan · Assign one-off
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          Quick assign
        </h1>
      </div>

      <div className="bg-[#FFF3D9] border border-hive-honey rounded-hive p-6 mt-4 text-center">
        <div className="text-3xl mb-2">🛠️</div>
        <h3 className="font-nunito font-black text-lg text-hive-ink">Form lands next</h3>
        <p className="text-hive-ink text-sm mt-2 mb-4 leading-relaxed">
          {isParent
            ? <>Step 7 of the Household v4 rollout ships the four-field form (who · what · when · period) + the WorkplanItem schema extension + push-notify on assign. This route is here so the "<strong>＋ Assign one-off work</strong>" CTA from <Link href="/pantry/workplan" className="text-hive-honey-dk underline">Workplan home</Link> already has a destination.</>
            : <>This surface is parent-only — they assign ad-hoc work to helpers from here. Your end-of-day workplan lives on the helper home.</>}
        </p>
        <Link
          href="/pantry/workplan"
          className="inline-block text-[12px] font-nunito font-bold text-hive-honey-dk underline"
        >
          ← Back to Workplan
        </Link>
      </div>
    </div>
  );
}
