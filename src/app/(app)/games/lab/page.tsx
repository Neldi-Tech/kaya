'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { GAMES } from '@/lib/gamesCatalog';
import { rateBetaGame, ratedCount, hasTesterBadge, TESTER_BADGE_AT, type LabRatings } from '@/lib/gamesLab';

const BETA = GAMES.filter((g) => g.beta);
const COMING_SOON = [
  { icon: '🎨', name: 'Color the Mandala' },
  { icon: '🇹🇿', name: 'Swahili Story Cards' },
  { icon: '🗺️', name: 'Picture Maze' },
];
const CARD = 'shadow-[0_4px_12px_rgba(26,18,64,0.06)]';

export default function KayaLabPage() {
  const { profile } = useAuth();
  const uid = profile?.uid || '';
  const isKid = profile?.role === 'kid';
  const [ratings, setRatings] = useState<LabRatings>(profile?.labRatings || {});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    setRatings((cur) => (Object.keys(cur).length === 0 && profile?.labRatings ? profile.labRatings : cur));
  }, [profile?.labRatings]);

  const rate = async (gameId: string, stars: number) => {
    if (!isKid || !uid) return;
    setSavingId(gameId);
    try { setRatings(await rateBetaGame(uid, ratings, gameId, stars)); }
    finally { setSavingId(null); }
  };

  const count = ratedCount(ratings);
  const badge = hasTesterBadge(ratings);
  const toGo = Math.max(0, TESTER_BADGE_AT - count);

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <div className="mx-auto max-w-md w-full px-4 pt-4 pb-28">
        <Link href="/games" className="text-sm font-bold text-games-ink-soft">&larr; Games</Link>

        <div className="rounded-kaya-lg p-5 my-4 text-games-ink text-center bg-gradient-to-br from-games-gold to-games-pink">
          <div className="text-4xl mb-1">🧪</div>
          <h1 className="font-display text-2xl font-black">Kaya Lab</h1>
          <p className="text-xs font-semibold mt-1">Try new games early — your stars help decide what ships!</p>
        </div>

        <div className={`bg-games-card rounded-kaya p-4 mb-4 text-center ${CARD}`}>
          {badge ? (
            <p className="font-display font-extrabold text-games-violet">🏅 Tester Badge unlocked — thank you!</p>
          ) : (
            <p className="text-sm font-bold text-games-ink-soft">
              Rate <span className="text-games-violet">{toGo}</span> more game{toGo === 1 ? '' : 's'} to earn the 🏅 Tester Badge
            </p>
          )}
        </div>

        {BETA.map((g) => {
          const r = ratings[g.id];
          return (
            <div key={g.id} className={`bg-games-card rounded-kaya p-4 mb-3 ${CARD}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-xl bg-games-bg text-2xl flex items-center justify-center shrink-0">{g.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-display font-extrabold text-games-ink leading-tight">{g.name}</p>
                  <span className="inline-block text-[9px] font-extrabold uppercase tracking-wide text-games-coral bg-games-coral/12 px-1.5 py-0.5 rounded-full mt-0.5">Beta</span>
                </div>
                <Link href={`/games/${g.id}`} className="bg-games-violet text-white text-xs font-extrabold px-4 py-2 rounded-full shrink-0">Try it</Link>
              </div>
              <div className="flex items-center justify-center gap-1.5">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button key={s} type="button" onClick={() => rate(g.id, s)} disabled={!isKid || savingId === g.id} className="text-2xl disabled:opacity-50 active:scale-90 transition-transform" aria-label={`${s} stars`}>
                    {r && r.stars >= s ? '⭐' : '☆'}
                  </button>
                ))}
              </div>
              {r ? (
                <p className="text-center text-[11px] text-games-teal font-bold mt-1.5">You rated it {r.stars}★ — thanks!</p>
              ) : !isKid ? (
                <p className="text-center text-[11px] text-games-ink-soft mt-1.5">Kids rate the betas 🙂</p>
              ) : (
                <p className="text-center text-[11px] text-games-ink-soft mt-1.5">Play it, then tap the stars</p>
              )}
            </div>
          );
        })}

        <p className="text-[11px] font-bold uppercase tracking-wide text-games-ink-soft mt-5 mb-2">Coming soon · new drops Fridays</p>
        {COMING_SOON.map((c) => (
          <div key={c.name} className="bg-games-bg rounded-kaya p-3 mb-2 flex items-center gap-3">
            <span className="text-xl">{c.icon}</span>
            <span className="flex-1 font-bold text-games-ink text-sm">{c.name}</span>
            <span className="text-[11px] font-bold text-games-ink-soft">🔜 soon</span>
          </div>
        ))}
      </div>
    </div>
  );
}
