'use client';

// /pantry/browse — Browse Catalogue landing.
//
// Per v3 design (Decision A, 2026-05-18): two top-level doors —
// Pantry (the heavy daily-use catalogue) and Others (the hub for the
// four less-frequent module catalogues: Outdoor / Utility / Drivers /
// Payroll). Each tile previews how many items / sub-categories live
// inside so the user previews the depth before tapping in.

import Link from 'next/link';
import { usePantry } from '@/contexts/PantryContext';

export default function BrowseLandingPage() {
  const { staples, utilities } = usePantry();
  const pantryCount = staples.filter((s) => (s.module ?? 'pantry') === 'pantry').length;
  // Others count = anything not pantry, summed across modules + utilities catalogue.
  const outdoorCount = staples.filter((s) => s.module === 'outdoor').length;
  const driversCount = staples.filter((s) => s.module === 'drivers').length;
  const utilityCount = utilities.filter((u) => u.category !== 'salary').length;
  const othersCount = outdoorCount + driversCount + utilityCount;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Household · Browse Catalogue
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          What are you picking from?
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          Pantry for kitchen items · Others for outdoor, utilities, drivers, payroll.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <Link
          href="/pantry/browse/pantry"
          className="block bg-gradient-to-br from-pantry-leaf-soft to-hive-paper border border-pantry-leaf rounded-hive-lg p-5 no-underline text-inherit hover:border-pantry-leaf-dk transition-colors"
        >
          <div className="text-4xl leading-none mb-2">🛒</div>
          <div className="font-nunito font-black text-2xl text-hive-ink">Pantry</div>
          <div className="text-[13px] text-hive-navy mt-1 font-bold">Groceries · staples · meal essentials</div>
          <div className="text-[11px] text-pantry-leaf-dk font-extrabold mt-3">
            {pantryCount} item{pantryCount === 1 ? '' : 's'} · 5 categories
          </div>
        </Link>
        <Link
          href="/pantry/browse/others"
          className="block bg-gradient-to-br from-[#FFF3D9] to-hive-paper border border-hive-honey rounded-hive-lg p-5 no-underline text-inherit hover:border-hive-honey-dk transition-colors"
        >
          <div className="text-4xl leading-none mb-2">📂</div>
          <div className="font-nunito font-black text-2xl text-hive-ink">Others</div>
          <div className="text-[13px] text-hive-navy mt-1 font-bold">Outdoor · Utility · Drivers · Payroll</div>
          <div className="text-[11px] text-hive-honey-dk font-extrabold mt-3">
            {othersCount} item{othersCount === 1 ? '' : 's'} across 4 modules
          </div>
        </Link>
      </div>
    </div>
  );
}
