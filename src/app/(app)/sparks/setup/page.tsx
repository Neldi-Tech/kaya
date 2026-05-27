'use client';

// Kaya Sparks · parent setup (/sparks/setup). Slice 1 stub — the real
// surface lands across Slice 2 (sibling visibility + subjects per kid)
// and Slice 3 (workplan wiring toggles + AI per-kid switches).
//
// Parent-only by route guard. Kids landing here bounce back to /sparks.

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function SparksSetupPage() {
  const { profile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (profile?.role === 'kid') router.replace('/sparks');
  }, [profile?.role, router]);

  return (
    <div className="min-h-[80vh] bg-[#FBF7EE] text-[#0F1F44]">
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-10 pb-16">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl" aria-hidden>⚙️</span>
          <h1 className="font-display font-extrabold text-2xl tracking-tight m-0">Sparks Setup</h1>
        </div>
        <p className="text-[#6E7791] text-[14px] max-w-prose mb-8">
          The control panel for sibling visibility, per-kid subjects, AI
          highlight toggles, and workplan wiring lands across the next
          two slices.
        </p>

        <Section
          title="Slice 2"
          when="Capture + sibling visibility"
          items={[
            'Per-kid subjects list (drives school project + academic dropdowns)',
            'Sibling visibility · Open / Independent / Per-area (server-enforced)',
            'Bulk import + AI auto-label past artwork & certificates',
          ]}
        />
        <Section
          title="Slice 3"
          when="Workplan wiring + ratings"
          items={[
            'Rating method picker — ⭐ / % / Both / Custom per task',
            'Photo-proof required toggle, with kid → parent review flow',
            'Opt-in workplan wiring per task',
          ]}
        />
        <Section
          title="Slice 4"
          when="AI per-task-type"
          items={[
            'Pre-submission highlights · handwriting / homework / art (per kid)',
            'Vendor selection (Claude vs Vertex Vision) confirmed before merge',
          ]}
        />

        <div className="mt-10 pt-6 border-t border-[rgba(15,31,68,0.08)]">
          <Link
            href="/sparks"
            className="text-[#D4A847] font-bold text-[13px] no-underline"
          >
            ← Back to Sparks
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({ title, when, items }: { title: string; when: string; items: string[] }) {
  return (
    <div className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-5 mb-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-display font-extrabold text-[14.5px] text-[#0F1F44]">{when}</div>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FFF4D6] text-[#9C7A1D]">
          {title}
        </span>
      </div>
      <ul className="m-0 pl-5 text-[12.5px] text-[#6E7791] leading-relaxed">
        {items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
