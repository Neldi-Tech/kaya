'use client';

// Kaya Tycoon — multi-device room. The unified model: one room; seats are
// either LOCAL (played on the host's device, pass-and-play) or remote (claimed
// by another phone via code/QR/link — family or guest); a seatless device can
// "watch as the board" = projector/Display. Reuses the shared gameSessions
// room infra (Firestore) + the public /play guest link. No rules change.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useAuth } from '@/contexts/AuthContext';
import {
  createSession, findSessionByCode, joinSession, subscribeSession, updateSession,
  type GameSession,
} from '@/lib/gameSessions';
import {
  TOKENS, LOCAL_SEAT, createGame, serialize, type Seat, type GameConfig,
} from '@/lib/tycoon';
import TycoonStyles from './TycoonStyles';
import SetupScreen from './SetupScreen';
import TycoonRoomPlay from './TycoonRoomPlay';

type Mode = 'choose' | 'config' | 'busy' | 'in' | 'error';
const GAME_TTL_MS = 3 * 60 * 60 * 1000; // 3h — comfortably outlasts a long game

interface GuestIdentity { uid: string; name: string; familyId: string; sessionId: string }

function firstFreeToken(seats: Seat[]): string {
  return TOKENS.find((t) => !seats.some((s) => s.token === t)) || TOKENS[seats.length % TOKENS.length];
}

