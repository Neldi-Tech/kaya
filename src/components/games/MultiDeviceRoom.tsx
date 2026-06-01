'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { GameDef } from '@/lib/gamesCatalog';
import type { GameOutcome } from './types';
import FamilyTriviaPlay, { triviaInitialState, TRIVIA_SUBJECTS } from './FamilyTrivia';
import { UNO_LEVELS } from '@/lib/uno';
import {
  createSession, findSessionByCode, joinSession, subscribeSession, updateSession, updateSessionFields,
  type GameSession,
} from '@/lib/gameSessions';
import { type Cell, decideTicTacToe, tttGlyph } from '@/lib/ticTacToe';
import { recordWin } from '@/lib/gamesWinClient';
import { saveStory } from '@/lib/gamesStoryClient';
import { makeProblems, type MathProblem, MATH_DASH_SECONDS } from '@/lib/mathDash';
import { pickRack, validWords, canMake, type WordRack, WORD_RACKS, WORD_SPRINT_SECONDS } from '@/lib/wordSprint';
import { spIsSolved, spShuffled, spAdjacent } from '@/lib/slidingPuzzle';
import { shuffledDeck, type MemoryCard } from '@/lib/memoryMatch';
import { type Disc, C4_COLS, C4_ROWS, c4DropRow, c4CheckWin, c4IsFull, c4DiscColor } from '@/lib/connect4';
import { slAdvance, slRollDie } from '@/lib/snakesLadders';
import SnakesLaddersBoard from './SnakesLaddersBoard';
import MazeRaceMultiPlay, { RaceConfig } from './MazeRace';
import UnoMultiPlay from './UnoMulti';

type Mode = 'choose' | 'busy' | 'in' | 'error';
interface Sentence { uid: string; name: string; text: string }

function friendlyErr(e: unknown): string {
  const msg = String((e as { message?: string })?.message || e);
  if (/permission|insufficient/i.test(msg)) return "Multiplayer isn't switched on yet — ask a parent to enable it.";
  return 'Something went wrong connecting. Try again.';
}

function Center({ children }: { children: ReactNode }) {
  return <p className="text-center text-sm text-games-ink-soft py-16">{children}</p>;
}

