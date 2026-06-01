'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { ensureGuestAuth } from '@/lib/guestAuth';
import { getGame } from '@/lib/gamesCatalog';
import MultiDeviceRoom from '@/components/games/MultiDeviceRoom';
import TycoonRoom from '@/components/games/tycoon/TycoonRoom';
import GuestEndCard from '@/components/games/GuestEndCard';

// PUBLIC guest play page (outside the (app) auth gate). A visitor opens the
// host's link — /play/<CODE>?f=<familyId> — picks a name + kid/grown-up, joins
// the game as an anonymous guest, plays, then sees the "bring Kaya home" card.

type Phase = 'intro' | 'joining' | 'playing' | 'done' | 'error' | 'inapp';
interface Joined {
  uid: string; sessionId: string; gameId: string; familyId: string;
  referralCode?: string | null; hostFamilyName?: string; hostHandle?: string | null;
}

function GuestPlay() {
  const params = useParams();
  const search = useSearchParams();
  const code = String((params as Record<string, string | string[]>)?.code || '').toUpperCase();
  const familyId = search.get('f') || '';

  const [phase, setPhase] = useState<Phase>('intro');
  const [name, setName] = useState('');
  const [isKid, setIsKid] = useState<boolean | null>(null);
  const [err, setErr] = useState('');
  const [joined, setJoined] = useState<Joined | null>(null);

  useEffect(() => {
    const u = auth.currentUser;
    if (u && !u.isAnonymous) setPhase('inapp');
  }, []);

  const canJoin = name.trim().length >= 1 && isKid !== null && !!familyId && !!code;

  const join = async () => {
    if (!canJoin) return;
    setPhase('joining'); setErr('');
    try {
      const { uid, token } = await ensureGuestAuth();
      const res = await fetch('/api/games/guest/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ familyId, code, name: name.trim(), isKid }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.error === 'no-live-session' ? 'That game code isn’t active anymore — ask for a fresh one.' : 'Couldn’t join — try again.');
        setPhase('error'); return;
      }
      setJoined({ uid, sessionId: data.sessionId, gameId: data.gameId, familyId, referralCode: data.referralCode, hostFamilyName: data.hostFamilyName, hostHandle: data.hostHandle });
      setPhase('playing');
    } catch (e) {
      const m = String((e as Error).message || e);
      if (m === 'already-signed-in') { setPhase('inapp'); return; }
      setErr(m === 'guest-auth-disabled' ? 'Guest play isn’t switched on yet — ask the family to turn it on.' : 'Couldn’t join — try again.');
      setPhase('error');
    }
  };

  const game = joined ? getGame(joined.gameId) : undefined;

  if (phase === 'playing' && joined && game) {
    const guestIdentity = { uid: joined.uid, name: name.trim(), familyId: joined.familyId, sessionId: joined.sessionId };
    // Tycoon is a full-screen board game with its own room UI.
    if (joined.gameId === 'tycoon') {
      return <TycoonRoom guestIdentity={guestIdentity} onComplete={() => setPhase('done')} />;
    }
    return (
      <div className="min-h-screen bg-games-bg">
        <div className="mx-auto max-w-md px-4 py-6">
          <p className="text-center text-[11px] font-bold text-games-ink-soft mb-3">Playing with {joined.hostFamilyName} · you&rsquo;re a guest 👋</p>
          <MultiDeviceRoom
            game={game}
            guestIdentity={guestIdentity}
            onComplete={() => setPhase('done')}
          />
        </div>
      </div>
    );
  }

  if (phase === 'done' && joined) {
    return (
      <GuestEndCard
        isKid={isKid === true}
        guestName={name.trim() || 'friend'}
        guestUid={joined.uid}
        referralCode={joined.referralCode}
        hostFamilyName={joined.hostFamilyName}
        hostHandle={joined.hostHandle}
        hostFamilyId={joined.familyId}
      />
    );
  }

  if (phase === 'inapp') {
    return <Centered emoji="👋" title="You're on Kaya already!" body={<>Open the game in the app to join.<br /><a className="text-games-violet font-extrabold" href={`/games/join/${code}`}>Join in the app →</a></>} />;
  }

  if (phase === 'error') {
    return <Centered emoji="📡" title="Hmm…" body={<>{err}<br /><button type="button" onClick={() => setPhase('intro')} className="mt-3 text-games-violet font-extrabold">Try again</button></>} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-white flex items-center justify-center p-5">
      <div className="w-full max-w-sm text-center">
        <div className="text-5xl">🎴</div>
        <h1 className="font-display text-2xl font-black text-games-ink mt-2">You&rsquo;re invited!</h1>
        <p className="text-xs text-games-ink-soft mt-1">A Kaya family wants you to play. Room <b className="text-games-ink">{code || '— —'}</b></p>
        {!familyId && <p className="text-[11px] text-games-coral mt-2">This link is missing its room — ask for a fresh one.</p>}

        <div className="bg-white border border-games-violet/15 rounded-kaya-lg p-5 my-5 shadow-[0_4px_12px_rgba(26,18,64,0.06)] text-left">
          <p className="text-xs font-extrabold text-games-ink mb-1">Pick a name to play</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={24}
            className="w-full bg-games-bg border border-games-violet/15 rounded-kaya px-3 py-2.5 font-bold text-games-ink outline-none" />
          <p className="text-xs font-extrabold text-games-ink mt-3 mb-1.5">I&rsquo;m a…</p>
          <div className="flex gap-2">
            {([[true, '👦 Kid'], [false, '🧑 Grown-up']] as const).map(([k, label]) => (
              <button key={label} type="button" onClick={() => setIsKid(k)}
                className={`flex-1 rounded-kaya py-2.5 font-extrabold text-sm border-[1.5px] ${isKid === k ? 'border-games-violet bg-games-bg text-games-violet-deep' : 'border-games-violet/15 text-games-ink-soft'}`}>{label}</button>
            ))}
          </div>
          <button type="button" onClick={join} disabled={!canJoin || phase === 'joining'}
            className="w-full bg-games-violet text-white font-display font-extrabold py-3 rounded-full mt-4 disabled:opacity-50">{phase === 'joining' ? 'Joining…' : 'Join the game ▶'}</button>
        </div>
        <p className="text-[11px] text-games-ink-soft">🔒 No birthday, no account — we just ask so we invite you the right way after.</p>
      </div>
    </div>
  );
}

function Centered({ emoji, title, body }: { emoji: string; title: string; body: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-white flex items-center justify-center p-5 text-center">
      <div className="max-w-sm">
        <div className="text-5xl mb-2">{emoji}</div>
        <h1 className="font-display text-xl font-black text-games-ink mb-2">{title}</h1>
        <p className="text-sm text-games-ink-soft">{body}</p>
      </div>
    </div>
  );
}

export default function GuestPlayPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-games-bg" />}>
      <GuestPlay />
    </Suspense>
  );
}
