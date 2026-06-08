'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { readPassport } from '@/lib/triviaPassport';
import { readExplorers, levelFor, levelTitle, levelProgress, type Explorer } from '@/lib/triviaExplorers';
import { readTriviaSeen } from '@/lib/triviaSeen';
import { COUNTRIES, countryByCode } from '@/lib/countries';

// Kaya World Passport & Progress — countries explored in Local Trivia (stamps +
// a world strip), each player's Explorer Level, and milestone badges.

export default function PassportPage() {
  const { profile } = useAuth();
  const familyId = profile?.familyId;
  const [codes, setCodes] = useState<string[]>([]);
  const [explorers, setExplorers] = useState<Record<string, Explorer>>({});
  const [explored, setExplored] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!familyId) return;
    (async () => {
      const [p, ex, seen] = await Promise.all([
        readPassport(familyId), readExplorers(familyId), readTriviaSeen(familyId, 'general'),
      ]);
      if (cancelled) return;
      setCodes(p.countries); setExplorers(ex); setExplored(seen.count); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [familyId]);

  const got = useMemo(() => new Set(codes.map((c) => c.toUpperCase())), [codes]);
  const stamps = codes.map((c) => countryByCode(c)).filter(Boolean) as { code: string; name: string; flag: string }[];
  const players = useMemo(() => (
    Object.entries(explorers).map(([uid, e]) => ({ uid, ...e, level: levelFor(e.xp) }))
      .sort((a, b) => b.xp - a.xp)
  ), [explorers]);
  const maxLevel = players.reduce((m, p) => Math.max(m, p.level), 0);

  const badges = [
    { icon: '🌐', name: 'Globetrotter', got: got.size >= 5, hint: 'Play 5 countries' },
    { icon: '💯', name: '100 Club', got: explored >= 100, hint: '100 questions' },
    { icon: '🎒', name: 'Adventurer', got: maxLevel >= 3, hint: 'Reach Level 3' },
    { icon: '🗺️', name: 'Geographer', got: maxLevel >= 6, hint: 'Reach Level 6' },
    { icon: '🧭', name: 'Explorer', got: maxLevel >= 9, hint: 'Reach Level 9' },
    { icon: '🌟', name: 'World Master', got: maxLevel >= 13 || got.size >= 20, hint: 'Level 13 / 20 lands' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <div className="mx-auto max-w-md w-full px-4 pt-4 pb-28">
        <Link href="/games" className="text-sm font-bold text-games-ink-soft">&larr; Games</Link>

        <div className="rounded-kaya-lg p-5 my-4 text-white text-center" style={{ background: 'linear-gradient(160deg,#1A2A5E,#24388A)' }}>
          <div className="text-4xl mb-1">🛂</div>
          <h1 className="font-display text-2xl font-black">World Passport</h1>
          <p className="text-xs opacity-85 mt-1">{got.size} / 195 countries · 🧠 {explored.toLocaleString()} questions explored</p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-games-ink-soft py-10">Loading…</p>
        ) : (
          <>
            {/* Explorer levels */}
            {players.length > 0 && (
              <div className="bg-games-card rounded-kaya p-4 mb-4 shadow-[0_4px_12px_rgba(26,18,64,0.06)]">
                <p className="text-[11px] font-bold uppercase tracking-wider text-games-ink-soft mb-2">📈 Explorer levels</p>
                <div className="flex flex-col gap-2.5">
                  {players.map((p) => (
                    <div key={p.uid} className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center font-display font-black text-games-violet-deep text-sm"
                        style={{ background: `conic-gradient(var(--games-violet, #6B3FE0) ${Math.round(levelProgress(p.xp) * 360)}deg, #EEE7FF 0)` }}>
                        <span className="w-8 h-8 rounded-full bg-white flex items-center justify-center">L{p.level}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-display font-extrabold text-sm text-games-ink truncate">{p.name} · {levelTitle(p.level)}</p>
                        <div className="h-1.5 rounded-full bg-games-bg overflow-hidden mt-1">
                          <div className="h-full bg-gradient-to-r from-games-teal to-games-violet" style={{ width: `${Math.round(levelProgress(p.xp) * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Badges */}
            <div className="bg-games-card rounded-kaya p-4 mb-4 shadow-[0_4px_12px_rgba(26,18,64,0.06)]">
              <p className="text-[11px] font-bold uppercase tracking-wider text-games-ink-soft mb-2">🏅 Badges</p>
              <div className="grid grid-cols-3 gap-2.5">
                {badges.map((b) => (
                  <div key={b.name} className={`rounded-kaya p-2.5 text-center ${b.got ? 'bg-games-bg' : 'opacity-45'}`} title={b.hint}>
                    <div className="text-2xl" style={{ filter: b.got ? 'none' : 'grayscale(1)' }}>{b.icon}</div>
                    <div className="text-[10px] font-extrabold text-games-ink mt-1 leading-tight">{b.name}</div>
                    {!b.got && <div className="text-[8px] text-games-ink-soft mt-0.5">{b.hint}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Stamps */}
            {stamps.length > 0 && (
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
            )}

            {/* World strip */}
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
          </>
        )}
      </div>
    </div>
  );
}
