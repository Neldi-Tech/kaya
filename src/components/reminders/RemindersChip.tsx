'use client';

// Home chip for Kaya Reminders (R1 PR B). A compact tappable card that lands
// on Home surfacing the next reminder + a count → /reminders. Renders nothing
// when there's nothing today or upcoming (no empty spacing). Used in both the
// mobile and desktop Home layouts, right after the BirthdayHero.

import Link from 'next/link';
import { useReminders } from './useReminders';
import { typeMeta, relativeDays } from '@/lib/reminders';

const CAL = '#5B6CC8';
const CAL_DK = '#3E4DA0';
const CAL_SOFT = '#E7EAFA';

export default function RemindersChip({ className = '' }: { className?: string }) {
  const { loading, todays, upcoming } = useReminders(30);
  if (loading) return null;
  const next = todays[0] || upcoming[0];
  if (!next) return null;

  const total = todays.length + upcoming.length;
  const meta = typeMeta(next.event.type);

  return (
    <Link
      href="/reminders"
      className={`flex items-center gap-3 rounded-kaya border bg-white px-4 py-3 ${className}`}
      style={{ borderColor: CAL }}
    >
      <span className="w-10 h-10 rounded-kaya-sm flex items-center justify-center text-xl shrink-0" style={{ background: CAL_SOFT }}>📅</span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: CAL_DK }}>
          Reminders · {total} coming up
        </div>
        <div className="text-sm font-bold text-kaya-chocolate truncate">
          {meta.icon} {next.event.title}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-extrabold" style={{ color: CAL_DK }}>{relativeDays(next.daysAway, next.dateKey)}</div>
        <div className="text-[10px] text-kaya-sand">View →</div>
      </div>
    </Link>
  );
}
