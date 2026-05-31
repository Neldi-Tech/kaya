'use client';

import { useCallback, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getGame } from '@/lib/gamesCatalog';
import { useFamily } from '@/contexts/FamilyContext';
import { resolveGamesConfig, gamePointsValue } from '@/lib/games';
import { awardGame, type AwardResult } from '@/lib/gamesClient';
import type { GameOutcome, GameProps } from '@/components/games/types';
import TicTacToe from '@/components/games/TicTacToe';
import MemoryMatch from '@/components/games/MemoryMatch';
import MathDash from '@/components/games/MathDash';
import Snake from '@/components/games/Snake';
import GuidedBreathing from '@/components/games/GuidedBreathing';
import GratitudeJar from '@/components/games/GratitudeJar';
import FiveSenses from '@/components/games/FiveSenses';
import MoodCheckin from '@/components/games/MoodCheckin';
import Game2048 from '@/components/games/Game2048';
import SlidingPuzzle from '@/components/games/SlidingPuzzle';
import WordSprint from '@/components/games/WordSprint';
import SudokuLite from '@/components/games/SudokuLite';
import Connect4 from '@/components/games/Connect4';
import SnakesLadders from '@/components/games/SnakesLadders';
import Charades from '@/components/games/Charades';
import Pictionary from '@/components/games/Pictionary';

// Registry of live games. The catalog says which ids are `built`; this maps
// each to its component. A built id with no component here falls back to the
// friendly "coming soon" panel, so the two can never desync into a blank.
const REGISTRY: Record<string, ComponentType<GameProps>> = {
  'tic-tac-toe': TicTacToe,
  'memory-match': MemoryMatch,
  'math-dash': MathDash,
  snake: Snake,
  breathing: GuidedBreathing,
  'gratitude-jar': GratitudeJar,
  'five-senses': FiveSenses,
  'mood-checkin': MoodCheckin,
  '2048': Game2048,
  'sliding-puzzle': SlidingPuzzle,
  'word-sprint': WordSprint,
  'sudoku-lite': SudokuLite,
  'connect-4': Connect4,
  'snakes-ladders': SnakesLadders,
  charades: Charades,
  pictionary: Pictionary,
};

function BurstRow() {
  const glyphs = ['⭐', '🎉', '✨', '🌟', '🎈'];
  return (
    <div className="flex justify-center gap-2 mb-3">
      {glyphs.map((g, i) => (
        <span key={i} className="text-2xl animate-pop" style={{ animationDelay: `${i * 90}ms` }}>{g}</span>
      ))}
    </div>
  );
}

