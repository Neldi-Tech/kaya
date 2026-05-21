// DayStepper — the Workplan page's day navigator (2026-05-21).
//
// Replaces the static "Today · N helper" heading so a parent or helper
// can step back to Yesterday (what was planned + what got done) or
// ahead to Tomorrow and beyond (the upcoming plan). Arrows walk ±1 day
// with no limit; quick chips cover the common hops; a green "↩ Today"
// chip snaps home whenever you've wandered off.
//
// All day math is LOCAL time (matches the helper's phone clock) so the
// stepper is correct for Kaya helpers in any timezone worldwide.
'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toDisplayDate } from '@/lib/dates';
import { todayDateString } from '@/lib/workplan';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}
function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);
}

export default function DayStepper({ selectedDate, onChange, helperCount }: {
  selectedDate: Date;
  onChange: (d: Date) => void;
  /** Helper count for the subline ("· 1 helper"). Null while loading. */
  helperCount: number | null;
}) {
  const today = startOfDay(new Date());
  const diff = dayDiff(selectedDate, today);
  const isToday = diff === 0;

  // Big relative label; the exact date sits underneath in DD-Mmm-YYYY.
  const rel =
    diff === 0 ? 'Today' :
    diff === -1 ? 'Yesterday' :
    diff === 1 ? 'Tomorrow' :
    selectedDate.toLocaleDateString('en-US', { weekday: 'long' });

  const fullDate = toDisplayDate(todayDateString(selectedDate));
  const countBit = helperCount != null
    ? ` · ${helperCount} ${helperCount === 1 ? 'helper' : 'helpers'}`
    : '';

  const step = (n: number) => onChange(addDays(selectedDate, n));
  const goto = (relDays: number) => onChange(addDays(today, relDays));

  const arrow = 'w-10 h-10 rounded-hive-pill border border-hive-line bg-hive-paper text-hive-navy inline-flex items-center justify-center flex-shrink-0 hover:bg-hive-cream active:scale-95 transition';
  const chipBase = 'font-nunito font-extrabold text-[12px] px-4 py-1.5 rounded-hive-pill border transition';
  const chipOff = 'bg-hive-cream border-hive-line text-hive-muted hover:bg-hive-paper';
  const chipOn = 'bg-hive-ink border-hive-ink text-white';
  const chipJump = 'bg-pantry-leaf-soft border-pantry-leaf text-pantry-leaf-dk hover:brightness-105';

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => step(-1)} className={arrow} aria-label="Previous day">
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 min-w-0 text-center">
          <h1 className="font-nunito font-black text-3xl lg:text-[34px] leading-none truncate">{rel}</h1>
          <p className="text-[12px] text-hive-muted mt-1">{fullDate}{countBit}</p>
        </div>
        <button type="button" onClick={() => step(1)} className={arrow} aria-label="Next day">
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => goto(-1)}
          className={`${chipBase} ${diff === -1 ? chipOn : chipOff}`}
        >‹ Yesterday</button>

        {isToday ? (
          <button type="button" disabled className={`${chipBase} ${chipOn} cursor-default`}>Today</button>
        ) : (
          <button type="button" onClick={() => goto(0)} className={`${chipBase} ${chipJump}`}>↩ Today</button>
        )}

        <button
          type="button"
          onClick={() => goto(1)}
          className={`${chipBase} ${diff === 1 ? chipOn : chipOff}`}
        >Tomorrow ›</button>
      </div>
    </div>
  );
}
