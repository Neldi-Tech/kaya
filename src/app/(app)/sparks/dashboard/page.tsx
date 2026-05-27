'use client';

// Kaya Sparks · family-wide dashboard (/sparks/dashboard).
//
// Slice 5b (2026-05-27) — the family roll-up. One row per kid:
// avatar + name + Avg ⭐ + Avg % + items captured + top area + tap to
// open that kid's full dashboard. Parent-only; gated by
// features.familyRollup (Home+); Nest shows an inline upgrade tile.
//
// Reads per-kid streams concurrently. Closes them on unmount.

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useSparksFeatures } from '@/lib/sparks/gating';
import {
  subscribeToAllKidItems, subscribeToKidRatings,
} from '@/lib/sparks/firestore';
import {
  computeKpis, FILTER_LABELS, filterByDate, type SparksFilter,
} from '@/lib/sparks/dashboard';
import { SPARKS_AREA_META, type SparksItem, type SparksRating } from '@/lib/sparks/schema';
import KidAvatar from '@/components/ui/KidAvatar';
import type { Child } from '@/lib/firestore';

const FILTERS: Array<Exclude<SparksFilter, object>> = ['week', 'month', 'term', 'year', 'all'];

export default function FamilySparksDashboardPage() {
  const { profile } = useAuth();
  const { children } = useFamily();
  const router = useRouter();
  const features = useSparksFeatures();

  const familyId = profile?.familyId;
  const isParent = profile?.role === 'parent';

  useEffect(() => {
    if (profile && profile.role !== 'parent') router.replace('/sparks');
  }, [profile, router]);

  const [filter, setFilter] = useState<SparksFilter>('month');

  if (!isParent || !familyId) {
    return <div className="min-h-screen bg-[#FBF7EE] grid place-items-center text-[#5A6488] text-sm">Loading…</div>;
  }

  return (
    <div className="min-h-[80vh] bg-[#FBF7EE] text-[#0F1F44]">
      <div className="mx-auto max-w-md sm:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-5 lg:px-10 pt-6 pb-16">
        <Link
          href="/sparks"
          className="inline-flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full bg-white border border-[rgba(15,31,68,0.08)] text-[#0F1F44] font-display font-extrabold text-[12px] no-underline hover:border-[#D4A847] transition-colors mb-4"
        >
          <span className="text-[13px] leading-none opacity-60" aria-hidden>‹</span>
          <span>Sparks home</span>
        </Link>

        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-3xl" aria-hidden>👨‍👩‍👧‍👦</span>
          <h1 className="font-display font-extrabold text-2xl lg:text-3xl tracking-tight m-0">
            Family roll-up
          </h1>
        </div>
        <p className="text-[#5A6488] text-[13.5px] mt-1 mb-5 max-w-prose">
          Every child side by side — Avg ⭐, Avg %, items captured, top area. Tap any kid to open their full dashboard.
        </p>

        {!features.familyRollup ? (
          <UpgradeTile />
        ) : children.length === 0 ? (
          <div className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-6 text-center">
            <p className="text-[14px] text-[#0F1F44] font-medium">No kids on this family yet.</p>
            <Link href="/settings" className="inline-block mt-3 text-[#D4A847] font-bold text-[13px]">
              Add a child in Settings →
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              {FILTERS.map((f) => {
                const active = filter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-bold transition-colors ${
                      active
                        ? 'bg-[#0F1F44] text-white'
                        : 'bg-white border border-[rgba(15,31,68,0.08)] text-[#0F1F44] hover:border-[#D4A847]'
                    }`}
                  >
                    {FILTER_LABELS[f]}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {children.map((kid) => (
                <KidRollupCard
                  key={kid.id}
                  familyId={familyId}
                  kid={kid}
                  filter={filter}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Per-kid roll-up card ────────────────────────────────────────────

function KidRollupCard({
  familyId, kid, filter,
}: {
  familyId: string;
  kid: Child;
  filter: SparksFilter;
}) {
  const [items, setItems] = useState<SparksItem[]>([]);
  const [ratings, setRatings] = useState<SparksRating[]>([]);

  useEffect(() => subscribeToAllKidItems(familyId, kid.id, setItems), [familyId, kid.id]);
  useEffect(() => subscribeToKidRatings(familyId, kid.id, setRatings), [familyId, kid.id]);

  const itemsF = useMemo(() => filterByDate(items, filter), [items, filter]);
  const ratingsF = useMemo(() => filterByDate(ratings, filter), [ratings, filter]);
  const kpis = useMemo(() => computeKpis(itemsF, ratingsF), [itemsF, ratingsF]);

  const stars = kpis.ratingAgg.avgStars;
  const pct = kpis.ratingAgg.avgPercent;

  return (
    <Link
      href={`/sparks/${kid.id}/dashboard`}
      className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-4 hover:border-[#D4A847] hover:shadow-[0_8px_24px_rgba(15,31,68,0.06)] transition-all no-underline"
    >
      <div className="flex items-center gap-3 mb-3">
        <KidAvatar child={kid} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="font-display font-extrabold text-[15px] text-[#0F1F44] truncate">{kid.name}</div>
          <div className="text-[11px] text-[#5A6488] mt-0.5">
            {kid.houseName ? `${kid.houseName} House` : 'Kaya family'}
          </div>
        </div>
        <span className="text-[#D4A847] font-bold text-lg" aria-hidden>→</span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Mini label="Avg ⭐" value={stars !== null ? stars.toFixed(1) : '—'} bg="#FFF1C9" fg="#8A6800" />
        <Mini label="Avg %"  value={pct   !== null ? `${pct}%`        : '—'} bg="#E5D6FF" fg="#5A3CB8" />
        <Mini label="Items"  value={String(kpis.totalItems)} bg="#FFE7E0" fg="#E85C5C" />
        <Mini
          label="Top"
          value={kpis.topArea ? SPARKS_AREA_META[kpis.topArea].emoji : '—'}
          title={kpis.topArea ? SPARKS_AREA_META[kpis.topArea].shortLabel : 'No top area yet'}
          bg="#DDF5DF"
          fg="#2E7D34"
        />
      </div>

      {kpis.starStreakDays > 0 && (
        <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-extrabold text-[#1E7873] bg-[#C9F0EC] rounded-full px-2.5 py-1">
          🔥 {kpis.starStreakDays}-day ⭐ streak
        </div>
      )}
    </Link>
  );
}

function Mini({ label, value, bg, fg, title }: { label: string; value: string; bg: string; fg: string; title?: string }) {
  return (
    <div className="text-center rounded-xl py-1.5" style={{ background: bg }} title={title}>
      <div className="text-[9px] font-extrabold uppercase tracking-[0.6px]" style={{ color: fg, opacity: 0.7 }}>{label}</div>
      <div className="font-display font-extrabold text-[15px] mt-0.5" style={{ color: fg }}>{value}</div>
    </div>
  );
}

function UpgradeTile() {
  return (
    <div className="bg-[#FFF4D6] border border-[#D4A847]/40 rounded-2xl p-6 text-center">
      <div className="text-3xl mb-2" aria-hidden>🏠</div>
      <div className="font-display font-extrabold text-[15px] text-[#0F1F44]">
        Family roll-up is a Kaya Home feature
      </div>
      <p className="text-[12.5px] text-[#5A6488] mt-1 mb-4 max-w-md mx-auto leading-snug">
        See every kid&apos;s Sparks side by side — compare ⭐ + % across the family, spot the kid who needs a check-in this week.
      </p>
      <Link
        href="/settings/subscription"
        className="inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px] no-underline"
        style={{ background: '#D4A847', color: '#0F1F44' }}
      >
        See plans + upgrade →
      </Link>
    </div>
  );
}
