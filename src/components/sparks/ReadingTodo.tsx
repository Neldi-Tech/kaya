'use client';

// Kaya Sparks · Treasures 2.0 — 📖 the reading loop as a real to-do.
//
// D32 · D33 · mirrors KeeperCheckTodo exactly: mounts on My Day AND the
// Workplan (and the Sparks Today strip as a row), renders NOTHING when
// nothing is due, and clears the moment a page is marked. "📖 Read —
// Percy Jackson p.42 of 375" is a to-do, not a tile; an invite from a
// sibling ("Zuri thinks you'd love Holes") is one too.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchMyReading, type MyReading } from '@/lib/sparks/cupboard';

interface Props {
  kidId: string;
  kidName: string;
  variant?: 'card' | 'row';
}

export default function ReadingTodo({ kidId, kidName, variant = 'card' }: Props) {
  const [m, setM] = useState<MyReading | null>(null);

  useEffect(() => {
    if (!kidId) return;
    let dead = false;
    fetchMyReading(kidId)
      .then((r) => { if (!dead) setM(r); })
      .catch(() => { if (!dead) setM(null); });
    return () => { dead = true; };
  }, [kidId]);

  if (!m) return null;
  const due = m.readings.filter((r) => r.dueToday && r.openToday);
  const invites = m.invites;
  if (due.length === 0 && invites.length === 0) return null;

  if (variant === 'row') {
    return (
      <>
        {due.map((r) => (
          <Link key={r.readingId} href={`/sparks/treasures/cupboard/${r.treasureId}`}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl no-underline border bg-white border-[#E4CDB2]">
            <span className="text-[15px]" aria-hidden>📖</span>
            <span className="text-[12.5px] flex-1 min-w-0 truncate font-bold text-[#0F1F44]">
              Read — {r.name}{r.pages ? ` · p.${r.currentPage} of ${r.pages}` : ''}
            </span>
            <span className="text-[#6E4624] font-bold" aria-hidden>›</span>
          </Link>
        ))}
        {invites.map((i) => (
          <Link key={i.inviteId} href={`/sparks/treasures/cupboard/${i.treasureId}`}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl no-underline border bg-white border-[#E4CDB2]">
            <span className="text-[15px]" aria-hidden>💌</span>
            <span className="text-[12.5px] flex-1 min-w-0 truncate font-bold text-[#0F1F44]">{i.fromName} invited you: {i.name}</span>
            <span className="text-[#6E4624] font-bold" aria-hidden>›</span>
          </Link>
        ))}
      </>
    );
  }

  return (
    <div className="grid gap-2">
      {due.map((r) => (
        <Link key={r.readingId} href={`/sparks/treasures/cupboard/${r.treasureId}`}
          className="block rounded-[18px] border p-4 no-underline transition-colors border-[#E4CDB2] bg-[#F6ECDF] hover:border-[#8B5E34]">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-[13px] grid place-items-center text-lg shrink-0 overflow-hidden" style={{ background: '#fff', color: '#6E4624' }} aria-hidden>
              {r.coverUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={r.coverUrl} alt="" className="w-full h-full object-cover" />
                : '📖'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-extrabold text-[14px] text-[#0F1F44] leading-tight">📖 Read — {r.name}</div>
              <div className="text-[11.5px] text-[#5A6488] mt-0.5 leading-snug">
                {r.pages ? `p.${r.currentPage} of ${r.pages}` : `page ${r.currentPage}`}
                {r.readNo > 1 ? ` · 🔁 read #${r.readNo}` : ''} · a few pages, then two lines about it
              </div>
            </div>
            <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: '#fff', color: '#6E4624' }}>tonight</span>
          </div>
        </Link>
      ))}
      {invites.map((i) => (
        <Link key={i.inviteId} href={`/sparks/treasures/cupboard/${i.treasureId}`}
          className="block rounded-[18px] border p-4 no-underline transition-colors border-[#D9CCFA] bg-[#EFE8FF] hover:border-[#7B5CD6]">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-[13px] grid place-items-center text-lg shrink-0" style={{ background: '#fff' }} aria-hidden>💌</div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-extrabold text-[14px] text-[#0F1F44] leading-tight">{i.fromName} invited {kidName === 'You' ? 'you' : kidName}: {i.name}</div>
              <div className="text-[11.5px] text-[#5A6488] mt-0.5 leading-snug">{i.note ? `“${i.note}” · ` : ''}start reading? · later</div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
