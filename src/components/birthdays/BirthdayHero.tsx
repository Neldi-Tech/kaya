'use client';

// Kaya · Birthdays — the family Home hero banner (B1).
//
// Renders for EVERY family member on the day. Confetti-dotted gradient in the
// birthday person's theme, "Send your wish" CTA → /my-day (where the wish card
// lives), and a self-variant when the viewer IS the birthday person. Also
// fire-and-forgets the idempotent /api/birthdays/celebrate kickoff (chat post
// + emails) the first time anyone in the family opens Kaya on the day.

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useTodaysBirthdays } from './useTodaysBirthdays';
import { ordinalAge, localDayKey } from '@/lib/birthdays';

export default function BirthdayHero({ familyId, viewerUid, viewerChildId }: {
  familyId: string; viewerUid: string; viewerChildId?: string;
}) {
  const { people, state } = useTodaysBirthdays(familyId);
  const fired = useRef(false);

  // Idempotent kickoff — once per device per day; the route also guards via
  // family.birthdays[key].kickoffAt, so duplicates are no-ops.
  useEffect(() => {
    if (people.length === 0 || fired.current) return;
    const needsKickoff = people.some((p) => !state[p.stateKey]?.kickoffAt);
    if (!needsKickoff) return;
    const guardKey = `kaya-bday-kickoff-${localDayKey()}`;
    try {
      if (localStorage.getItem(guardKey)) return;
      localStorage.setItem(guardKey, '1');
    } catch { /* private mode — rely on the server guard */ }
    fired.current = true;
    void fetch('/api/birthdays/celebrate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ familyId, triggeredBy: viewerUid }),
    }).catch(() => {});
  }, [people, state, familyId, viewerUid]);

  if (people.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 mb-4">
      {people.map((p) => {
        const isSelf = p.id === viewerChildId || p.id === viewerUid;
        const wishes = state[p.stateKey]?.wishes?.length ?? 0;
        return (
          <div key={p.stateKey} className="relative rounded-hive overflow-hidden text-white p-4 sm:p-5"
            style={{ background: `linear-gradient(135deg, ${p.theme.from} 0%, ${p.theme.to} 130%)` }}>
            {/* confetti dots */}
            <div aria-hidden className="absolute inset-0 pointer-events-none opacity-90" style={{
              backgroundImage: `radial-gradient(circle 3px at 12% 22%, ${p.theme.accent} 98%, transparent),
                radial-gradient(circle 2.5px at 28% 66%, #F7A8C4 98%, transparent),
                radial-gradient(circle 3px at 42% 16%, #9AD0EC 98%, transparent),
                radial-gradient(circle 2px at 56% 72%, ${p.theme.accent} 98%, transparent),
                radial-gradient(circle 3px at 70% 28%, #F7A8C4 98%, transparent),
                radial-gradient(circle 2.5px at 84% 58%, #9AD0EC 98%, transparent),
                radial-gradient(circle 3px at 93% 20%, ${p.theme.accent} 98%, transparent)`,
            }} />
            <div className="relative">
              <div className="text-[10px] font-nunito font-black uppercase tracking-[2px]" style={{ color: p.theme.accent }}>
                🎉 Today is special
              </div>
              <h3 className="font-nunito font-black text-[19px] sm:text-[21px] leading-tight mt-1">
                {isSelf
                  ? `Happy Birthday, ${p.name}! ${p.theme.emoji}`
                  : `It's ${p.name}'s ${p.age ? `${ordinalAge(p.age)} ` : ''}birthday!`}
              </h3>
              <div className="text-[12px] opacity-90 mt-0.5">
                {isSelf
                  ? `The whole family is cheering for you 📣`
                  : wishes > 0
                    ? `${wishes} wish${wishes === 1 ? '' : 'es'} sent so far — add yours 🎈`
                    : `Be the first to send a wish 🎈`}
              </div>
              {!isSelf && (
                <Link href="/my-day"
                  className="inline-block mt-3 font-nunito font-black text-[12.5px] rounded-full px-4 py-2 no-underline"
                  style={{ background: p.theme.accent, color: '#3D2E08' }}>
                  🎂 Send your wish
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
