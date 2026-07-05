'use client';

// /pantry/setup — Household Setup hub (Drivers v2 / Screen E, 2026-07-05).
//
// ONE gear, everything: every Household module configures from here so
// parents stop hunting through scattered surfaces (/pantry/budget caps,
// /pantry/utility-meters, Manage vehicles, the guardrails card…). Each
// row deep-links into the existing management page — old routes keep
// working; this hub is the front door. Future modules (Kaya Plus
// thresholds…) get a row here too.
//
// The Units & formats card lives INLINE (family-wide distance km/mi +
// fuel volume L/gal). Storage stays canonical; display converts —
// history is never rewritten.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { subscribeToVehicles } from '@/lib/vehicles';
import { subscribeToMeters } from '@/lib/utilityMeters';
import { readPurchaseConfig, readDriversConfig } from '@/lib/purchase';
import {
  readFamilyUnits, setFamilyUnits,
  type DistanceUnit, type FuelVolumeUnit,
} from '@/lib/units';

export default function HouseholdSetupHub() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();

  const [vehicleCount, setVehicleCount] = useState<number | null>(null);
  const [meterCount, setMeterCount] = useState<number | null>(null);
  const [savingUnits, setSavingUnits] = useState(false);

  // Parent-only — same guard pattern as /pantry/utility/setup.
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry');
  }, [profile, router]);

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    const a = subscribeToVehicles(profile.familyId, (v) => setVehicleCount(v.filter((x) => x.active).length));
    const b = subscribeToMeters(profile.familyId, (m) => setMeterCount(m.length));
    return () => { a(); b(); };
  }, [profile?.familyId, profile?.role]);

  if (profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg">Household Setup is parent-only</h2>
        <p className="text-hive-muted text-sm mt-2 mb-4">
          Helpers work inside the modules parents have set up here.
        </p>
        <Link href="/pantry" className="text-pantry-leaf-dk font-nunito font-bold text-sm underline">
          ← Back to Household
        </Link>
      </div>
    );
  }

  const units = readFamilyUnits(family);
  const purchaseCfg = readPurchaseConfig(family);
  const driversCfg = readDriversConfig(family);
  const approvalLabel = (family?.approvalModes?.pantry ?? family?.approvalMode ?? 'either') === 'both'
    ? 'Both parents approve'
    : 'Either parent approves';

  const pickUnit = async (patch: { distance?: DistanceUnit; fuelVolume?: FuelVolumeUnit }) => {
    if (!profile?.familyId || savingUnits) return;
    setSavingUnits(true);
    try {
      await setFamilyUnits(profile.familyId, { ...readFamilyUnits(family), ...patch });
    } finally { setSavingUnits(false); }
  };

  const rows: {
    href: string; emoji: string; title: string; sub: string;
  }[] = [
    { href: '/pantry/budget', emoji: '💰', title: 'Budgets & caps', sub: 'Per-module monthly caps' },
    {
      href: '/pantry/setup/vehicles', emoji: '🚗', title: 'Vehicles & service',
      sub: `${vehicleCount ?? '…'} vehicle${vehicleCount === 1 ? '' : 's'} · intervals · reminders · odometer rule`,
    },
    {
      href: '/pantry/utility-meters', emoji: '⚡', title: 'Utility meters',
      sub: `${meterCount ?? '…'} meter${meterCount === 1 ? '' : 's'} · price per unit`,
    },
    {
      href: '/pantry/purchase', emoji: '🛡️', title: 'Purchase guardrails',
      sub: `Price band ±${purchaseCfg.maxPriceChangePct}% · odometer ${driversCfg.odometerMandatoryForHelpers ? 'required' : 'optional'} for drivers`,
    },
    { href: '/settings', emoji: '✅', title: 'Approval mode', sub: approvalLabel },
  ];

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <Link href="/pantry" className="text-pantry-leaf-dk font-nunito font-extrabold text-xs">
        ← Household
      </Link>
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk mt-3">
        Household
      </p>
      <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
        ⚙️ Setup
      </h1>
      <p className="text-hive-muted text-sm mt-1 mb-4">
        Everything in one place. Parents only.
      </p>

      <div className="bg-hive-paper border border-hive-line rounded-hive overflow-hidden mb-3">
        {rows.map((r, i) => (
          <Link
            key={r.href}
            href={r.href}
            className={`flex items-center gap-3 px-4 py-3.5 no-underline hover:bg-hive-cream ${
              i > 0 ? 'border-t border-hive-line' : ''
            }`}
          >
            <span className="text-[22px] flex-shrink-0">{r.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-nunito font-extrabold text-[15px] text-hive-navy">{r.title}</span>
              <span className="block text-[12px] text-hive-muted font-bold truncate">{r.sub}</span>
            </span>
            <span className="text-hive-muted font-nunito font-black flex-shrink-0">›</span>
          </Link>
        ))}
      </div>

      {/* Units & formats — inline, per the approved Screen E. */}
      <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">
          📏 Units & formats
        </p>
        <div className="flex items-center justify-between py-1.5">
          <span className="font-nunito font-extrabold text-sm">Distance</span>
          <div className="flex bg-hive-cream rounded-full p-0.5">
            {(['km', 'mi'] as DistanceUnit[]).map((u) => (
              <button
                key={u}
                type="button"
                disabled={savingUnits}
                onClick={() => pickUnit({ distance: u })}
                className={`px-4 py-1.5 rounded-full text-[13px] font-nunito font-extrabold ${
                  units.distance === u ? 'bg-white shadow text-hive-navy' : 'text-hive-muted'
                }`}
              >
                {u === 'km' ? 'km' : 'miles'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <span className="font-nunito font-extrabold text-sm">Fuel volume</span>
          <div className="flex bg-hive-cream rounded-full p-0.5">
            {(['L', 'gal'] as FuelVolumeUnit[]).map((u) => (
              <button
                key={u}
                type="button"
                disabled={savingUnits}
                onClick={() => pickUnit({ fuelVolume: u })}
                className={`px-4 py-1.5 rounded-full text-[13px] font-nunito font-extrabold ${
                  units.fuelVolume === u ? 'bg-white shadow text-hive-navy' : 'text-hive-muted'
                }`}
              >
                {u === 'L' ? 'litres' : 'gallons'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-hive-muted font-bold mt-2">
          Family-wide. Changes relabel every screen, reminder and report — history is stored
          raw and converted on display.
        </p>
      </div>
    </div>
  );
}
