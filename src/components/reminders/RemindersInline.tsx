'use client';

// My Day / Today surfacing for Kaya Reminders (R1 PR B). Today's reminders
// sit inline as tinted 🔔 rows (with their time); future ones live in a tidy
// "Coming up" block — exactly the approved v2 mock. Each respects 🔒 private
// / 👨‍👩‍👧 shared (the list route already visibility-filters). Renders
// nothing (no spacing) when there's nothing today or coming up.

import Link from 'next/link';
import { useReminders } from './useReminders';
import { typeMeta, formatTime, relativeDays, type ReminderOccurrence } from '@/lib/reminders';

const CAL = '#5B6CC8';
const CAL_DK = '#3E4DA0';
const CAL_SOFT = '#E7EAFA';

export default function RemindersInline({ wrapClassName = '' }: { wrapClassName?: string }) {
  const { loading, todays, upcoming } = useReminders(30);
  if (loading) return null;
  if (todays.length === 0 && upcoming.length === 0) return null;

  return (
    <div className={wrapClassName}>
      {todays.length > 0 && (
        <div className="space-y-2 mb-3">
          {todays.map((o) => <TodayRow key={`${o.event.id}-${o.dateKey}`} o={o} />)}
        </div>
      )}

      {upcoming.length > 0 && (
        <Link href="/reminders" className="block rounded-kaya border border-dashed p-3" style={{ borderColor: CAL, background: '#fff' }}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10.5px] font-extrabold uppercase tracking-wide" style={{ color: CAL_DK }}>🔔 Coming up</div>
            <span className="text-[10px] font-bold" style={{ color: CAL }}>See all →</span>
          </div>
          <div className="space-y-1.5">
            {upcoming.slice(0, 4).map((o) => (
              <div key={`${o.event.id}-${o.dateKey}`} className="flex items-center gap-2 text-[12px] font-bold text-kaya-chocolate">
                <span>{typeMeta(o.event.type).icon}</span>
                <span className="truncate">{o.event.title}</span>
                <VisBadge shared={o.event.visibility === 'shared'} />
                <span className="ml-auto text-[11px] font-extrabold shrink-0" style={{ color: CAL_DK }}>{relativeDays(o.daysAway, o.dateKey)}</span>
              </div>
            ))}
          </div>
        </Link>
      )}
    </div>
  );
}

function TodayRow({ o }: { o: ReminderOccurrence }) {
  const ev = o.event;
  const meta = typeMeta(ev.type);
  const sub = [ev.withWho && `with ${ev.withWho}`, ev.location].filter(Boolean).join(' · ');
  return (
    <Link
      href="/reminders"
      className="flex items-center gap-3 rounded-kaya border px-3 py-2.5"
      style={{ borderColor: CAL, background: `linear-gradient(0deg,#fff,${CAL_SOFT} 280%)` }}
    >
      <span className="w-9 h-9 rounded-kaya-sm flex items-center justify-center text-lg shrink-0" style={{ background: CAL_SOFT }}>{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-extrabold text-kaya-chocolate truncate flex items-center gap-1.5">
          {ev.title}
          <span className="text-[8.5px] font-extrabold rounded px-1 py-0.5" style={{ background: '#fff', border: `1px solid ${CAL}`, color: CAL_DK }}>REMINDER</span>
          <VisBadge shared={ev.visibility === 'shared'} />
        </div>
        {sub && <div className="text-[10.5px] text-kaya-sand truncate">{sub}</div>}
      </div>
      <div className="text-right shrink-0">
        <div className="text-[11.5px] font-extrabold" style={{ color: CAL_DK }}>{ev.time ? formatTime(ev.time) : 'Today'}</div>
      </div>
    </Link>
  );
}

function VisBadge({ shared }: { shared: boolean }) {
  return shared
    ? <span className="text-[8px] font-extrabold rounded-full px-1.5 py-0.5" style={{ background: '#E1F3E8', color: '#3FAF6C' }}>FAMILY</span>
    : <span className="text-[8px] font-extrabold rounded-full px-1.5 py-0.5" style={{ background: '#EFEAFB', color: '#6B4FC0' }}>PRIVATE</span>;
}
