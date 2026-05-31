'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { findSessionByCode } from '@/lib/gameSessions';
import { getGame } from '@/lib/gamesCatalog';
import { awardGame } from '@/lib/gamesClient';
import MultiDeviceRoom from '@/components/games/MultiDeviceRoom';
import type { GameOutcome } from '@/components/games/types';

// Deep-link join (shared to family chat as /games/join/CODE). Resolves the
// code to its game, then drops the kid straight into the room (auto-join).

export default function JoinGamePage() {
  const params = useParams();
  const code = String((params as Record<string, string | string[]>)?.code || '').toUpperCase();
  const { profile } = useAuth();
  const familyId = profile?.familyId;
  const [gameId, setGameId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!familyId) return;
    (async () => {
      try {
        const s = await findSessionByCode(familyId, code);
        if (cancelled) return;
        if (!s) setErr("That game code isn't active anymore — ask for a fresh one.");
        else setGameId(s.gameId);
      } catch {
        if (!cancelled) setErr("Couldn't look that up. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [familyId, code]);

  const onComplete = useCallback(async (o: GameOutcome) => {
    if (gameId && o.success) await awardGame({ gameId, score: o.score });
    setDoneMsg(o.message || 'Great game! 🎉');
  }, [gameId]);

  const game = gameId ? getGame(gameId) : undefined;

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <div className="mx-auto max-w-md w-full px-4 pt-4 pb-28">
        <Link href="/games" className="text-sm font-bold text-games-ink-soft">&larr; Games</Link>
        {doneMsg ? (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">🎉</p>
            <p className="font-display text-xl font-extrabold text-games-ink mb-4">{doneMsg}</p>
            <Link href="/games" className="bg-games-violet text-white font-extrabold text-sm px-5 py-2.5 rounded-full">Back to Games</Link>
          </div>
        ) : loading ? (
          <p className="text-center text-sm text-games-ink-soft py-16">Finding game {code}…</p>
        ) : err || !game ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-sm text-games-ink-soft mb-6">{err || 'Game not found.'}</p>
            <Link href="/games" className="bg-games-violet text-white font-extrabold text-sm px-5 py-2.5 rounded-full">Back to Games</Link>
          </div>
        ) : (
          <div className="mt-4">
            <h1 className="font-display text-2xl font-black text-games-ink text-center mb-4">{game.name}</h1>
            <MultiDeviceRoom game={game} onComplete={onComplete} joinCode={code} />
          </div>
        )}
      </div>
    </div>
  );
}
