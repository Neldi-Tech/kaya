'use client';

// Slice 8k · 🚪 the knock finds the kid on My Day too — a todo row per
// pending knock (who · which page · optional note · waiting time) that
// links straight to the diary banner. Meta only, never page content.
// Renders nothing when there are no open knocks (or for non-kids).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPendingKnocks } from '@/lib/sparks/diary';
import { toDisplayDate } from '@/lib/dates';

interface KnockRow { entryId: string; date: string; byName: string; note: string; at: number | null }

function waitingLabel(at: number | null): string {
  if (!at) return '';
  const h = Math.floor((Date.now() - at) / 3600000);
  if (h < 1) return 'just now';
  if (h < 48) return `waiting ${h}h`;
  return `waiting ${Math.floor(h / 24)}d`;
}

export default function KnockTodoCard({ familyId, kidId, className }: {
  familyId: string;
  kidId: string;
  className?: string;
}) {
  const [knocks, setKnocks] = useState<KnockRow[]>([]);

  useEffect(() => {
    if (!familyId || !kidId) return;
    let cancelled = false;
    const refetch = () => {
      getPendingKnocks(kidId)
        .then((rows) => { if (!cancelled) setKnocks(rows); })
        .catch(() => { if (!cancelled) setKnocks([]); });
    };
    refetch();
    // Refresh every couple of minutes — a knock answered on another
    // device (or in the diary tab) clears the todo without a reload.
    const t = setInterval(refetch, 120000);
    return () => { cancelled = true; clearInterval(t); };
  }, [familyId, kidId]);

  if (knocks.length === 0) return null;

  return (
    <div className={className}>
      <div className="rounded-2xl border-2 border-[#EBC2DC] bg-[#FDF3F9] p-3.5">
        <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-[#7A2E5C] mb-2">
          🚪 Knocks waiting for you
        </div>
        <div className="space-y-2">
          {knocks.map((k) => (
            <Link key={k.entryId} href={`/sparks/${kidId}/diary`}
              className="flex items-start gap-2.5 rounded-xl bg-white border border-[#EBC2DC] px-3 py-2.5 no-underline">
              <span className="w-2.5 h-2.5 mt-1.5 rounded-full flex-none" style={{ background: '#C05299' }} aria-hidden />
              <span className="text-[12.5px] text-[#0F1F44] leading-snug">
                <b>Answer {k.byName}&apos;s knock</b> 🚪
                <span className="text-[#5A6488]"> · {toDisplayDate(k.date)} page{k.at ? ` · ${waitingLabel(k.at)}` : ''}</span>
                {k.note && <span className="block text-[11.5px] text-[#7A2E5C] font-bold mt-0.5">&ldquo;{k.note}&rdquo;</span>}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
