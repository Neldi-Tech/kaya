'use client';

// Kaya · Birthdays — the family Home hero (B1 banner + B2 takeover).
//
// Renders for EVERY family member on the day. Confetti-dotted gradient in the
// birthday person's theme. When the viewer IS the birthday person it becomes a
// takeover hosting the 🕯️ Wish-Candle Cake (B2) — their candles are the family's
// wishes, and they alone get to blow them out. Everyone else sees the banner +
// "Send your wish" CTA and can pop open the cake to watch it fill + read the
// wishes wall. Also fire-and-forgets the idempotent /api/birthdays/celebrate
// kickoff (chat post + emails) the first time anyone opens Kaya on the day.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTodaysBirthdays } from './useTodaysBirthdays';
import WishCandleCake from './WishCandleCake';
import BirthdayMemoryLane from './BirthdayMemoryLane';
import { useAuth } from '@/contexts/AuthContext';
import { ordinalAge, localDayKey, type BirthdayPerson, type BirthdayDayState } from '@/lib/birthdays';

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
      {people.map((p) => (
        <BirthdayCard
          key={p.stateKey}
          person={p}
          dayState={state[p.stateKey]}
          allState={state}
          familyId={familyId}
          viewerUid={viewerUid}
          isSelf={p.id === viewerChildId || p.id === viewerUid}
        />
      ))}
    </div>
  );
}

function BirthdayCard({ person, dayState, allState, familyId, viewerUid, isSelf }: {
  person: BirthdayPerson;
  dayState?: BirthdayDayState;
  allState: Record<string, BirthdayDayState>;
  familyId: string;
  viewerUid: string;
  isSelf: boolean;
}) {
  const { profile } = useAuth();
  const isParent = profile?.role === 'parent';
  const [cakeOpen, setCakeOpen] = useState(false);
  const [ncOverride, setNcOverride] = useState<boolean | null>(null);
  const [ncBusy, setNcBusy] = useState(false);
  const theme = person.theme;
  const wishes = dayState?.wishes?.length ?? 0;
  const noChores = ncOverride ?? !!dayState?.noChores;

  const toggleNoChores = async () => {
    if (ncBusy) return;
    const next = !noChores;
    setNcBusy(true);
    setNcOverride(next);                               // optimistic
    try {
      await fetch('/api/birthdays/mark', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId, byUid: viewerUid, personKey: person.stateKey, action: next ? 'nochores-on' : 'nochores-off' }),
      });
    } catch { /* keep optimistic state */ } finally { setNcBusy(false); }
  };

  return (
    <div className="relative rounded-hive overflow-hidden text-white p-4 sm:p-5"
      style={{ background: `linear-gradient(135deg, ${theme.from} 0%, ${theme.to} 130%)` }}>
      {/* confetti dots */}
      <div aria-hidden className="absolute inset-0 pointer-events-none opacity-90" style={{
        backgroundImage: `radial-gradient(circle 3px at 12% 22%, ${theme.accent} 98%, transparent),
          radial-gradient(circle 2.5px at 28% 66%, #F7A8C4 98%, transparent),
          radial-gradient(circle 3px at 42% 16%, #9AD0EC 98%, transparent),
          radial-gradient(circle 2px at 56% 72%, ${theme.accent} 98%, transparent),
          radial-gradient(circle 3px at 70% 28%, #F7A8C4 98%, transparent),
          radial-gradient(circle 2.5px at 84% 58%, #9AD0EC 98%, transparent),
          radial-gradient(circle 3px at 93% 20%, ${theme.accent} 98%, transparent)`,
      }} />
      <div className="relative">
        <div className="text-[10px] font-nunito font-black uppercase tracking-[2px]" style={{ color: theme.accent }}>
          🎉 Today is special
        </div>
        <h3 className="font-nunito font-black text-[19px] sm:text-[22px] leading-tight mt-1">
          {isSelf
            ? `Happy Birthday, ${person.name}! ${theme.emoji}`
            : `It's ${person.name}'s ${person.age ? `${ordinalAge(person.age)} ` : ''}birthday!`}
        </h3>
        <div className="text-[12px] opacity-90 mt-0.5">
          {isSelf
            ? `The whole family is cheering for you 📣`
            : wishes > 0
              ? `${wishes} wish${wishes === 1 ? '' : 'es'} sent so far — add yours 🎈`
              : `Be the first to send a wish 🎈`}
        </div>

        {/* Parent gift — a chore-free birthday for the birthday kid. */}
        {isParent && person.kind === 'kid' && (
          <button type="button" onClick={toggleNoChores} disabled={ncBusy}
            className="mt-3 w-full flex items-center justify-between gap-2 rounded-full px-4 py-2.5 bg-white/20 text-white font-nunito font-black text-[12px] disabled:opacity-60">
            <span>🎉 Chore-free birthday for {person.name}</span>
            <span className="rounded-full px-2.5 py-0.5 text-[11px]"
              style={{ background: noChores ? theme.accent : 'rgba(255,255,255,.25)', color: noChores ? '#3D2E08' : '#fff' }}>
              {noChores ? 'ON' : 'OFF'}
            </span>
          </button>
        )}

        {/* Birthday person → the cake takeover, front & centre. */}
        {isSelf && (
          <div className="mt-4">
            <WishCandleCake familyId={familyId} person={person} dayState={dayState} viewerUid={viewerUid} isSelf />
            <BirthdayMemoryLane person={person} state={allState} />
          </div>
        )}

        {/* Everyone else → wish CTA + a pop-open cake to watch it fill. */}
        {!isSelf && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Link href="/my-day"
              className="inline-block font-nunito font-black text-[12.5px] rounded-full px-4 py-2 no-underline"
              style={{ background: theme.accent, color: '#3D2E08' }}>
              🎂 Send your wish
            </Link>
            <button type="button" onClick={() => setCakeOpen((o) => !o)}
              className="font-nunito font-black text-[12.5px] rounded-full px-4 py-2 bg-white/20 text-white">
              {cakeOpen ? 'Hide the cake' : `🕯️ See ${person.name}'s cake`}
            </button>
          </div>
        )}
        {!isSelf && cakeOpen && (
          <div className="mt-4">
            <WishCandleCake familyId={familyId} person={person} dayState={dayState} viewerUid={viewerUid} isSelf={false} />
            <BirthdayMemoryLane person={person} state={allState} />
          </div>
        )}
      </div>
    </div>
  );
}