export default function TycoonRoom({ guestIdentity, onComplete }: { guestIdentity?: GuestIdentity; onComplete?: () => void }) {
  const { profile } = useAuth();
  const me = guestIdentity?.uid || profile?.uid || '';
  const myName = guestIdentity?.name || (profile?.displayName || 'Player').split(' ')[0];
  const familyId = guestIdentity?.familyId || profile?.familyId || '';
  const isGuest = !!guestIdentity;

  const [mode, setMode] = useState<Mode>('choose');
  const [err, setErr] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [asDisplay, setAsDisplay] = useState(false);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!familyId || !sessionId) return;
    return subscribeSession(familyId, sessionId, setSession);
  }, [familyId, sessionId]);

  // A guest was added to the session server-side → drop straight in.
  useEffect(() => {
    if (guestIdentity?.sessionId) { setSessionId(guestIdentity.sessionId); setMode('in'); }
  }, [guestIdentity?.sessionId]);

  // Guests bubble the end-of-game up to /play (→ "bring Kaya home" card).
  useEffect(() => {
    if (isGuest && session?.status === 'done' && !completedRef.current) {
      completedRef.current = true; onComplete?.();
    }
  }, [isGuest, session?.status, onComplete]);

  const friendlyErr = (e: unknown) => {
    const msg = String((e as { message?: string })?.message || e);
    if (/permission|insufficient/i.test(msg)) return "Multiplayer isn't switched on yet — ask a parent to enable it.";
    return 'Something went wrong connecting. Try again.';
  };

  const createRoom = useCallback(async (config: GameConfig) => {
    if (!familyId || !me) return;
    setMode('busy'); setErr('');
    try {
      const hostSeat: Seat = { id: 0, name: myName, token: TOKENS[0], ownerUid: me };
      const initial = { config, snap: null, events: [], seq: 0, seats: [hostSeat], log: [] as string[] };
      const { id } = await createSession(familyId, me, myName, 'tycoon', initial);
      setSessionId(id); setMode('in');
    } catch (e) { setErr(friendlyErr(e)); setMode('error'); }
  }, [familyId, me, myName]);

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

  function Frame({ children }: { children: ReactNode }) {
    return (
      <div className="kt-root" style={{ position: 'fixed', inset: 0, zIndex: 50, overflowY: 'auto', background: 'linear-gradient(135deg,#1A1240,#2A1A63)' }}>
        <TycoonStyles />
        <div className="kt-topbar">
          {isGuest ? <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>👋 Guest</span> : <Link href="/games">&larr; Games</Link>}
          <span className="kt-tb-title">🎲 Kaya Tycoon</span>
        </div>
        {children}
      </div>
    );
  }

  if (mode === 'busy') return <Frame><p className="kt-small-note" style={{ textAlign: 'center', padding: 40 }}>Connecting…</p></Frame>;
  if (mode === 'error') {
    return (
      <Frame>
        <div style={{ textAlign: 'center', padding: 40, color: '#fff' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📡</div>
          <p className="kt-small-note">{err}</p>
          <button type="button" className="kt-btn-ghost" style={{ marginTop: 12 }} onClick={() => { setMode('choose'); setErr(''); }}>Back</button>
        </div>
      </Frame>
    );
  }

  if (mode === 'config') {
    return <Frame><SetupScreen variant="host" onStart={createRoom} /></Frame>;
  }

  if (mode === 'choose') {
    return (
      <Frame>
        <div className="kt-setup" style={{ maxWidth: 420 }}>
          <div className="kt-logo" style={{ fontSize: 'clamp(30px,7vw,46px)' }}>KAYA TYCOON</div>
          <div className="kt-tag">📲 Everyone on their own device · 📺 big-screen · 👋 guests welcome</div>
          <div className="kt-card" style={{ textAlign: 'center' }}>
            <button type="button" className="kt-btn-go" style={{ width: '100%' }} onClick={() => setMode('config')}>🎲 Host a game</button>
            <p className="kt-small-note" style={{ margin: '14px 0 6px' }}>— or join one —</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} placeholder="CODE" maxLength={4}
                style={{ flex: 1, textAlign: 'center', letterSpacing: 4, fontWeight: 900, textTransform: 'uppercase' }} />
              <button type="button" className="kt-btn-primary" disabled={codeInput.length < 4} onClick={() => doJoin(codeInput)}>Join</button>
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  // mode 'in'
  if (!session) return <Frame><p className="kt-small-note" style={{ textAlign: 'center', padding: 40 }}>Loading room…</p></Frame>;
  if (session.status === 'lobby') {
    return (
      <Frame>
        <Lobby session={session} familyId={familyId} me={me} myName={myName} isGuest={isGuest}
          asDisplay={asDisplay} setAsDisplay={setAsDisplay} />
      </Frame>
    );
  }
  // playing / done
  return (
    <Frame>
      <TycoonRoomPlay session={session} familyId={familyId} myUid={me} display={asDisplay} />
    </Frame>
  );
}

// ── Lobby ───────────────────────────────────────────────────────────────────
function Lobby({
  session, familyId, me, myName, isGuest, asDisplay, setAsDisplay,
}: {
  session: GameSession; familyId: string; me: string; myName: string; isGuest: boolean;
  asDisplay: boolean; setAsDisplay: (b: boolean) => void;
}) {
  const seats: Seat[] = (session.state.seats as Seat[]) || [];
  const isHost = session.hostUid === me;
  const mySeat = seats.find((s) => s.ownerUid === me);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState('');
  const [addName, setAddName] = useState('');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const guestLink = `${origin}/play/${session.code}?f=${familyId}`;

  useEffect(() => {
    QRCode.toDataURL(guestLink, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [guestLink]);

  const writeSeats = useCallback((next: Seat[]) => {
    const reindexed = next.map((s, i) => ({ ...s, id: i }));
    void updateSession(familyId, session.id, { 'state.seats': reindexed } as Record<string, unknown>);
  }, [familyId, session.id]);

  // Auto-claim a seat for a non-display device that doesn't have one yet.
  useEffect(() => {
    if (asDisplay || mySeat || seats.length >= 6) return;
    writeSeats([...seats, { id: seats.length, name: myName, token: firstFreeToken(seats), ownerUid: me }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asDisplay, !!mySeat, seats.length]);

  const setMyToken = (token: string) => {
    if (!mySeat || seats.some((s) => s.token === token && s.ownerUid !== me)) return;
    writeSeats(seats.map((s) => (s.ownerUid === me && s.id === mySeat.id ? { ...s, token } : s)));
  };
  const addLocal = () => {
    if (seats.length >= 6) return;
    const nm = addName.trim() || `Player ${seats.length + 1}`;
    writeSeats([...seats, { id: seats.length, name: nm, token: firstFreeToken(seats), ownerUid: LOCAL_SEAT }]);
    setAddName('');
  };
  const removeSeat = (id: number) => writeSeats(seats.filter((s) => s.id !== id));
  const becomeDisplay = () => { if (mySeat) removeSeat(mySeat.id); setAsDisplay(true); };

  const config = session.state.config as GameConfig | undefined;
  const start = () => {
    if (!config || seats.length < 2) return;
    const players = seats.map((s) => ({ name: s.name, token: s.token }));
    const g = createGame({ ...config, players });
    void updateSession(familyId, session.id, {
      state: { config: { ...config, players }, snap: serialize(g), events: [], seq: 0, seats, log: [`🎉 Kaya Tycoon — ${g.sub}! ${players.length} players. ${players[0].name} goes first.`] },
      status: 'playing',
      expiresAt: Date.now() + GAME_TTL_MS,
    } as Record<string, unknown>);
  };

  const copy = async () => { try { await navigator.clipboard?.writeText(session.code); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* noop */ } };
  const share = async () => {
    const data = { title: 'Join my Kaya Tycoon game!', text: `Join my game — code ${session.code}`, url: guestLink };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard?.writeText(`${data.text} ${guestLink}`); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } } catch { /* cancelled */ }
  };

  const tokenLabel = (s: Seat) => (s.ownerUid === LOCAL_SEAT ? '📱 this device' : s.ownerUid === session.hostUid ? '👑 host' : s.ownerUid === me ? '📲 you' : '📲 own device');

  return (
    <div className="kt-setup" style={{ maxWidth: 460 }}>
      <div className="kt-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, opacity: 0.8 }}>Room code</div>
        <div className="kt-logo" style={{ fontSize: 'clamp(34px,12vw,52px)', letterSpacing: 8 }}>{session.code}</div>
        {qr && <img src={qr} alt="Scan to join" width={150} height={150} style={{ borderRadius: 12, margin: '8px auto', background: '#fff', padding: 6 }} />}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 6 }}>
          <button type="button" className="kt-btn-ghost" onClick={copy}>{copied ? 'Copied ✓' : '📋 Copy code'}</button>
          <button type="button" className="kt-btn-warn" onClick={share}>💬 Share link</button>
        </div>
        <p className="kt-small-note">Family taps the code in the app · anyone can scan the QR / open the link to join as a guest 👋</p>
      </div>

      <div className="kt-card">
        <h3>Players ({seats.length}/6)</h3>
        {seats.length === 0 && <p className="kt-small-note">No players yet — claim a seat or add one below.</p>}
        {seats.map((s) => (
          <div key={s.id} className="kt-pl-row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, color: '#fff' }}>{s.token} {s.name} <small style={{ opacity: 0.65 }}>{tokenLabel(s)}</small></span>
            {(isHost && s.ownerUid === LOCAL_SEAT) && <button type="button" className="kt-btn-ghost" style={{ padding: '6px 10px' }} onClick={() => removeSeat(s.id)}>✕</button>}
          </div>
        ))}

        {mySeat && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Your token</div>
            <div className="kt-token-pick">
              {TOKENS.map((t) => {
                const taken = seats.some((s) => s.token === t && s.ownerUid !== me);
                return <div key={t} className={`kt-tok${mySeat.token === t ? ' sel' : ''}`} style={{ opacity: taken ? 0.3 : 1 }} onClick={() => setMyToken(t)} role="button" tabIndex={0}>{t}</div>;
              })}
            </div>
          </div>
        )}

        {isHost && (
          <div className="kt-pl-row" style={{ marginTop: 12 }}>
            <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Add a player on this device" />
            <button type="button" className="kt-btn-ghost" disabled={seats.length >= 6} onClick={addLocal}>＋ Add</button>
          </div>
        )}
      </div>

      {isHost ? (
        <>
          <button type="button" className="kt-btn-go" style={{ width: '100%' }} disabled={!config || seats.length < 2} onClick={start}>
            {seats.length < 2 ? 'Waiting for players…' : `▶ Start game (${seats.length})`}
          </button>
          {!asDisplay && <button type="button" className="kt-btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={becomeDisplay}>📺 Use this screen as the board (I won&rsquo;t play)</button>}
        </>
      ) : (
        <p className="kt-small-note" style={{ textAlign: 'center' }}>
          {asDisplay ? '📺 This screen will show the board. Waiting for the host to start…' : 'Waiting for the host to start the game…'}
        </p>
      )}
      {!isGuest && !asDisplay && (
        <button type="button" className="kt-btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setAsDisplay(true)}>📺 Or watch on this screen as the board</button>
      )}
    </div>
  );
}
