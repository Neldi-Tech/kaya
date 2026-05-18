'use client';

// /pantry/browse/others — Others hub.
//
// Four tiles, one per non-Pantry module. Each previews its category
// structure in the subtitle so the user knows what they're walking
// into. v0 routes each tile to the module's existing surface
// (catalogue or list); dedicated per-module catalogue pages with
// category grouping land as those modules grow inventory worth
// browsing offline.

import Link from 'next/link';
import { usePantry } from '@/contexts/PantryContext';

interface OthersTile {
  href: string;
  emoji: string;
  label: string;
  categories: string;
  count: (ctx: { staples: { module?: string }[]; utilities: { category?: string }[] }) => string;
  tint: string;
  border: string;
  accent: string;
}

const TILES: OthersTile[] = [
  {
    href: '/pantry/outdoor',
    emoji: '🌿',
    label: 'Outdoor',
    categories: 'Garden · Pool · Kuku · Pets · Repairs',
    count: ({ staples }) => {
      const n = staples.filter((s) => s.module === 'outdoor').length;
      return `${n} item${n === 1 ? '' : 's'} · 5 categories`;
    },
    tint: 'bg-pantry-leaf-soft',
    border: 'border-pantry-leaf',
    accent: 'text-pantry-leaf-dk',
  },
  {
    href: '/pantry/utilities',
    emoji: '⚡',
    label: 'Utility',
    categories: 'Electricity · Water · Internet · Gas · TV · Security · Rent',
    count: ({ utilities }) => {
      const n = utilities.filter((u) => u.category !== 'salary').length;
      return `${n} bill${n === 1 ? '' : 's'} · 7 categories`;
    },
    tint: 'bg-[#FFF3D9]',
    border: 'border-hive-honey',
    accent: 'text-hive-honey-dk',
  },
  {
    href: '/pantry/drivers',
    emoji: '🚗',
    label: 'Drivers',
    categories: 'Fuel · Service · Parts · Wash · Tolls',
    count: ({ staples }) => {
      const n = staples.filter((s) => s.module === 'drivers').length;
      return `${n} item${n === 1 ? '' : 's'} · 5 categories`;
    },
    tint: 'bg-[#E5EFF8]',
    border: 'border-[#B5CFE5]',
    accent: 'text-hive-blue',
  },
  {
    href: '/pantry/payroll',
    emoji: '🤝',
    label: 'Payroll',
    categories: 'Advance · Loan · Bonus · Reimbursement',
    count: () => '4 categories',
    tint: 'bg-[#F4EFFB]',
    border: 'border-[#C9B8E5]',
    accent: 'text-[#5E4A8F]',
  },
];

export default function OthersHubPage() {
  const { staples, utilities } = usePantry();
  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">
          Browse · Others
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          Pick a catalogue
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          Four less-frequent surfaces, grouped by module. Subtitle previews each module's categories.
        </p>
        <Link href="/pantry/browse" className="text-[12px] text-pantry-leaf-dk font-bold no-underline hover:underline mt-2 inline-block">
          ← Back to Browse
        </Link>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`block rounded-hive p-4 border no-underline text-inherit ${t.tint} ${t.border} hover:shadow-md transition-shadow`}
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/70 flex items-center justify-center text-2xl flex-shrink-0">
                {t.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-nunito font-black text-[18px] text-hive-ink">{t.label}</div>
                <div className="text-[11px] text-hive-muted font-bold mt-0.5">{t.categories}</div>
              </div>
              <span className="text-hive-muted text-xl flex-shrink-0">›</span>
            </div>
            <div className={`text-[11px] font-nunito font-extrabold mt-2 ${t.accent}`}>
              {t.count({ staples, utilities })}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
