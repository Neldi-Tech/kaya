'use client';

// What-if savings simulator (2026-06-15) — surprise #3. Drag to trim the
// top spending categories and watch projected savings to year-end update
// live, extrapolated from each module's mean monthly spend in the window.

import { useMemo, useState } from 'react';
import { type PurchaseModule, MODULE_EMOJI, MODULE_LABEL } from '@/lib/purchase';
import { formatCents } from '@/components/pantry/format';

export default function WhatIfSimulator({
  averages, modules, currency,
}: {
  averages: Record<string, number>;   // module → mean monthly cents
  modules: PurchaseModule[];
  currency: string;
}) {
  // Top 3 spenders make the most useful levers.
  const levers = useMemo(
    () => [...modules].sort((a, b) => (averages[b] ?? 0) - (averages[a] ?? 0)).slice(0, 3),
    [modules, averages],
  );
  const [trim, setTrim] = useState<Record<string, number>>({});
  const monthsLeft = Math.max(1, 12 - (new Date().getMonth() + 1)); // remaining full months to Dec

  const saved = levers.reduce((a, m) => a + (averages[m] ?? 0) * ((trim[m] ?? 0) / 100), 0) * monthsLeft;

  if (levers.length === 0) return null;
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mt-3">
      <span className="inline-block bg-[#FBE7B0] border border-[#E9C879] text-[#5b4407] font-nunito font-black text-[10px] tracking-wide rounded-full px-2.5 py-1">
        ✨ WHAT-IF SAVINGS SIMULATOR
      </span>
      <p className="text-[12px] text-hive-muted font-bold mt-2">Drag to trim a category — watch savings to December move.</p>

      <div className="mt-3 space-y-3">
        {levers.map((m) => (
          <div key={m} className="flex items-center gap-3">
            <span className="font-nunito font-black text-[12.5px] w-[112px] shrink-0">
              {MODULE_EMOJI[m]} {MODULE_LABEL[m]}
            </span>
            <input
              type="range" min={0} max={25} value={trim[m] ?? 0}
              onChange={(e) => setTrim((p) => ({ ...p, [m]: Number(e.target.value) }))}
              className="flex-1 accent-pantry-leaf-dk"
            />
            <span className="font-nunito font-black text-[12.5px] w-[42px] text-right tabular-nums">{trim[m] ?? 0}%</span>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-hive bg-pantry-leaf-soft border border-pantry-leaf p-3 text-center">
        <p className="text-[11px] text-pantry-leaf-dk font-bold uppercase tracking-wide">Projected extra saved by Dec</p>
        <p className="font-nunito font-black text-2xl text-pantry-leaf-dk mt-0.5">{formatCents(Math.round(saved), currency)}</p>
        <p className="text-[11px] text-hive-muted font-bold mt-0.5">
          {saved <= 0 ? 'Move a slider to model a gentle trim.' : `Across the ${monthsLeft} month${monthsLeft === 1 ? '' : 's'} left this year, on your current run-rate.`}
        </p>
      </div>
    </div>
  );
}