export default function MultiDeviceRoom({
  game, onComplete, joinCode, guestIdentity,
}: {
  game: GameDef;
  onComplete: (o: GameOutcome) => void;
  joinCode?: string;
  /** When set, this is an invited GUEST already added to a session server-side
   *  (via /api/games/guest/join). Their identity comes from here, not a family
   *  profile, and they drop straight into the room. */
  guestIdentity?: { uid: string; name: string; familyId: string; sessionId: string };
}) {
  const { profile } = useAuth();
  const me = guestIdentity?.uid || profile?.uid || '';
  const myName = guestIdentity?.name || (profile?.displayName || 'Player').split(' ')[0];
  const familyId = guestIdentity?.familyId || profile?.familyId || '';

  const [mode, setMode] = useState<Mode>('choose');
  const [err, setErr] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const awardedRef = useRef(false);

  useEffect(() => {
    if (!familyId || !sessionId) return;
    return subscribeSession(familyId, sessionId, setSession);
  }, [familyId, sessionId]);

  // A guest is already in the session (server added them) — drop straight in.
  useEffect(() => {
    if (guestIdentity?.sessionId) { setSessionId(guestIdentity.sessionId); setMode('in'); }
  }, [guestIdentity?.sessionId]);

  const doJoin = useCallback(async (code: string) => {
    if (!familyId || !me) return;
    setMode('busy'); setErr('');
    try {
      const s = await findSessionByCode(familyId, code);
      if (!s) { setErr('No game found for that code. Check it and try again.'); setMode('error'); return; }
      if (!s.players.some((p) => p.uid === me)) await joinSession(familyId, s.id, me, myName);
      setSessionId(s.id); setMode('in');
    } catch (e) { setErr(friendlyErr(e)); setMode('error'); }
  }, [familyId, me, myName]);

  const host = useCallback(async () => {
    if (!familyId || !me) return;
    setMode('busy'); setErr('');
    try {
      const initial = game.id === 'story-builder' ? { sentences: [], turn: 0 }
        : game.id === 'family-trivia' ? triviaInitialState()
        : game.id === 'tic-tac-toe' ? { board: Array(9).fill(null), turn: 0 }
        : game.id === 'connect-4' ? { board: Array(C4_ROWS * C4_COLS).fill(0), turn: 0 }
        : game.id === 'snakes-ladders' ? { pos: [0, 0], turn: 0, die: null }
        : game.id === 'math-dash' ? { problems: makeProblems(60), startAt: 0, scores: {} }
        : game.id === 'word-sprint' ? { rack: pickRack(), startAt: 0, scores: {} }
        : game.id === 'sliding-puzzle' ? { scramble: spShuffled(), moves: {} }
        : game.id === 'memory-match' ? { cards: shuffledDeck(), flipped: [], matched: [], scores: {}, turn: 0 }
        : {};
      const { id } = await createSession(familyId, me, myName, game.id, initial);
      setSessionId(id); setMode('in');
    } catch (e) { setErr(friendlyErr(e)); setMode('error'); }
  }, [familyId, me, myName, game.id]);

  useEffect(() => {
    if (joinCode && familyId && me) void doJoin(joinCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinCode, familyId, me]);

  useEffect(() => {
    if (session?.status === 'done' && !awardedRef.current) {
      awardedRef.current = true;
      const doneMessage = (session.state?.doneMessage as string) || 'Great game together! 🎉';
      onComplete({ success: true, score: session.players.length, message: doneMessage, multiplayer: true });
    }
  }, [session?.status, session?.players.length, onComplete]);

  if (mode === 'busy') return <Center>Connecting…</Center>;
  if (mode === 'error') {
    return (
      <div className="text-center py-12 mx-auto" style={{ maxWidth: 320 }}>
        <p className="text-4xl mb-3">📡</p>
        <p className="text-sm text-games-ink-soft mb-6">{err}</p>
        <button type="button" onClick={() => { setMode('choose'); setErr(''); }} className="bg-games-violet text-white font-extrabold text-sm px-5 py-2.5 rounded-full">Back</button>
      </div>
    );
  }
  if (mode === 'choose') {
    return (
      <div className="mx-auto text-center pt-6" style={{ maxWidth: 320 }}>
        <div className="text-5xl mb-2">{game.icon}</div>
        <p className="text-sm text-games-ink-soft mb-6">Play across phones — everyone joins from their own device.</p>
        <button type="button" onClick={host} className="w-full bg-games-violet text-white font-extrabold py-3.5 rounded-full mb-3">Host a game</button>
        <p className="text-xs font-bold text-games-ink-soft my-3">— or join one —</p>
        <div className="flex gap-2">
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            placeholder="CODE"
            maxLength={4}
            className="flex-1 bg-games-card rounded-kaya px-3 py-2.5 text-center font-display font-black tracking-[0.3em] text-games-ink outline-none uppercase shadow-[0_4px_12px_rgba(26,18,64,0.06)]"
          />
          <button type="button" onClick={() => doJoin(codeInput)} disabled={codeInput.length < 4} className="bg-games-violet text-white font-extrabold px-4 rounded-kaya disabled:opacity-50">Join</button>
        </div>
      </div>
    );
  }
  // mode 'in'
  if (!session) return <Center>Loading room…</Center>;
  if (session.status === 'lobby') return <Lobby session={session} me={me} familyId={familyId} />;
  if (session.status === 'playing') return <Play game={game} session={session} me={me} familyId={familyId} />;
  // A guest's end-of-game card is rendered by the public /play page (via onComplete).
  if (guestIdentity) return <Center>🎉 Great game!</Center>;
  return <WinnerView session={session} game={game} me={me} />;
}

function WinnerView({ session, game, me }: { session: GameSession; game: GameDef; me: string }) {
  const players = session.players;
  const scoresObj = session.state.scores as Record<string, number> | undefined;
  let winnerUid = session.winnerUid || '';
  if (!winnerUid && scoresObj) {
    let best = -1;
    for (const p of players) { const v = Number(scoresObj[p.uid] || 0); if (v > best) { best = v; winnerUid = p.uid; } }
    if (players.filter((p) => Number(scoresObj[p.uid] || 0) === best).length !== 1) winnerUid = '';
  }
  const winner = players.find((p) => p.uid === winnerUid);
  const collaborative = game.id === 'story-builder';
  const isHost = session.hostUid === me;
  const [streak, setStreak] = useState<number | null>(null);
  const recordedRef = useRef(false);
  const sentences = (session.state.sentences as Sentence[]) || [];
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const doSave = async () => {
    setSaveState('saving');
    const r = await saveStory(session.id);
    setSaveState(r.ok || r.alreadySaved ? 'saved' : 'error');
  };

  useEffect(() => {
    if (isHost && !recordedRef.current) {
      recordedRef.current = true;
      void recordWin(session.id).then((r) => { if (typeof r.winnerStreak === 'number') setStreak(r.winnerStreak); });
    }
  }, [isHost, session.id]);

  const ranked = scoresObj
    ? [...players].sort((a, b) => Number(scoresObj[b.uid] || 0) - Number(scoresObj[a.uid] || 0))
    : players;
  const medal = ['🥇', '🥈', '🥉'];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-games-ink/60">
      <div className="bg-games-card rounded-kaya-lg w-full max-w-sm p-6 text-center animate-slide-up">
        <div className="text-5xl mb-1">{collaborative ? '📖' : '🏆'}</div>
        <h2 className="font-display text-2xl font-black text-games-ink mb-1">
          {collaborative ? 'Great story together!' : winner ? `${winner.name} wins! 🎉` : 'Game over!'}
        </h2>
        {collaborative && (
          <>
            {sentences.length > 0 && (
              <div className="bg-games-bg rounded-kaya p-3 my-3 text-left max-h-44 overflow-y-auto text-sm leading-relaxed text-games-ink">
                {sentences.map((s, i) => (
                  <span key={i}><span className="text-games-violet font-bold">{s.name}:</span> {s.text}{' '}</span>
                ))}
              </div>
            )}
            {isHost ? (
              saveState === 'saved' ? (
                <a href="/games/stories" className="block bg-games-mint text-games-ink font-extrabold text-sm rounded-kaya py-2.5 mb-2.5">
                  ✓ Saved! Read it in your Story Gallery →
                </a>
              ) : (
                <button
                  type="button"
                  onClick={doSave}
                  disabled={saveState === 'saving' || sentences.length === 0}
                  className="w-full bg-games-violet text-white font-extrabold text-sm rounded-kaya py-2.5 mb-2.5 disabled:opacity-60"
                >
                  {saveState === 'saving' ? '✨ Saving & scoring…' : saveState === 'error' ? 'Hmm — tap to try saving again' : '💾 Save & score this story'}
                </button>
              )
            ) : (
              <p className="text-[11px] text-games-ink-soft mb-2.5">Ask the host to save this story to your gallery 📖</p>
            )}
          </>
        )}
        {!collaborative && (
          <div className="bg-games-bg rounded-kaya p-3 my-3 text-left">
            {ranked.map((p, i) => (
              <div key={p.uid} className="flex items-center justify-between py-1 text-sm">
                <span className="font-bold text-games-ink">{i < 3 ? medal[i] : `${i + 1}.`} {p.name}{p.uid === me ? ' (you)' : ''}</span>
                {scoresObj && <span className="font-display font-black text-games-violet">{Number(scoresObj[p.uid] || 0)}</span>}
              </div>
            ))}
          </div>
        )}
        {!collaborative && winner && streak != null && streak > 1 && (
          <div className="flex items-center justify-center gap-1.5 bg-[#FFEDE0] text-[#C2410C] font-extrabold text-sm rounded-kaya py-2 mb-2">🔥 {winner.name} is on a {streak}-win streak!</div>
        )}
        {!collaborative && winner && <p className="text-[11px] text-games-teal font-bold mb-3">✓ Win recorded · counts on the leaderboard</p>}
        <div className="flex gap-2.5">
          <a href={`/games/${game.id}`} className="flex-1 bg-games-violet text-white font-extrabold py-3 rounded-full">Play again</a>
          <a href="/games" className="flex-1 bg-games-bg text-games-violet-deep font-extrabold py-3 rounded-full">Done</a>
        </div>
      </div>
    </div>
  );
}