export default function GameRunnerPage() {
  const params = useParams();
  const id = String((params as Record<string, string | string[]>)?.id || '');
  const game = getGame(id);
  const GameComp = REGISTRY[id];

  // Parent-set worth for this game (default 0). Drives the honest pre-game
  // badge: a valued game shows its points + that a parent has to OK them; a
  // 0-value game is just for fun.
  const { family } = useFamily();
  const gameValue = gamePointsValue(resolveGamesConfig(family?.gamesConfig), id);

  const startedAt = useRef<number>(Date.now());
  const [outcome, setOutcome] = useState<GameOutcome | null>(null);
  const [award, setAward] = useState<AwardResult | null>(null);
  const [awarding, setAwarding] = useState(false);
  const [round, setRound] = useState(0);

  const handleComplete = useCallback(async (o: GameOutcome) => {
    setOutcome(o);
    if (game && o.success) {
      setAwarding(true);
      const durationSec = Math.round((Date.now() - startedAt.current) / 1000);
      const res = await awardGame({ gameId: game.id, score: o.score, durationSec });
      setAward(res);
      setAwarding(false);
    }
  }, [game]);

  const playAgain = useCallback(() => {
    setOutcome(null);
    setAward(null);
    startedAt.current = Date.now();
    setRound((n) => n + 1);
  }, []);

  if (!game) {
    return (
      <Shell>
        <div className="text-center py-16">
          <p className="text-5xl mb-3">🕹️</p>
          <p className="font-display text-xl font-extrabold text-games-ink mb-3">Game not found</p>
          <BackLink />
        </div>
      </Shell>
    );
  }

  if (!game.built || !GameComp) {
    return (
      <Shell>
        <div className="text-center py-12">
          <div className="text-5xl mb-3">{game.icon}</div>
          <p className="font-display text-2xl font-black text-games-ink mb-1">{game.name}</p>
          <span className="inline-block bg-games-coral text-white text-xs font-extrabold px-3 py-1 rounded-full mb-4">Coming this week</span>
          <p className="text-sm text-games-ink-soft max-w-xs mx-auto mb-6">
            We&rsquo;re still building this one. It drops soon — a parent can make it worth House Points.
          </p>
          <BackLink />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-6">
        <Link href="/games" className="text-sm font-bold text-games-ink-soft">&larr; Games</Link>
        {gameValue > 0 ? (
          <span className="bg-games-gold text-games-ink text-xs font-extrabold px-2.5 py-1 rounded-full">+{gameValue} pts · parent ✓</span>
        ) : (
          <span className="bg-games-bg text-games-ink-soft text-xs font-extrabold px-2.5 py-1 rounded-full">🎮 Just for fun</span>
        )}
      </div>
      <div className="text-center mb-6">
        <div className="text-4xl mb-1">{game.icon}</div>
        <h1 className="font-display text-2xl font-black text-games-ink">{game.name}</h1>
        {game.note && <p className="text-xs font-semibold text-games-ink-soft mt-1">{game.note}</p>}
      </div>

      <GameComp key={round} onComplete={handleComplete} />

      {outcome && (
        <ResultOverlay outcome={outcome} award={award} awarding={awarding} onPlayAgain={playAgain} />
      )}
    </Shell>
  );
}

function ResultOverlay({
  outcome, award, awarding, onPlayAgain,
}: {
  outcome: GameOutcome;
  award: AwardResult | null;
  awarding: boolean;
  onPlayAgain: () => void;
}) {
  const lost = !outcome.success;
  const earned = award?.pointsAwarded ?? 0;
  const pending = award?.status === 'pending';
  const pendingPts = award?.pointsPending ?? 0;
  const won = !lost && !awarding && !award?.error && !award?.skipped;
  const title = outcome.message || (outcome.success ? 'You did it! 🎉' : 'So close!');

  return (
    <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center p-4 bg-games-ink/40">
      <div className="bg-games-card rounded-kaya-lg w-full max-w-sm p-6 text-center animate-slide-up">
        {won && <BurstRow />}
        <h2 className="font-display text-2xl font-black text-games-ink mb-1">{title}</h2>

        {lost ? (
          <p className="text-sm text-games-ink-soft mb-5">Have another go — you&rsquo;ve got this.</p>
        ) : awarding ? (
          <p className="text-sm text-games-ink-soft mb-5">Saving your game…</p>
        ) : award?.skipped ? (
          <p className="text-sm text-games-ink-soft mb-5">Nice game! (House Points are for kids&rsquo; accounts.)</p>
        ) : award?.error ? (
          <p className="text-sm text-games-coral mb-5">Couldn&rsquo;t save your game just now — try again.</p>
        ) : pending ? (
          <div className="mb-5">
            <div className="text-3xl mb-1">🐝</div>
            <p className="text-xl font-display font-black text-games-violet">Sent to a parent!</p>
            <p className="text-sm font-bold text-games-ink-soft mt-1">
              +{pendingPts} pts waiting for the OK
            </p>
            {award?.multiplier && award.multiplier > 1 && (
              <p className="text-xs font-bold text-games-teal mt-1">{award.multiplier}× young-player bonus ✨</p>
            )}
            <p className="text-[11px] font-semibold text-games-ink-soft mt-2">
              They&rsquo;ll pop into your House Points once a grown-up says yes.
            </p>
          </div>
        ) : earned > 0 ? (
          <div className="mb-5">
            <p className="text-3xl font-display font-black text-games-violet">+{earned} pts</p>
            {award?.multiplier && award.multiplier > 1 && (
              <p className="text-xs font-bold text-games-teal mt-1">{award.multiplier}× young-player bonus ✨</p>
            )}
            {typeof award?.newTotal === 'number' && (
              <p className="text-xs font-semibold text-games-ink-soft mt-1">⭐ {award.newTotal.toLocaleString()} pts total</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-games-ink-soft mb-5">Great playing! 🎮 Just for fun this time.</p>
        )}

        <div className="flex gap-2.5">
          <button type="button" onClick={onPlayAgain} className="flex-1 bg-games-violet text-white font-extrabold text-sm py-3 rounded-full">
            Play again
          </button>
          <Link href="/games" className="flex-1 bg-games-bg text-games-violet-deep font-extrabold text-sm py-3 rounded-full">
            Done
          </Link>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <div className="mx-auto max-w-md w-full px-4 pt-4 pb-28">{children}</div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/games" className="inline-block bg-games-violet text-white font-extrabold text-sm px-5 py-2.5 rounded-full">
      Back to Games
    </Link>
  );
}
