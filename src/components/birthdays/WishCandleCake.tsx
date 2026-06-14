'use client';

// Kaya · Birthdays — the Wish-Candle Cake (B2).
//
// Every family wish lights a candle on the birthday person's cake (wishes are
// tallied on family.birthdays[key].wishes by /api/birthdays/wish). The birthday
// person — and only they — gets the "blow out the candles" button; one tap
// stamps blownOutAt via /api/birthdays/blow, the flames turn to smoke wisps and
// a little confetti pops. Everyone else watches the same cake fill up in real
// time (the family doc is live) and reads the wishes wall below it.
//
// Designed to sit ON the themed hero gradient — it renders transparent, the
// cream cake + white text read against the theme. No background of its own.

import { useState } from 'react';
import type { BirthdayPerson, BirthdayDayState } from '@/lib/birthdays';

const MAX_VISIBLE_CANDLES = 12;

export default function WishCandleCake({ familyId, person, dayState, viewerUid, isSelf }: {
  familyId: string;
  person: BirthdayPerson;
  dayState?: BirthdayDayState;
  viewerUid: string;
  isSelf: boolean;
}) {
  const theme = person.theme;
  const wishes = dayState?.wishes ?? [];
  const lit = wishes.length;                       // candles = wishes
  const visible = Math.min(lit, MAX_VISIBLE_CANDLES);
  const extra = lit - visible;

  const [blownLocal, setBlownLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const blown = !!dayState?.blownOutAt || blownLocal;

  const blow = async () => {
    if (busy || blown) return;
    setBusy(true);
    setBlownLocal(true);                            // optimistic — snapshot reconciles
    try {
      await fetch('/api/birthdays/blow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId, byUid: viewerUid, personKey: person.stateKey }),
      });
    } catch { /* keep optimistic state */ } finally { setBusy(false); }
  };

  return (
    <div className="relative">
      <style>{`
        @keyframes kayaFlame { 0%,100%{ transform:translateX(-50%) scaleY(1); opacity:1 } 50%{ transform:translateX(-50%) scaleY(.82) rotate(-3deg); opacity:.85 } }
        @keyframes kayaSmoke { 0%{ transform:translateX(-50%) translateY(0) scale(.7); opacity:.55 } 100%{ transform:translateX(-50%) translateY(-15px) scale(1.3); opacity:0 } }
        @keyframes kayaPop { 0%{ transform:translateY(6px) scale(.4); opacity:0 } 30%{ opacity:1 } 100%{ transform:translateY(-42px) scale(1); opacity:0 } }
      `}</style>

      {/* confetti pop after the blow */}
      {blown && (
        <div aria-hidden className="absolute inset-x-0 -top-1 flex justify-center gap-3 pointer-events-none">
          {['🎉', '✨', '🎊', '💛', '🎈'].map((e, i) => (
            <span key={i} style={{ animation: `kayaPop 1.2s ${i * 0.09}s ease-out`, fontSize: 18 }}>{e}</span>
          ))}
        </div>
      )}

      <div className="text-[10px] font-nunito font-black uppercase tracking-[2px]" style={{ color: theme.accent }}>
        {theme.emoji} Wish-Candle Cake
      </div>
      <div className="font-nunito font-black text-[14.5px] leading-tight mt-0.5 text-white">
        {blown
          ? (isSelf ? 'You blew out the candles — wish made! ✨' : `${person.name} made a wish ✨`)
          : (lit === 0
              ? (isSelf ? 'Your candles light up with every wish 🎈' : `Send a wish to light ${person.name}'s first candle 🕯️`)
              : `${lit} candle${lit === 1 ? '' : 's'} lit${isSelf ? ' — make a wish & blow them out!' : ''}`)}
      </div>

      {/* ── the cake ───────────────────────────────────────────────── */}
      <div className="relative mt-3 mx-auto" style={{ width: 224, height: 130 }}>
        {/* candles (or, when none yet, a single theme topper) */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-end justify-center gap-[7px]" style={{ top: 2, height: 38 }}>
          {visible === 0 ? (
            <span style={{ fontSize: 26, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.25))' }}>{theme.emoji}</span>
          ) : (
            Array.from({ length: visible }).map((_, i) => (
              <div key={i} className="relative" style={{ width: 6, height: 30 }}>
                {blown ? (
                  <span className="absolute left-1/2" style={{ top: -10, width: 6, height: 8, borderRadius: '50%', background: 'rgba(225,225,225,.75)', animation: `kayaSmoke 1.8s ${i * 0.06}s ease-out infinite` }} />
                ) : (
                  <span className="absolute left-1/2" style={{ top: -10, width: 7, height: 11, borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%', background: 'radial-gradient(circle at 50% 70%, #FFE89A, #F39C2F 70%, #E2641B)', boxShadow: '0 0 7px rgba(243,156,47,.9)', transformOrigin: 'bottom center', animation: `kayaFlame ${1 + (i % 3) * 0.2}s ${i * 0.07}s ease-in-out infinite` }} />
                )}
                {/* wax stick */}
                <span className="absolute bottom-0 left-0 w-full rounded-[2px]" style={{ height: 30, background: i % 2 === 0 ? '#FFF6E9' : theme.accent }} />
                <span className="absolute bottom-0 left-0 w-full rounded-[2px]" style={{ height: 30, backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,.35) 4px 7px)' }} />
              </div>
            ))
          )}
        </div>
        {/* top tier */}
        <div className="absolute left-1/2 -translate-x-1/2 rounded-t-[10px] rounded-b-[6px]" style={{ bottom: 54, width: 124, height: 46, background: 'linear-gradient(#FFF4E0, #FCE7C4)', boxShadow: 'inset 0 -6px 0 rgba(0,0,0,.06)' }} />
        {/* base tier */}
        <div className="absolute left-1/2 -translate-x-1/2 rounded-[12px]" style={{ bottom: 8, width: 204, height: 56, background: 'linear-gradient(#FFE7C2, #F6D199)', boxShadow: 'inset 0 -8px 0 rgba(0,0,0,.07)' }} />
        {/* frosting band */}
        <div className="absolute left-1/2 -translate-x-1/2 rounded-full" style={{ bottom: 58, width: 124, height: 9, background: theme.accent, opacity: .85 }} />
        {/* plate */}
        <div className="absolute left-1/2 -translate-x-1/2 rounded-full" style={{ bottom: 0, width: 224, height: 13, background: 'rgba(255,255,255,.32)' }} />
        {extra > 0 && (
          <div className="absolute right-1 top-1 text-[11px] font-nunito font-black px-1.5 py-0.5 rounded-full" style={{ color: '#3D2E08', background: theme.accent }}>+{extra}</div>
        )}
      </div>

      {/* blow button — birthday person only, once there's a candle to blow */}
      {isSelf && !blown && lit > 0 && (
        <button type="button" onClick={blow} disabled={busy}
          className="mt-3 w-full font-nunito font-black text-[13px] rounded-full py-2.5 disabled:opacity-60"
          style={{ background: theme.accent, color: '#3D2E08' }}>
          {busy ? 'Blowing…' : '🕯️ Make a wish & blow out the candles'}
        </button>
      )}

      {/* wishes wall */}
      {wishes.length > 0 && (
        <div className="mt-3">
          <div className="text-[10.5px] font-nunito font-black uppercase tracking-[1.5px] mb-1.5" style={{ color: theme.accent }}>
            💛 Wishes from the family
          </div>
          <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-1">
            {wishes.slice().reverse().map((w, i) => (
              <div key={`${w.uid}-${w.at}-${i}`} className="bg-white/15 rounded-xl px-3 py-2">
                <div className="text-[12px] font-nunito font-bold leading-snug text-white">{w.text}</div>
                <div className="text-[10.5px] text-white/80 mt-0.5">— {w.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