// Per-game setup chosen in the LOBBY (the main screen) before the game starts,
// so the host can lock the settings while waiting for the code + every player
// sees them. Maze Quest has its own richer RaceConfig; these are the simple
// pick-one settings. A game absent here just shows the plain Start button.
type LobbyOption = { value: string; label: string; emoji?: string; hint?: string };
const LOBBY_SETTINGS: Record<string, { key: string; label: string; options: LobbyOption[] }[]> = {
  uno: [{
    key: 'level', label: 'Difficulty',
    options: UNO_LEVELS.map((l) => ({ value: l.id, label: l.label, emoji: l.emoji, hint: `×${l.funMult}` })),
  }],
  'family-trivia': [{
    key: 'subject', label: 'Subject',
    options: TRIVIA_SUBJECTS.map((s) => ({ value: s.id, label: s.label, emoji: s.icon })),
  }],
};

/** Every required setting has been chosen → the host may start. */
function settingsReady(session: GameSession): boolean {
  const defs = LOBBY_SETTINGS[session.gameId];
  if (!defs) return true;
  return defs.every((d) => !!session.state[d.key]);
}

function LobbySettings({ session, familyId, readOnly }: { session: GameSession; familyId: string; readOnly?: boolean }) {
  const defs = LOBBY_SETTINGS[session.gameId];
  if (!defs) return null;
  return (
    <div className="bg-games-card rounded-kaya p-4 mt-4 shadow-[0_4px_12px_rgba(26,18,64,0.06)]">
      <p className="text-[11px] font-bold uppercase tracking-wider text-games-ink-soft mb-2">⚙️ Game setup{readOnly ? '' : ' — pick & lock'}</p>
      {defs.map((d) => {
        const cur = (session.state[d.key] as string) || '';
        return (
          <div key={d.key} className="mb-2.5 last:mb-0">
            <p className="text-xs font-bold text-games-ink mb-1.5">
              {d.label}
              {!cur && !readOnly && <span className="text-games-coral ml-1">• choose one</span>}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {d.options.map((o) => {
                const sel = cur === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={readOnly}
                    onClick={() => updateSessionFields(familyId, session.id, { [`state.${d.key}`]: o.value })}
                    className={`text-xs font-extrabold px-3 py-1.5 rounded-full border transition-colors ${
                      sel ? 'bg-games-violet text-white border-games-violet'
                        : `bg-games-bg text-games-ink-soft border-transparent ${readOnly ? 'opacity-40' : ''}`
                    }`}
                  >
                    {o.emoji} {o.label}{o.hint && sel ? ` ${o.hint}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Lobby({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const isHost = session.hostUid === me;
  const url = typeof window !== 'undefined' ? `${window.location.origin}/games/join/${session.code}` : '';
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const data = { title: 'Join my Kaya game!', text: `Join my game — code ${session.code}`, url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard?.writeText(`${data.text} ${url}`); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    } catch { /* user cancelled */ }
  };
  const copy = async () => {
    try { await navigator.clipboard?.writeText(session.code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* noop */ }
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <div className="rounded-kaya-lg p-5 text-white text-center bg-gradient-to-br from-games-violet to-[#9333EA]">
        <p className="text-[11px] font-bold uppercase tracking-wider opacity-90 mb-2">Room code</p>
        <p className="font-display font-black tracking-[0.3em]" style={{ fontSize: 'clamp(30px, 11vw, 48px)' }}>{session.code}</p>
        <p className="text-xs opacity-80 mt-1">Expires in 10 min</p>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button type="button" onClick={copy} className="bg-white/20 border border-white/25 rounded-kaya py-2.5 text-sm font-bold">{copied ? 'Copied ✓' : '📋 Copy code'}</button>
          <button type="button" onClick={share} className="bg-games-gold text-games-ink rounded-kaya py-2.5 text-sm font-extrabold">💬 Share to chat</button>
        </div>
      </div>

      <div className="bg-games-card rounded-kaya p-4 mt-4 shadow-[0_4px_12px_rgba(26,18,64,0.06)]">
        <p className="text-[11px] font-bold uppercase tracking-wider text-games-ink-soft mb-2">Players ({session.players.length})</p>
        {session.players.map((p) => (
          <div key={p.uid} className="flex items-center justify-between py-1.5">
            <span className="font-bold text-games-ink text-sm">{p.uid === session.hostUid ? '👑 ' : '🙂 '}{p.name}{p.uid === me ? ' (you)' : ''}</span>
            <span className="text-[11px] font-bold text-games-teal">Ready</span>
          </div>
        ))}
      </div>

      {isHost ? (
        // Maze Quest sets up its race (🏁/⏱️ + difficulty + world) right here in
        // the lobby, so the host picks while waiting. Its own button starts the
        // race (writes status:'playing'). Other games use the generic start.
        session.gameId === 'maze-quest' ? (
          <div className="mt-5 pt-4 border-t border-games-bg">
            <RaceConfig session={session} familyId={familyId} canStart={session.players.length >= 2} />
          </div>
        ) : (
          <>
            <LobbySettings session={session} familyId={familyId} />
            <button
              type="button"
              disabled={session.players.length < 2 || !settingsReady(session)}
              onClick={() => updateSession(familyId, session.id, { status: 'playing' })}
              className="w-full bg-games-violet text-white font-extrabold py-3.5 rounded-full mt-4 disabled:opacity-50"
            >
              {session.players.length < 2 ? 'Waiting for players…'
                : !settingsReady(session) ? 'Pick the setup above ☝️'
                  : 'Start game'}
            </button>
          </>
        )
      ) : (
        <>
          <LobbySettings session={session} familyId={familyId} readOnly />
          <p className="text-center text-sm text-games-ink-soft mt-4">Waiting for the host to start…</p>
        </>
      )}
    </div>
  );
}

function Play({ game, session, me, familyId }: { game: GameDef; session: GameSession; me: string; familyId: string }) {
  if (game.id === 'story-builder') return <StoryBuilderPlay session={session} me={me} familyId={familyId} />;
  if (game.id === 'family-trivia') return <FamilyTriviaPlay session={session} me={me} familyId={familyId} />;
  if (game.id === 'tic-tac-toe') return <TicTacToeMultiPlay session={session} me={me} familyId={familyId} />;
  if (game.id === 'connect-4') return <Connect4MultiPlay session={session} me={me} familyId={familyId} />;
  if (game.id === 'snakes-ladders') return <SnakesLaddersMultiPlay session={session} me={me} familyId={familyId} />;
  if (game.id === 'math-dash') return <MathDashMultiPlay session={session} me={me} familyId={familyId} />;
  if (game.id === 'word-sprint') return <WordSprintMultiPlay session={session} me={me} familyId={familyId} />;
  if (game.id === 'sliding-puzzle') return <SlidingPuzzleMultiPlay session={session} me={me} familyId={familyId} />;
  if (game.id === 'memory-match') return <MemoryMatchMultiPlay session={session} me={me} familyId={familyId} />;
  if (game.id === 'maze-quest') return <MazeRaceMultiPlay session={session} me={me} familyId={familyId} />;
  if (game.id === 'uno') return <UnoMultiPlay session={session} me={me} familyId={familyId} />;
  return <Center>This game&rsquo;s multi-device mode is coming soon.</Center>;
}

// Shared timing for the simultaneous "race" games (Math Dash, Word Sprint):
// the host stamps ONE startAt so every phone counts down together, the host
// ends the race a beat after the synced clock expires, and the winner is
// derived from state.scores by /api/games/win. Returns the live countdown.
function useRaceClock(session: GameSession, me: string, familyId: string, seconds: number) {
  const startAt = (session.state.startAt as number) || 0;
  const isHost = session.hostUid === me;

  useEffect(() => {
    if (isHost && startAt === 0) void updateSessionFields(familyId, session.id, { 'state.startAt': Date.now() });
  }, [isHost, startAt, familyId, session.id]);

  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(iv);
  }, []);

  const elapsed = startAt ? Math.max(0, (nowMs - startAt) / 1000) : 0;
  const remaining = Math.max(0, Math.ceil(seconds - elapsed));
  const localDone = startAt > 0 && elapsed >= seconds;

  useEffect(() => {
    if (isHost && startAt > 0 && elapsed >= seconds + 1.5 && session.status === 'playing') {
      void updateSession(familyId, session.id, { status: 'done' });
    }
  }, [isHost, startAt, elapsed, seconds, session.status, familyId, session.id]);

  return { startAt, remaining, localDone, seconds };
}

// Live, sorted score strip shown under every race game.
function RaceScoreboard({ session, me }: { session: GameSession; me: string }) {
  const scores = (session.state.scores as Record<string, number>) || {};
  const ranked = [...session.players].sort((a, b) => (scores[b.uid] || 0) - (scores[a.uid] || 0));
  return (
    <div className="bg-games-bg rounded-kaya p-3 mt-4">
      {ranked.map((p, i) => (
        <div key={p.uid} className="flex justify-between text-sm py-0.5">
          <span className="font-bold text-games-ink">{i === 0 ? '👑 ' : ''}{p.name}{p.uid === me ? ' (you)' : ''}</span>
          <span className="font-display font-black text-games-violet">{scores[p.uid] || 0}</span>
        </div>
      ))}
    </div>
  );
}

// Two-phone Math Dash race. Everyone gets the SAME problem bank + a synced
// timer; each player races through at their own pace and the top score wins.
function MathDashMultiPlay({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const problems = (session.state.problems as MathProblem[]) || [];
  const { startAt, remaining, localDone, seconds } = useRaceClock(session, me, familyId, MATH_DASH_SECONDS);
  const [idx, setIdx] = useState(0);
  const [myScore, setMyScore] = useState(0);
  const [flash, setFlash] = useState<'ok' | 'no' | null>(null);
  const problem = problems.length ? problems[idx % problems.length] : null;

  const answer = (c: number) => {
    if (localDone || !problem) return;
    const ok = c === problem.answer;
    setFlash(ok ? 'ok' : 'no');
    if (ok) {
      const ns = myScore + 1;
      setMyScore(ns);
      void updateSessionFields(familyId, session.id, { [`state.scores.${me}`]: ns });
    }
    window.setTimeout(() => { setFlash(null); setIdx((i) => i + 1); }, 180);
  };

  if (startAt === 0) return <Center>Get ready… 🏁</Center>;

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-games-ink-soft">You: {myScore}</span>
        <span className={`text-xs font-bold ${remaining <= 5 ? 'text-games-coral' : 'text-games-ink-soft'}`}>⏱ {remaining}s</span>
      </div>
      <div className="h-1.5 rounded-full bg-games-bg mb-4 overflow-hidden">
        <div className="h-full bg-games-teal" style={{ width: `${(remaining / seconds) * 100}%`, transition: 'width 0.25s linear' }} />
      </div>
      {localDone ? (
        <p className="text-center text-sm font-extrabold text-games-ink py-6">⏱ Time! Final scores…</p>
      ) : problem ? (
        <>
          <div className={`rounded-kaya-lg py-7 text-center mb-4 font-display font-black text-4xl text-games-ink transition-colors ${
            flash === 'ok' ? 'bg-games-mint' : flash === 'no' ? 'bg-[#FFE4E4]' : 'bg-games-card'
          }`}>{problem.text} = ?</div>
          <div className="grid grid-cols-2 gap-2.5">
            {problem.choices.map((c) => (
              <button key={c} type="button" onClick={() => answer(c)} disabled={localDone}
                className="bg-games-card rounded-kaya py-4 font-display font-extrabold text-xl text-games-violet shadow-[0_4px_12px_rgba(26,18,64,0.06)] active:scale-95 transition-transform">{c}</button>
            ))}
          </div>
        </>
      ) : null}
      <RaceScoreboard session={session} me={me} />
    </div>
  );
}

// Two-phone Word Sprint race. Everyone gets the SAME rack + a synced timer;
// most valid words when time runs out wins.
function WordSprintMultiPlay({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const rack = (session.state.rack as WordRack) || WORD_RACKS[0];
  const { startAt, remaining, localDone, seconds } = useRaceClock(session, me, familyId, WORD_SPRINT_SECONDS);
  const valid = useMemo(() => new Set(validWords(rack)), [rack]);
  const [input, setInput] = useState('');
  const [found, setFound] = useState<string[]>([]);
  const [msg, setMsg] = useState('Spell words with these letters');

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (localDone) return;
    const w = input.trim().toLowerCase();
    setInput('');
    if (w.length < 3) { setMsg('Words need 3+ letters'); return; }
    if (found.includes(w)) { setMsg(`Already found "${w}"`); return; }
    if (valid.has(w) && canMake(w, rack.letters)) {
      const nf = [w, ...found];
      setFound(nf);
      setMsg(`✓ Nice — "${w}"`);
      void updateSessionFields(familyId, session.id, { [`state.scores.${me}`]: nf.length });
    } else setMsg(`"${w}" isn't in this puzzle`);
  };

  if (startAt === 0) return <Center>Get ready… 🏁</Center>;

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-games-ink-soft">Found: {found.length}</span>
        <span className={`text-xs font-bold ${remaining <= 5 ? 'text-games-coral' : 'text-games-ink-soft'}`}>⏱ {remaining}s</span>
      </div>
      <div className="h-1.5 rounded-full bg-games-bg mb-3 overflow-hidden">
        <div className="h-full bg-games-teal" style={{ width: `${(remaining / seconds) * 100}%`, transition: 'width 0.25s linear' }} />
      </div>
      <div className="flex justify-center gap-1.5 mb-3">
        {rack.letters.split('').map((ch, i) => (
          <span key={i} className="w-9 h-10 rounded-kaya-sm bg-gradient-to-br from-games-violet to-games-violet-deep text-white font-display font-black flex items-center justify-center text-lg">{ch}</span>
        ))}
      </div>
      {localDone ? (
        <p className="text-center text-sm font-extrabold text-games-ink py-3">⏱ Time! Final scores…</p>
      ) : (
        <>
          <form onSubmit={submit} className="flex gap-2 mb-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="type a word" autoCapitalize="none" autoCorrect="off"
              className="flex-1 bg-games-card rounded-kaya px-3 py-2.5 text-sm font-bold text-games-ink outline-none shadow-[0_4px_12px_rgba(26,18,64,0.06)]" />
            <button type="submit" className="bg-games-violet text-white font-extrabold px-4 rounded-kaya">Add</button>
          </form>
          <p className="text-[11px] font-semibold text-games-ink-soft mb-2 h-4">{msg}</p>
          <div className="flex flex-wrap gap-1.5">
            {found.map((w) => (<span key={w} className="bg-games-mint text-games-ink text-[11px] font-bold px-2 py-1 rounded-full">{w}</span>))}
          </div>
        </>
      )}
      <RaceScoreboard session={session} me={me} />
    </div>
  );
}

// Two-phone Sliding Puzzle race. Everyone starts from the SAME scramble on
// their own board; the FIRST to solve wins. Live move-counts show progress.
function SlidingPuzzleMultiPlay({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const movesMap = (session.state.moves as Record<string, number>) || {};
  const players = session.players;
  const someoneWon = !!session.winnerUid;

  const [tiles, setTiles] = useState<number[]>(() => (session.state.scramble as number[]) || spShuffled());
  const [myMoves, setMyMoves] = useState(0);
  const solvedRef = useRef(false);
  const blank = tiles.indexOf(0);

  const tap = (i: number) => {
    if (someoneWon || solvedRef.current || !spAdjacent(i, blank)) return;
    const nt = [...tiles];
    [nt[i], nt[blank]] = [nt[blank], nt[i]];
    setTiles(nt);
    const m = myMoves + 1;
    setMyMoves(m);
    if (spIsSolved(nt)) {
      solvedRef.current = true;
      void updateSession(familyId, session.id, {
        winnerUid: me, status: 'done',
        state: { ...session.state, moves: { ...movesMap, [me]: m } },
      });
    } else {
      void updateSessionFields(familyId, session.id, { [`state.moves.${me}`]: m });
    }
  };

  if (!session.state.scramble) return <Center>Get ready… 🏁</Center>;

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <p className="text-center text-xs font-bold text-games-ink-soft mb-2">🧩 First to solve wins! · your moves: {myMoves}</p>
      <div className="grid grid-cols-3 gap-2 mx-auto" style={{ width: 'min(100%, 260px)' }}>
        {tiles.map((v, i) => (v === 0 ? (
          <div key={i} className="aspect-square rounded-kaya bg-games-bg" />
        ) : (
          <button key={i} type="button" onClick={() => tap(i)} disabled={someoneWon}
            className="aspect-square rounded-kaya bg-gradient-to-br from-games-violet to-games-violet-deep text-white font-display font-black text-2xl shadow-[0_4px_12px_rgba(26,18,64,0.12)] active:scale-95 transition-transform">{v}</button>
        )))}
      </div>
      <div className="bg-games-bg rounded-kaya p-3 mt-4">
        {players.map((p) => (
          <div key={p.uid} className="flex justify-between text-sm py-0.5">
            <span className="font-bold text-games-ink">{p.name}{p.uid === me ? ' (you)' : ''}</span>
            <span className="font-display font-black text-games-violet">{movesMap[p.uid] || 0}<span className="text-[10px] text-games-ink-soft ml-0.5">moves</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Two-phone Memory Match. Shared board in session.state; players take turns
// (a match keeps your go), each on their own device. Most pairs wins. Only the
// player on turn writes, and that same device resolves the 2-card flip.
function MemoryMatchMultiPlay({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const cards = (session.state.cards as MemoryCard[]) || [];
  const flipped = (session.state.flipped as number[]) || [];
  const matched = (session.state.matched as number[]) || [];
  const scores = (session.state.scores as Record<string, number>) || {};
  const turn = (session.state.turn as number) || 0;
  const players = session.players;
  const currentIdx = players.length ? turn % players.length : 0;
  const isMyTurn = players[currentIdx]?.uid === me;
  const matchedSet = new Set(matched);

  const flip = (i: number) => {
    if (!isMyTurn || flipped.length >= 2 || flipped.includes(i) || matchedSet.has(i)) return;
    void updateSessionFields(familyId, session.id, { 'state.flipped': [...flipped, i] });
  };

  // The on-turn player's device resolves a 2-card flip (single writer → no race).
  const resolveRef = useRef('');
  useEffect(() => {
    if (!isMyTurn || flipped.length !== 2) return;
    const key = flipped.join('-');
    if (resolveRef.current === key) return;
    resolveRef.current = key;
    const [a, b] = flipped;
    const isMatch = cards[a]?.emoji === cards[b]?.emoji;
    const t = window.setTimeout(() => {
      if (isMatch) {
        const nm = [...matched, a, b];
        const ns = { ...scores, [me]: (scores[me] || 0) + 1 };
        if (nm.length >= cards.length) {
          void updateSession(familyId, session.id, { state: { cards, flipped: [], matched: nm, scores: ns, turn }, status: 'done' });
        } else {
          void updateSessionFields(familyId, session.id, { 'state.matched': nm, 'state.scores': ns, 'state.flipped': [] });
        }
      } else {
        void updateSessionFields(familyId, session.id, { 'state.flipped': [], 'state.turn': turn + 1 });
      }
    }, isMatch ? 500 : 900);
    return () => window.clearTimeout(t);
  }, [isMyTurn, flipped, cards, matched, scores, turn, me, familyId, session.id]);

  const turnName = players[currentIdx]?.name || 'Player';

  if (cards.length === 0) return <Center>Get ready… 🏁</Center>;

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <div className="flex items-center justify-center gap-2 mb-3 flex-wrap text-xs font-extrabold">
        {players.map((p, i) => (
          <span key={p.uid} className={`px-2.5 py-1 rounded-full ${i === currentIdx ? 'bg-games-violet text-white' : 'bg-games-bg text-games-ink-soft'}`}>
            {p.name}{p.uid === me ? ' (you)' : ''} · {scores[p.uid] || 0}
          </span>
        ))}
      </div>
      <p className="text-center text-sm font-extrabold mb-3">
        {isMyTurn ? <span className="text-games-violet">Your turn — flip two!</span> : <span className="text-games-ink-soft">Waiting for {turnName}…</span>}
      </p>
      <div className="grid grid-cols-4 gap-2.5">
        {cards.map((c, i) => {
          const show = flipped.includes(i) || matchedSet.has(i);
          return (
            <button key={c.key} type="button" onClick={() => flip(i)} disabled={!isMyTurn || show || flipped.length >= 2}
              aria-label={show ? c.emoji : 'Hidden card'}
              className={`aspect-square rounded-kaya flex items-center justify-center text-2xl select-none transition-all ${
                show ? 'bg-games-card shadow-[0_4px_12px_rgba(26,18,64,0.08)]' : 'bg-gradient-to-br from-games-violet to-games-violet-deep text-white/90'
              } ${matchedSet.has(i) ? 'opacity-60' : ''}`}>
              {show ? c.emoji : '?'}
            </button>
          );
        })}
      </div>
      {!isMyTurn && <p className="text-center text-[11px] text-games-ink-soft mt-3">Watch — it&rsquo;s {turnName}&rsquo;s turn 👀</p>}
    </div>
  );
}

// Two-device Tic-Tac-Toe. players[0] is ❌ (the host), players[1] is ⭕; any
// further joiners watch. The board + whose-turn live in session.state and
// sync through Firestore; only the player on turn can move.
function TicTacToeMultiPlay({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const board = (session.state.board as Cell[]) || Array(9).fill(null);
  const turn = (session.state.turn as number) || 0;
  const players = session.players;
  const myIndex = players.findIndex((p) => p.uid === me);
  const mySymbol: Cell = myIndex === 0 ? 'X' : myIndex === 1 ? 'O' : null;
  const currentIdx = turn % 2;                 // 0 → ❌'s turn, 1 → ⭕'s turn
  const myTurn = mySymbol != null && currentIdx === myIndex;

  const play = async (i: number) => {
    if (!myTurn || board[i] || mySymbol == null) return;
    const next = [...board];
    next[i] = mySymbol;
    const result = decideTicTacToe(next);
    if (result) {
      const draw = result === 'draw';
      const winnerIdx = result === 'X' ? 0 : 1;
      const winnerName = players[winnerIdx]?.name || result;
      const doneMessage = draw ? "It's a draw 🤝" : `${tttGlyph(result)} ${winnerName} wins! 🎉`;
      await updateSession(familyId, session.id, {
        state: { board: next, turn: turn + 1, doneMessage },
        status: 'done',
        ...(draw ? {} : { winnerUid: players[winnerIdx]?.uid }),
      });
    } else {
      await updateSession(familyId, session.id, { state: { board: next, turn: turn + 1 } });
    }
  };

  const xName = players[0]?.name || 'Player 1';
  const oName = players[1]?.name || 'Player 2';
  const turnName = currentIdx === 0 ? xName : oName;

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <div className="flex items-center justify-center gap-3 mb-2 text-xs font-bold">
        <span className={currentIdx === 0 ? 'text-games-violet' : 'text-games-ink-soft'}>❌ {xName}{myIndex === 0 ? ' (you)' : ''}</span>
        <span className="text-games-ink-soft">vs</span>
        <span className={currentIdx === 1 ? 'text-games-coral' : 'text-games-ink-soft'}>⭕ {oName}{myIndex === 1 ? ' (you)' : ''}</span>
      </div>
      <p className="text-center text-sm font-extrabold mb-3">
        {myTurn
          ? <span className="text-games-violet">Your turn {tttGlyph(mySymbol)}</span>
          : <span className="text-games-ink-soft">Waiting for {turnName}…</span>}
      </p>
      <div className="grid grid-cols-3 gap-2.5">
        {board.map((cell, i) => (
          <button
            key={i}
            type="button"
            onClick={() => play(i)}
            disabled={!myTurn || !!cell}
            aria-label={`Square ${i + 1}${cell ? `, ${cell}` : ''}`}
            className={`aspect-square rounded-kaya bg-games-card shadow-[0_4px_12px_rgba(26,18,64,0.08)] flex items-center justify-center font-display font-black select-none transition-transform active:scale-95 ${
              cell || !myTurn ? '' : 'hover:-translate-y-0.5'
            }`}
            style={{ fontSize: 44 }}
          >
            <span className={cell === 'X' ? 'text-games-violet' : 'text-games-coral'}>{cell ?? ''}</span>
          </button>
        ))}
      </div>
      {mySymbol == null && <p className="text-center text-[11px] text-games-ink-soft mt-3">You&rsquo;re watching this game 👀</p>}
    </div>
  );
}

function StoryBuilderPlay({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const sentences = (session.state.sentences as Sentence[]) || [];
  const turn = (session.state.turn as number) || 0;
  const players = session.players;
  const target = players.length * 2;
  const currentIdx = players.length ? turn % players.length : 0;
  const myTurn = players[currentIdx]?.uid === me;
  const isHost = session.hostUid === me;
  const [text, setText] = useState('');

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    const myName = players.find((p) => p.uid === me)?.name || 'Me';
    const next = [...sentences, { uid: me, name: myName, text: t }];
    setText('');
    const done = next.length >= target;
    await updateSession(familyId, session.id, {
      state: { sentences: next, turn: turn + 1 },
      ...(done ? { status: 'done' as const } : {}),
    });
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <p className="text-center text-xs font-bold text-games-ink-soft mb-3">📖 Story Builder · {sentences.length}/{target} sentences</p>
      <div className="bg-games-card rounded-kaya p-4 mb-4 shadow-[0_4px_12px_rgba(26,18,64,0.06)] min-h-[120px] text-sm leading-relaxed text-games-ink">
        {sentences.length === 0 ? (
          <span className="text-games-ink-soft">The story starts with the first sentence…</span>
        ) : (
          sentences.map((s, i) => (
            <span key={i}><span className="text-games-violet font-bold">{s.name}:</span> {s.text}{' '}</span>
          ))
        )}
      </div>

      {myTurn ? (
        <div className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a sentence…" maxLength={120}
            className="flex-1 bg-games-card rounded-kaya px-3 py-2.5 text-sm font-semibold text-games-ink outline-none shadow-[0_4px_12px_rgba(26,18,64,0.06)]" />
          <button type="button" onClick={add} className="bg-games-violet text-white font-extrabold px-4 rounded-kaya">Add</button>
        </div>
      ) : (
        <p className="text-center text-sm text-games-ink-soft py-2">It&rsquo;s <b>{players[currentIdx]?.name}</b>&rsquo;s turn…</p>
      )}

      {isHost && sentences.length > 0 && (
        <button type="button" onClick={() => updateSession(familyId, session.id, { status: 'done' })} className="w-full text-xs font-bold text-games-ink-soft underline mt-4">
          Finish the story
        </button>
      )}
    </div>
  );
}

// Two-device Connect 4. players[0] is 🔴 (host), players[1] is 🟡; further
// joiners watch. The board + whose-turn live in session.state and sync through
// Firestore; only the player on turn can drop a disc.
function Connect4MultiPlay({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const board = (session.state.board as Disc[]) || Array(C4_ROWS * C4_COLS).fill(0);
  const turn = (session.state.turn as number) || 0;
  const players = session.players;
  const myIndex = players.findIndex((p) => p.uid === me);
  const isPlayer = myIndex === 0 || myIndex === 1; // index >= 2 = spectator
  const myDisc: Disc = myIndex === 1 ? 2 : 1;      // seated player's disc (used only when isPlayer)
  const currentIdx = turn % 2;                     // 0 → 🔴's turn, 1 → 🟡's turn
  const myTurn = isPlayer && currentIdx === myIndex;

  const drop = async (c: number) => {
    if (!myTurn) return;
    const idx = c4DropRow(board, c);
    if (idx < 0) return;
    const next = [...board];
    next[idx] = myDisc;
    const w = c4CheckWin(next, idx);
    if (w) {
      const winnerIdx = w === 1 ? 0 : 1;
      const winnerName = players[winnerIdx]?.name || (w === 1 ? 'Red' : 'Yellow');
      const doneMessage = `${w === 1 ? '🔴' : '🟡'} ${winnerName} wins! 🎉`;
      await updateSession(familyId, session.id, {
        state: { board: next, turn: turn + 1, doneMessage },
        status: 'done',
        winnerUid: players[winnerIdx]?.uid,
      });
    } else if (c4IsFull(next)) {
      await updateSession(familyId, session.id, {
        state: { board: next, turn: turn + 1, doneMessage: "It's a draw 🤝" },
        status: 'done',
      });
    } else {
      await updateSession(familyId, session.id, { state: { board: next, turn: turn + 1 } });
    }
  };

  const redName = players[0]?.name || 'Player 1';
  const yellowName = players[1]?.name || 'Player 2';
  const turnName = currentIdx === 0 ? redName : yellowName;

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <div className="flex items-center justify-center gap-3 mb-2 text-xs font-bold">
        <span className={currentIdx === 0 ? 'text-games-coral' : 'text-games-ink-soft'}>🔴 {redName}{myIndex === 0 ? ' (you)' : ''}</span>
        <span className="text-games-ink-soft">vs</span>
        <span className={currentIdx === 1 ? 'text-games-gold' : 'text-games-ink-soft'}>🟡 {yellowName}{myIndex === 1 ? ' (you)' : ''}</span>
      </div>
      <p className="text-center text-sm font-extrabold mb-3">
        {myTurn
          ? <span className="text-games-violet">Your turn {myDisc === 1 ? '🔴' : '🟡'}</span>
          : <span className="text-games-ink-soft">Waiting for {turnName}…</span>}
      </p>
      <div className="grid grid-cols-7 gap-1.5 p-2 rounded-kaya bg-games-violet" style={{ width: 'min(100%, 320px)', margin: '0 auto' }}>
        {board.map((v, i) => (
          <button
            key={i}
            type="button"
            onClick={() => drop(i % C4_COLS)}
            disabled={!myTurn}
            className="aspect-square rounded-full flex items-center justify-center"
            style={{ background: c4DiscColor(v) }}
            aria-label={`Column ${(i % C4_COLS) + 1}`}
          />
        ))}
      </div>
      <p className="text-center text-[11px] text-games-ink-soft mt-3">
        {!isPlayer ? 'You’re watching this game 👀' : 'Tap a column to drop your disc · 4 in a row wins'}
      </p>
    </div>
  );
}

// Two-device Snakes & Ladders. players[0] is 🔴, players[1] is 🟡; further
// joiners watch. pos / whose-roll / last die live in session.state. The player
// on turn rolls on their own device (client RNG) and writes the result; the
// other just watches the synced board.
function SnakesLaddersMultiPlay({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const pos = (session.state.pos as [number, number]) || [0, 0];
  const turn = (session.state.turn as number) || 0; // player index whose roll it is (0 | 1)
  const die = (session.state.die as number | null) ?? null;
  const players = session.players;
  const myIndex = players.findIndex((p) => p.uid === me);
  const isPlayer = myIndex === 0 || myIndex === 1;
  const myTurn = isPlayer && turn === myIndex;

  const roll = async () => {
    if (!myTurn) return;
    const d = slRollDie();
    const next = slAdvance(pos[myIndex], d);
    const np: [number, number] = myIndex === 0 ? [next, pos[1]] : [pos[0], next];
    if (next === 100) {
      const name = players[myIndex]?.name || (myIndex === 0 ? 'Player 1' : 'Player 2');
      const doneMessage = `${myIndex === 0 ? '🔴' : '🟡'} ${name} wins! 🎉`;
      await updateSession(familyId, session.id, {
        state: { pos: np, turn, die: d, doneMessage },
        status: 'done',
        winnerUid: players[myIndex]?.uid,
      });
    } else {
      await updateSession(familyId, session.id, { state: { pos: np, turn: turn === 0 ? 1 : 0, die: d } });
    }
  };

  const p1Name = players[0]?.name || 'Player 1';
  const p2Name = players[1]?.name || 'Player 2';
  const turnName = turn === 0 ? p1Name : p2Name;

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <div className="flex items-center justify-center gap-3 mb-2 text-xs font-bold">
        <span className={turn === 0 ? 'text-games-coral' : 'text-games-ink-soft'}>🔴 {p1Name}{myIndex === 0 ? ' (you)' : ''} · {pos[0]}</span>
        <span className="text-games-ink-soft">vs</span>
        <span className={turn === 1 ? 'text-games-gold' : 'text-games-ink-soft'}>🟡 {p2Name}{myIndex === 1 ? ' (you)' : ''} · {pos[1]}</span>
      </div>
      <SnakesLaddersBoard pos={pos} />
      <div className="flex items-center justify-center gap-4 mt-5">
        <p className="text-sm font-extrabold text-center">
          {myTurn
            ? <span className="text-games-violet">Your roll!</span>
            : <span className="text-games-ink-soft">Waiting for {turnName}…</span>}
        </p>
        <button
          type="button"
          onClick={roll}
          disabled={!myTurn}
          className="bg-games-violet text-white font-display font-black text-xl w-16 h-16 rounded-kaya shadow-[0_4px_12px_rgba(26,18,64,0.15)] active:scale-90 transition-transform disabled:opacity-50"
        >
          {die ?? '🎲'}
        </button>
      </div>
      {!isPlayer && <p className="text-center text-[11px] text-games-ink-soft mt-3">You’re watching this game 👀</p>}
    </div>
  );
}
