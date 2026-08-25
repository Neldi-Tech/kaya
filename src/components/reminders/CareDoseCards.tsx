'use client';

// 💊 Care dose cards (v5, approved 25-Aug-2026) — today's tickable slots,
// rendered inside the reminders strip on My Day for every role:
//   · giver (assigned helper/parent): photo + dose + big "✓ Give" — the ✓
//     that counts; ⏭ skip recorded honestly; late ticks stamped by server.
//   · kid it's for: friendly card (no medicine name pushed at small kids)
//     + "💪 I was brave" celebration tap — never the medical record.
//   · watching parent (not a giver): read-only status chips.
// Data + local patching come from useReminders (careToday / applyDose).

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  tickDose, doseEntryFor, careDayNumber, careTotalDays, todayKey, slotIcon,
  type ReminderEvent, type DoseEntry,
} from '@/lib/reminders';

const CARE = '#2E8C7E';
const CARE_SOFT = '#E2F4F1';

function tickedTime(entry?: DoseEntry): string {
  if (!entry?.at) return '';
  const d = new Date(entry.at);
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}

export default function CareDoseCards({
  events, onDose,
}: {
  events: ReminderEvent[];
  onDose: (eventId: string, entry: DoseEntry) => void;
}) {
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState('');
  const today = todayKey();
  const role = profile?.role;
  const uid = profile?.uid || '';
  const childId = profile?.childId || '';
  if (!events.length || !profile) return null;

  async function tick(ev: ReminderEvent, slotIndex: number, opts: { status?: 'given' | 'skipped'; brave?: boolean }) {
    if (!user) return;
    const k = `${ev.id}:${slotIndex}`;
    if (busy === k) return;
    setBusy(k);
    try {
      const token = await user.getIdToken();
      const res = await tickDose(token, { id: ev.id, dateKey: today, slotIndex, ...opts });
      if (res.entry) onDose(ev.id, res.entry);
    } catch { /* stays untouched — user can retry */ }
    setBusy('');
  }

  return (
    <div className="space-y-2 mb-3">
      {events.map((ev) => {
        const care = ev.care!;
        const isGiver = role === 'parent' || (care.giverUids || []).includes(uid);
        const isTheKid = role === 'kid' && care.forKind === 'kid' && care.forChildId === childId;
        const dayN = careDayNumber(ev, today);
        const total = careTotalDays(ev);
        const dayChip = dayN ? `DAY ${dayN}${total ? `/${total}` : ''}` : 'ONGOING';
        const who = care.forKind === 'self' ? '' : (care.forName || '');

        // 🎴 Courage Card — kid-only, during a medicine course (approved
        // mock: gradient top · day chip · message · progress to the 🛡).
        const courage = isTheKid && ev.type === 'medicine' && ev.courageCard?.dateKey === today
          ? ev.courageCard.text : '';
        const courageCard = courage ? (
          <div key={`${ev.id}-courage`} className="rounded-kaya overflow-hidden border border-kaya-warm-dark max-w-[340px]">
            <div className="px-4 py-3 text-center text-white" style={{ background: 'linear-gradient(135deg,#1F2D3D 0%,#2E8C7E 65%,#F39C2F 140%)' }}>
              <div className="text-[9px] font-extrabold uppercase tracking-[2px] opacity-85">
                🎴 Courage Card{dayN && total ? ` · Day ${dayN} of ${total}` : ''}
              </div>
              <div className="text-[15px] font-extrabold mt-1.5">{courage}</div>
            </div>
            {dayN && total ? (
              <div className="px-4 py-2.5 text-center bg-white">
                <div className="h-2 rounded-full overflow-hidden" style={{ background: CARE_SOFT }}>
                  <div className="h-full rounded-full" style={{ background: CARE, width: `${Math.min(100, Math.round((dayN / total) * 100))}%` }} />
                </div>
                <div className="text-[10px] text-kaya-sand mt-1 font-bold">
                  {total - dayN > 0 ? `${total - dayN} day${total - dayN === 1 ? '' : 's'} to your 🛡 Course Champion badge!` : '🛡 Badge day — you did it!'}
                </div>
              </div>
            ) : null}
          </div>
        ) : null;

        const slotCards = care.slots.map((slot, i) => {
          const entry = doseEntryFor(ev, today, i);
          const done = entry?.status === 'given' || entry?.status === 'late';
          const skipped = entry?.status === 'skipped';
          const k = `${ev.id}:${i}`;
          const icon = slot.icon || slotIcon(slot.time);

          // ── Kid view — friendly, celebration-only. ──────────────────
          if (isTheKid && !isGiver) {
            return (
              <div key={k} className="flex items-center gap-3 rounded-kaya border px-3 py-2.5"
                style={{ borderColor: '#E8C989', background: 'linear-gradient(0deg,#fff,#F5E9D2 320%)' }}>
                <span className="w-9 h-9 rounded-kaya-sm flex items-center justify-center text-lg shrink-0" style={{ background: CARE_SOFT }}>
                  {ev.type === 'medicine' ? '💊' : '🔁'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-extrabold text-kaya-chocolate">
                    {ev.type === 'medicine' ? `Your medicine time ${icon}` : `${ev.title} ${icon}`}
                  </div>
                  <div className="text-[10.5px] text-kaya-sand">
                    {done ? 'All done — well done! 🎉' : `At ${slot.time}`}{dayN && total ? ` · day ${dayN} of ${total}!` : ''}
                  </div>
                </div>
                <button
                  onClick={() => tick(ev, i, { brave: true })}
                  disabled={busy === k || (entry?.braveUids || []).includes(uid)}
                  className="rounded-full px-3 py-1.5 text-[11px] font-extrabold shrink-0 disabled:opacity-70"
                  style={{ background: '#F5E9D2', color: '#8A6D1F' }}
                >
                  {(entry?.braveUids || []).includes(uid) ? '💪 Brave! 🎉' : '💪 I was brave'}
                </button>
              </div>
            );
          }

          // ── Giver / watching-parent view. ───────────────────────────
          const sub = [care.dose, care.withFood ? 'with food 🍽' : '', who && `for ${who}`]
            .filter(Boolean).join(' · ');
          return (
            <div key={k} className="flex items-center gap-3 rounded-kaya border px-3 py-2.5 bg-white"
              style={{ borderColor: done ? '#BCDCC8' : CARE }}>
              {care.photoUrl ? (
                <a href={care.photoUrl} target="_blank" rel="noreferrer"
                  className="w-11 h-11 rounded-kaya-sm overflow-hidden shrink-0 border border-kaya-warm-dark">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={care.photoUrl} alt="" className="w-full h-full object-cover" />
                </a>
              ) : (
                <span className="w-11 h-11 rounded-kaya-sm flex items-center justify-center text-xl shrink-0" style={{ background: CARE_SOFT }}>
                  {ev.type === 'medicine' ? '💊' : '🔁'}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-extrabold text-kaya-chocolate truncate flex items-center gap-1.5">
                  {ev.title}
                  <span className="text-[8.5px] font-extrabold rounded px-1.5 py-0.5 shrink-0" style={{ background: CARE_SOFT, color: CARE }}>
                    {ev.type === 'medicine' ? '💊' : '🔁'} {dayChip}
                  </span>
                </div>
                <div className="text-[10.5px] text-kaya-sand truncate">
                  {sub}{sub ? ' · ' : ''}
                  <span className="font-extrabold" style={{ color: CARE }}>{icon} {slot.time}</span>
                </div>
              </div>
              {done ? (
                <span className="rounded-full px-3 py-1.5 text-[11.5px] font-extrabold shrink-0" style={{ background: '#E3F2E8', color: '#3E8E5A' }}>
                  ✓ {entry?.status === 'late' ? 'Late ' : 'Given '}{tickedTime(entry)}
                </span>
              ) : skipped ? (
                <span className="rounded-full px-3 py-1.5 text-[11.5px] font-extrabold shrink-0 bg-kaya-warm text-kaya-sand">
                  ⏭ Skipped
                </span>
              ) : isGiver ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => tick(ev, i, { status: 'given' })}
                    disabled={busy === k}
                    className="rounded-full px-4 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-60"
                    style={{ background: CARE }}
                  >
                    {busy === k ? '…' : '✓ Give'}
                  </button>
                  <button
                    onClick={() => tick(ev, i, { status: 'skipped' })}
                    disabled={busy === k}
                    className="text-[10px] font-bold text-kaya-sand px-1"
                    title="Record as deliberately not given"
                  >
                    ⏭
                  </button>
                </div>
              ) : (
                <span className="rounded-full px-3 py-1.5 text-[11px] font-extrabold shrink-0" style={{ background: CARE_SOFT, color: CARE }}>
                  ⏳ Pending
                </span>
              )}
            </div>
          );
        });
        return [...slotCards, courageCard];
      })}
    </div>
  );
}
