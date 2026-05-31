'use client';

import { useEffect, useRef, useState } from 'react';
import { updateSession, type GameSession } from '@/lib/gameSessions';
import {
  type UnoColor, UNO_COLORS, UNO_HEX, cardColor, cardValue, cardGlyph, cardInk,
  canPlay, effectOf, dealGame, drawCards, advance, isWild,
} from '@/lib/uno';

// Two-phone UNO (2–6 players). The full game lives in session.state — hands,
// draw pile, discard top, active colour, turn + direction. Only the player on
// turn writes (plays or draws), so devices never race. Hands are in the shared
// session (a family-trust game — no server-side hidden state for v1). Winner =
// first to empty their hand → /api/games/win awards Fun-Points (winner ×2).

const HAND_SIZE = 7;
const COLOR_NAME: Record<UnoColor, string> = { R: 'Red', Y: 'Yellow', G: 'Green', B: 'Blue' };

function UnoCard({ code, size = 'md', dim, onClick }: {
  code: string; size?: 'sm' | 'md' | 'lg'; dim?: boolean; onClick?: () => void;
}) {
  const color = cardColor(code);
  const d = size === 'lg' ? { w: 64, h: 94, f: 30 } : size === 'sm' ? { w: 34, h: 50, f: 16 } : { w: 52, h: 78, f: 22 };
  const style: React.CSSProperties = {
    width: d.w, height: d.h, fontSize: d.f, color: cardInk(color), opacity: dim ? 0.5 : 1,
    background: color === 'W'
      ? 'conic-gradient(from 45deg,#FF6B6B,#FFC93C,#2DD4BF,#4F86F7,#FF6B6B)'
      : UNO_HEX[color],
  };
  const cls = 'relative rounded-[10px] border-[3px] border-white shadow-[0_5px_14px_rgba(26,18,64,0.22)] flex items-center justify-center font-display font-black shrink-0';
  const inner = (
    <>
      <span style={{ position: 'absolute', inset: 7, borderRadius: '50%/42%', background: 'rgba(255,255,255,0.22)' }} />
      <span style={{ position: 'relative' }}>{cardGlyph(code)}</span>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} active:scale-95 transition-transform`} style={style}>{inner}</button>
    : <div className={cls} style={style}>{inner}</div>;
}

export default function UnoMultiPlay({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const st = session.state as {
    dealt?: boolean; hands?: Record<string, string[]>; draw?: string[]; discard?: string;
    activeColor?: UnoColor; turn?: number; dir?: 1 | -1; msg?: string;
  };
  const players = session.players;
  const isHost = session.hostUid === me;
  const n = players.length;

  // Host deals once play starts (all players have joined the lobby by now).
  const dealtRef = useRef(false);
  useEffect(() => {
    if (!isHost || st.dealt || dealtRef.current || n < 2) return;
    dealtRef.current = true;
    const { hands, draw, discard, activeColor } = dealGame(players.map((p) => p.uid), HAND_SIZE);
    void updateSession(familyId, session.id, {
      state: { dealt: true, hands, draw, discard, activeColor, turn: 0, dir: 1, msg: `${players[0]?.name} starts!` },
    });
  }, [isHost, st.dealt, n, familyId, session.id, players]);

  const [picking, setPicking] = useState<string | null>(null); // a wild awaiting colour

  if (!st.dealt || !st.discard) return <p className="text-center text-sm text-games-ink-soft py-12">Dealing the cards… 🎴</p>;

  const hands = st.hands || {};
  const draw = st.draw || [];
  const discard = st.discard;
  const activeColor = (st.activeColor || 'R') as UnoColor;
  const turn = st.turn || 0;
  const dir = (st.dir || 1) as 1 | -1;
  const topValue = cardValue(discard);
  const myHand = hands[me] || [];
  const isMyTurn = players[turn]?.uid === me;
  const turnName = players[turn]?.name || 'Someone';
  const canPlayAny = myHand.some((c) => canPlay(c, activeColor, topValue));

  const commit = (code: string, chosenColor: UnoColor) => {
    const hand2 = [...myHand];
    const at = hand2.indexOf(code);
    if (at >= 0) hand2.splice(at, 1);

    const eff = effectOf(code);
    const active2: UnoColor = isWild(code) ? chosenColor : (cardColor(code) as UnoColor);
    let dir2 = dir;
    let skip = eff.skip;
    if (eff.reverse) { if (n === 2) skip += 1; else dir2 = (dir * -1) as 1 | -1; } // 2-player reverse = skip

    let drawPile = draw;
    let hands2: Record<string, string[]> = { ...hands, [me]: hand2 };
    let msg = `${players[turn]?.name} played ${cardGlyph(code)}`;

    if (eff.draw > 0) {
      const victim = players[advance(turn, dir2, n, 1)];
      const { cards, rest } = drawCards(drawPile, eff.draw);
      drawPile = rest;
      hands2 = { ...hands2, [victim.uid]: [...(hands2[victim.uid] || []), ...cards] };
      msg += ` — ${victim?.name} draws ${eff.draw}`;
    }

    const won = hand2.length === 0;
    void updateSession(familyId, session.id, {
      ...(won ? { status: 'done' as const, winnerUid: me } : {}),
      state: {
        dealt: true, hands: hands2, draw: drawPile, discard: code, activeColor: active2,
        turn: won ? turn : advance(turn, dir2, n, 1 + skip), dir: dir2,
        msg: won ? `${players[turn]?.name} wins! 🎉` : msg,
      },
    });
    setPicking(null);
  };

  const play = (code: string) => {
    if (!isMyTurn || picking) return;
    if (!canPlay(code, activeColor, topValue)) return;
    if (isWild(code)) { setPicking(code); return; }
    commit(code, cardColor(code) as UnoColor);
  };

  const drawOne = () => {
    if (!isMyTurn || picking) return;
    const { cards, rest } = drawCards(draw, 1);
    void updateSession(familyId, session.id, {
      state: {
        dealt: true, hands: { ...hands, [me]: [...myHand, ...cards] }, draw: rest, discard,
        activeColor, turn: advance(turn, dir, n, 1), dir, msg: `${players[turn]?.name} drew a card`,
      },
    });
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      {/* opponents */}
      <div className="flex flex-wrap justify-around gap-2 mb-2">
        {players.filter((p) => p.uid !== me).map((p) => {
          const isTurn = players[turn]?.uid === p.uid;
          const count = hands[p.uid]?.length ?? 0;
          return (
            <div key={p.uid} className="flex flex-col items-center gap-0.5 text-[11px] font-bold">
              <div className={`w-10 h-10 rounded-full bg-games-bg flex items-center justify-center text-lg ${isTurn ? 'ring-2 ring-games-violet ring-offset-2' : ''}`}>
                {count === 1 ? '😼' : '🙂'}
              </div>
              <span className={isTurn ? 'text-games-violet-deep' : 'text-games-ink-soft'}>{p.name}</span>
              <span className="bg-games-ink text-white rounded-full px-1.5">{count}</span>
            </div>
          );
        })}
      </div>

      {/* table — draw pile + discard + active colour */}
      <div className="flex items-center justify-center gap-5 my-3">
        <button type="button" onClick={drawOne} disabled={!isMyTurn || !!picking} className="flex flex-col items-center gap-1 disabled:opacity-50">
          <div className="rounded-[10px] border-[3px] border-white w-[52px] h-[78px] flex items-center justify-center"
            style={{ background: 'repeating-linear-gradient(135deg,#4A1FB8,#4A1FB8 6px,#6B3FE0 6px,#6B3FE0 12px)' }}>
            <span className="bg-white text-games-violet-deep italic font-display font-black px-1.5 py-0.5 rounded text-[11px] -rotate-12">UNO</span>
          </div>
          <span className="text-[10px] font-bold text-games-ink-soft">Draw ({draw.length})</span>
        </button>
        <div className="flex flex-col items-center gap-1">
          <UnoCard code={discard} size="lg" />
          <span className="flex items-center gap-1 text-[11px] font-extrabold text-games-ink-soft">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: UNO_HEX[activeColor] }} /> {COLOR_NAME[activeColor]} · {dir === 1 ? '🔁' : '🔄'}
          </span>
        </div>
      </div>

      {st.msg && <p className="text-center text-[11px] font-semibold text-games-ink-soft mb-1 h-4">{st.msg}</p>}
      <p className="text-center text-sm font-extrabold mb-2">
        {isMyTurn
          ? <span className="text-games-violet">Your turn{!canPlayAny ? ' — draw a card' : ''}</span>
          : <span className="text-games-ink-soft">Waiting for {turnName}…</span>}
      </p>

      {/* my hand */}
      <div className="flex flex-wrap justify-center gap-1.5 pb-1">
        {myHand.map((code, i) => {
          const playable = isMyTurn && !picking && canPlay(code, activeColor, topValue);
          return (
            <div key={`${code}-${i}`} className={playable ? '-translate-y-1.5 transition-transform' : 'transition-transform'}>
              <UnoCard code={code} dim={isMyTurn && !playable} onClick={() => play(code)} />
            </div>
          );
        })}
      </div>
      {myHand.length === 1 && <p className="text-center text-xs font-black text-games-gold mt-2">✊ UNO!</p>}

      {/* wild colour picker */}
      {picking && (
        <div className="fixed inset-0 z-[75] bg-games-ink/55 flex items-center justify-center p-5">
          <div className="bg-white rounded-kaya-lg p-5 w-full max-w-xs text-center">
            <p className="font-display font-black text-games-ink mb-1">Choose a colour</p>
            <p className="text-xs text-games-ink-soft mb-3">Everyone matches this next.</p>
            <div className="grid grid-cols-2 gap-2.5">
              {UNO_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => commit(picking, c)}
                  className="h-14 rounded-kaya font-display font-extrabold border-[3px] border-white shadow-[0_4px_12px_rgba(26,18,64,0.16)]"
                  style={{ background: UNO_HEX[c], color: cardInk(c) }}>
                  {COLOR_NAME[c]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
