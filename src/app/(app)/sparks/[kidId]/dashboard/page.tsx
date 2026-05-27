'use client';

// Kaya Sparks · per-kid progress dashboard (/sparks/[kidId]/dashboard).
// Slice 1 stub — the full dashboard (KPI cards, 10-week trend bars,
// category breakdown, AI insights panel, family roll-up, PDF export)
// lands with Slice 5.
//
// Parent-only by route guard. Kids landing here bounce back to their
// Sparks home. Helpers see the same bounce — the dashboard is family-
// privacy-sensitive.

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';

export default function KidSparksDashboardStubPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId;
  const { profile } = useAuth();
  const { children } = useFamily();
  const router = useRouter();

  useEffect(() => {
    if (profile?.role !== 'parent') router.replace(`/sparks/${kidId ?? ''}`);
  }, [profile?.role, kidId, router]);

  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  return (
    <div className="min-h-[80vh] bg-[#FBF7EE] text-[#0F1F44]">
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-10 pb-16">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl" aria-hidden>📊</span>
          <h1 className="font-display font-extrabold text-2xl tracking-tight m-0">
            {kid?.name ?? 'Kid'}&apos;s progress
          </h1>
        </div>
        <p className="text-[#6E7791] text-[14px] max-w-prose mb-8">
          The progress dashboard — KPI cards, 10-week trend chart,
          category breakdown, AI insights, family roll-up, term PDF
          export — lands with Slice 5. Slice 1 wires the data model
          and rules so ratings start accumulating the moment Slice 3
          ships.
        </p>

        <div className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-6">
          <div className="font-display font-extrabold text-[14px] text-[#0F1F44]">What lands here</div>
          <ul className="m-0 mt-2 pl-5 text-[12.5px] text-[#6E7791] leading-relaxed">
            <li>Average rating (⭐ and %) · tasks done vs assigned · streak · top area</li>
            <li>10-week trend bar chart (coral → green gradient)</li>
            <li>Category breakdown bars per area</li>
            <li>AI Insights panel · Strength / Watch / Trend / Suggest</li>
            <li>Time filters · Week / Month / Term / Year / All-time / Custom</li>
            <li>Family roll-up tab (parent-only, Home+)</li>
            <li>Term PDF export for PTM</li>
          </ul>
        </div>

        <div className="mt-10 pt-6 border-t border-[rgba(15,31,68,0.08)]">
          <Link
            href={`/sparks/${kidId ?? ''}`}
            className="text-[#D4A847] font-bold text-[13px] no-underline"
          >
            ← Back to {kid?.name ?? 'Sparks'}
          </Link>
        </div>
      </div>
    </div>
  );
}
