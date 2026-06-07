'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { readPassport } from '@/lib/triviaPassport';
import { COUNTRIES, countryByCode } from '@/lib/countries';

// Kaya World Passport — the countries a family has explored in Local Trivia.
// Earn a stamp by playing a country; the world strip lights up as you go.

export default function PassportPage() {
  const { profile } = useAuth();
  const familyId = profile?.familyId;
  const [codes, setCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!familyId) return;
    (async () => {
      const p = await readPassport(familyId);
      if (!cancelled) { setCodes(p.countries); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [familyId]);

  const got = useMemo(() => new Set(codes.map((c) => c.toUpperCase())), [codes]);
  // Stamps: the countries played, newest first; pad to a tidy grid of 6+.
  const stamps = codes.map((c) => countryByCode(c)).filter(Boolean) as { code: string; name: string; flag: string }[];

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <div className="mx-auto max-w-md w-full px-4 pt-4 pb-28">
        <Link href="/games" className="text-sm font-bold text-games-ink-soft">&larr; Games</Link>

        <div className="rounded-kaya-lg p-5 my-4 text-white text-center" style={{ background: 'linear-gradient(160deg,#1A2A5E,#24388A)' }}>
          <div className="text-4xl mb-1">🛂</div>
          <h1 className="font-display text-2xl font-black">Kaya World Passport</h1>
          <p className="text-xs opacity-85 mt-1">{got.size} / 195 countries explored</p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-games-ink-soft py-10">Loading…</p>
        ) : stamps.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-5xl mb-3">🌍</p>
            <p className="font-display text-lg font-extrabold text-games-ink mb-1">No stamps yet</p>
            <p className="text-sm text-games-ink-soft mb-5">Play <b>Local Trivia</b> for a country to earn its stamp.</p>
            <Link href="/games/local-trivia" className="inline-block bg-games-violet text-white font-extrabold text-sm px-5 py-2.5 rounded-full">🌍 Play Local Trivia</Link>
          </div>
        ) : (
          <>
            {/* stamps */}
            <div className="rounded-kaya-lg p-4 mb-4" style={{ background: 'linear-gradient(160deg,#1A2A5E,#24388A)' }}>
              <p className="text-[10px] font-black tracking-[0.1em] text-white/80 mb-3">STAMPS COLLECTED</p>
              <div className="grid grid-cols-3 gap-3">
                {stamps.map((c) => (
                  <div key={c.code} className="aspect-square rounded-full flex flex-col items-center justify-center text-2xl text-white"
                    style={{ border: '2px solid #FFC93C', background: 'rgba(255,201,60,0.12)', transform: 'rotate(-7deg)' }}>
                    {c.flag}
                    <span className="text-[8px] font-extrabold opacity-90 mt-0.5">{c.name.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* world strip — popular countries light up as you explore */}
        <div className="bg-games-card rounded-kaya p-4 shadow-[0_4px_12px_rgba(26,18,64,0.06)]">
          <p className="text-[11px] font-bold uppercase tracking-wider text-games-ink-soft mb-2">🗺️ Explore the world</p>
          <div className="flex flex-wrap gap-2">
            {COUNTRIES.map((c) => {
              const lit = got.has(c.code);
              return (
                <Link key={c.code} href="/games/local-trivia" title={c.name}
                  className="w-10 h-8 rounded-md flex items-center justify-center text-xl relative"
                  style={{ background: lit ? '#fff' : '#EEE7FF', filter: lit ? 'none' : 'grayscale(1) opacity(0.5)', boxShadow: lit ? '0 0 0 2px #FFC93C' : 'none' }}>
                  {c.flag}
                  {lit && <span className="absolute -bottom-1 -right-1 bg-games-teal text-white text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center">✓</span>}
                </Link>
              );
            })}
          </div>
          <p className="text-[11px] text-games-ink-soft mt-3">Tap a flag to play that country in Local Trivia.</p>
        </div>
      </div>
    </div>
  );
}
