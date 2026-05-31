'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { GameDef } from '@/lib/gamesCatalog';
import type { GameOutcome } from './types';
import {
  createSession, findSessionByCode, joinSession, subscribeSession, updateSession,
  type GameSession,
} from '@/lib/gameSessions';

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
  game, onComplete, joinCode,
}: {
  game: GameDef;
  onComplete: (o: GameOutcome) => void;
  joinCode?: string;
}) {
  const { profile } = useAuth();
  const me = profile?.uid || '';
  const myName = (profile?.displayName || 'Player').split(' ')[0];
  const familyId = profile?.familyId || '';

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
      const initial = game.id === 'story-builder' ? { sentences: [], turn: 0 } : {};
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
      onComplete({ success: true, score: session.players.length, message: 'Great game together! 🎉' });
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
  return <Center>🎉 Game over!</Center>;
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
        <p className="font-display font-black tracking-[0.3em]" style={{ fontSize: 48 }}>{session.code}</p>
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
        <button
          type="button"
          disabled={session.players.length < 2}
          onClick={() => updateSession(familyId, session.id, { status: 'playing' })}
          className="w-full bg-games-violet text-white font-extrabold py-3.5 rounded-full mt-4 disabled:opacity-50"
        >
          {session.players.length < 2 ? 'Waiting for players…' : 'Start game'}
        </button>
      ) : (
        <p className="text-center text-sm text-games-ink-soft mt-4">Waiting for the host to start…</p>
      )}
    </div>
  );
}

function Play({ game, session, me, familyId }: { game: GameDef; session: GameSession; me: string; familyId: string }) {
  if (game.id === 'story-builder') return <StoryBuilderPlay session={session} me={me} familyId={familyId} />;
  return <Center>This game&rsquo;s multi-device mode is coming soon.</Center>;
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
