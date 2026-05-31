'use client';

import { useEffect, useRef, useState } from 'react';
import { updateSession, type GameSession } from '@/lib/gameSessions';
import {
  type UnoColor, type UnoLevel, UNO_COLORS, UNO_LEVELS, UNO_HEX, cardColor, cardValue, cardGlyph, cardInk,
  canPlay, effectOf, dealGame, drawCards, advance, isWild, stacks, stackKind,
} from '@/lib/uno';

// Two-phone UNO (2–6 players). The whole game lives in session.state — hands,
// draw pile, discard top, active colour, turn + direction, and any pending draw
// stack. Only the player on turn writes, so devices never race. Hands sit in the
// shared session (a family-trust game). Winner = first to empty their hand →
// /api/games/win awards Fun-Points (harder level = bigger multiplier).

const HAND_SIZE = 7;
const COLOR_NAME: Record<UnoColor, string> = { R: 'Red', Y: 'Yellow', G: 'Green', B: 'Blue' };

function UnoCard({ code, size = 'md', dim, onClick }: {
  code: string; size?: 'sm' | 'md' | 'lg'; dim?: boolean; onClick?: () => void;
}) {
  const color = cardColor(code);
  const wild = color === 'W';
  const d = size === 'lg' ? { w: 64, h: 94, f: 26 } : size === 'sm' ? { w: 34, h: 50, f: 15 } : { w: 52, h: 78, f: 21 };
  const cls = 'relative rounded-[10px] border-[3px] border-white shadow-[0_5px_14px_rgba(26,18,64,0.22)] flex items-center justify-center font-display font-black shrink-0';
  const style: React.CSSProperties = {
    width: d.w, height: d.h, fontSize: d.f, opacity: dim ? 0.5 : 1,
    background: wild ? '#1A1240' : UNO_HEX[color], color: cardInk(color),
  };
  const center = code === 'W' ? '' : cardGlyph(code);
  const inner = wild ? (
    <>
      <span style={{
        position: 'absolute', width: '60%', height: '60%', borderRadius: '50%', transform: 'rotate(45deg)',
        background: 'conic-gradient(#FF6B6B 0 90deg,#FFC93C 90deg 180deg,#2DD4BF 180deg 270deg,#4F86F7 270deg 360deg)',
        boxShadow: '0 0 0 3px rgba(255,255,255,0.92)',
      }} />
      {center && <span style={{ position: 'relative', color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.55)' }}>{center}</span>}
    </>
  ) : (
    <>
      <span style={{ position: 'absolute', inset: 7, borderRadius: '50%/42%', background: 'rgba(255,255,255,0.22)' }} />
      <span style={{ position: 'relative' }}>{center}</span>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} active:scale-95 transition-transform`} style={style}>{inner}</button>
    : <div className={cls} style={style}>{inner}</div>;
}

export default function UnoMultiPlay({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const st = session.state as {
    level?: UnoLevel; funMult?: number; dealt?: boolean;
    hands?: Record<string, string[]>; draw?: string[]; discard?: string;
    activeColor?: UnoColor; turn?: number; dir?: 1 | -1;
    pendingDraw?: number; pendingKind?: 'd2' | 'd4' | null; msg?: string;
  };
  const players = session.players;
  const isHost = session.hostUid === me;
  const n = players.length;
  const level = st.level;

  // Host deals once a level is picked (all players have joined the lobby).
  const dealtRef = useRef(false);
  useEffect(() => {
    if (!isHost || !level || st.dealt || dealtRef.current || n < 2) return;
    dealtRef.current = true;
    const { hands, draw, discard, activeColor } = dealGame(players.map((p) => p.uid), level, HAND_SIZE);
    const funMult = UNO_LEVELS.find((l) => l.id === level)?.funMult ?? 1;
    void updateSession(familyId, session.id, {
      state: { level, funMult, dealt: true, hands, draw, discard, activeColor, turn: 0, dir: 1, pendingDraw: 0, pendingKind: null, msg: `${players[0]?.name} starts!` },
    });
  }, [isHost, level, st.dealt, n, familyId, session.id, players]);

  const [picking, setPicking] = useState<string | null>(null);      // a wild awaiting colour
  const [swap, setSwap] = useState<{ code: string; color: UnoColor } | null>(null); // swap awaiting target

  // ── Level picker (host) ──────────────────────────────────────────────────
  if (!level) {
    if (!isHost) return <p className="text-center text-sm text-games-ink-soft py-12">The host is choosing a level… 🎴</p>;
    return (
      <div className="mx-auto" style={{ maxWidth: 340 }}>
        <p className="text-center font-display font-extrabold text-games-ink mb-1">Pick a level 🎴</p>
        <p className="text-center text-[11px] text-games-ink-soft mb-4">Harder levels add cards — and pay more ✨ Fun Points.</p>
        <div className="space-y-2.5">
          {UNO_LEVELS.map((l) => (
            <button key={l.id} type="button"
              onClick={() => updateSession(familyId, session.id, { state: { level: l.id, funMult: l.funMult } })}
              className="w-full flex items-center gap-3 bg-games-card rounded-kaya p-4 shadow-[0_4px_12px_rgba(26,18,64,0.08)] active:scale-95 transition-transform text-left">
              <span className="text-3xl">{l.emoji}</span>
              <span className="flex-1">
                <span className="block font-display font-extrabold text-games-ink">{l.label}</span>
                <span className="block text-[11px] font-semibold text-games-ink-soft">{l.blurb}</span>
              </span>
              <span className="text-[11px] font-black text-games-violet">×{l.funMult}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!st.dealt || !st.discard) return <p className="text-center text-sm text-games-ink-soft py-12">Dealing the cards… 🎴</p>;

  const hands = st.hands || {};
  const draw = st.draw || [];
  const discard = st.discard;
  const activeColor = (st.activeColor || 'R') as UnoColor;
  const turn = st.turn || 0;
  const dir = (st.dir || 1) as 1 | -1;
  const pendingDraw = st.pendingDraw || 0;
  const pendingKind = st.pendingKind || null;
  const topValue = cardValue(discard);
  const myHand = hands[me] || [];
  const isMyTurn = players[turn]?.uid === me;
  const turnName = players[turn]?.name || 'Someone';

  const isPlayable = (code: string): boolean =>
    pendingDraw > 0 ? stackKind(code) === pendingKind : canPlay(code, activeColor, topValue);
  const canPlayAny = myHand.some(isPlayable);

  const commit = (code: string, chosenColor: UnoColor, swapTarget?: string) => {
    const hand2 = [...myHand];
    const at = hand2.indexOf(code);
    if (at >= 0) hand2.splice(at, 1);

    const eff = effectOf(code);
    const active2: UnoColor = isWild(code) ? chosenColor : (cardColor(code) as UnoColor);
    let dir2 = dir;
    let skip = eff.skip;
    if (eff.reverse) { if (n === 2) skip += 1; else dir2 = (dir * -1) as 1 | -1; }

    let drawPile = draw;
    let hands2: Record<string, string[]> = { ...hands, [me]: hand2 };
    let pend = pendingDraw;
    let kind: 'd2' | 'd4' | null = pendingKind;
    let msg = `${players[turn]?.name} played ${cardGlyph(code) || 'Wild'}`;
    const won = hand2.length === 0;

    if (eff.swap && swapTarget && !won) {
      const mine = hands2[me] || [];
      const theirs = hands2[swapTarget] || [];
      hands2 = { ...hands2, [me]: theirs, [swapTarget]: mine };
      msg += ` — swapped hands with ${players.find((p) => p.uid === swapTarget)?.name}`;
    }

    let nextTurn: number;
    if (won) {
      nextTurn = turn;
    } else if (eff.skipAll) {
      nextTurn = turn; // everyone else skips → play again
      msg += ' — everyone skips! 🚫';
    } else if (eff.draw > 0 && stacks(level)) {
      pend += eff.draw;
      kind = stackKind(code) || kind;
      nextTurn = advance(turn, dir2, n, 1); // victim responds
      msg += ` — +${pend}! stack or draw`;
    } else if (eff.draw > 0) {
      const victim = players[advance(turn, dir2, n, 1)];
      const r = drawCards(drawPile, eff.draw, level);
      drawPile = r.rest;
      hands2 = { ...hands2, [victim.uid]: [...(hands2[victim.uid] || []), ...r.cards] };
      nextTurn = advance(turn, dir2, n, 2); // victim drew + is skipped
      msg += ` — ${victim?.name} draws ${eff.draw}`;
    } else {
      nextTurn = advance(turn, dir2, n, 1 + skip);
    }
    if (!(eff.draw > 0 && stacks(level)) || won) { pend = 0; kind = null; }

    void updateSession(familyId, session.id, {
      ...(won ? { status: 'done' as const, winnerUid: me } : {}),
      state: {
        level, funMult: st.funMult ?? 1, dealt: true, hands: hands2, draw: drawPile,
        discard: code, activeColor: active2, turn: won ? turn : nextTurn, dir: dir2,
        pendingDraw: pend, pendingKind: kind, msg: won ? `${players[turn]?.name} wins! 🎉` : msg,
      },
    });
    setPicking(null);
    setSwap(null);
  };

  const play = (code: string) => {
    if (!isMyTurn || picking || swap) return;
    if (!isPlayable(code)) return;
    if (code === 'WS') { setPicking(code); return; }        // swap → colour then target
    if (isWild(code)) { setPicking(code); return; }
    commit(code, cardColor(code) as UnoColor);
  };

  const pickColor = (c: UnoColor) => {
    if (!picking) return;
    if (picking === 'WS') { setSwap({ code: 'WS', color: c }); setPicking(null); return; }
    commit(picking, c);
  };

  const drawOne = () => {
    if (!isMyTurn || picking || swap || pendingDraw > 0) return;
    const r = drawCards(draw, 1, level);
    void updateSession(familyId, session.id, {
      state: {
        level, funMult: st.funMult ?? 1, dealt: true, hands: { ...hands, [me]: [...myHand, ...r.cards] }, draw: r.rest,
        discard, activeColor, turn: advance(turn, dir, n, 1), dir, pendingDraw: 0, pendingKind: null,
        msg: `${players[turn]?.name} drew a card`,
      },
    });
  };

  const takeStack = () => {
    if (!isMyTurn || pendingDraw <= 0) return;
    const r = drawCards(draw, pendingDraw, level);
    void updateSession(familyId, session.id, {
      state: {
        level, funMult: st.funMult ?? 1, dealt: true, hands: { ...hands, [me]: [...myHand, ...r.cards] }, draw: r.rest,
        discard, activeColor, turn: advance(turn, dir, n, 1), dir, pendingDraw: 0, pendingKind: null,
        msg: `${players[turn]?.name} drew ${pendingDraw}`,
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

      {/* table */}
      <div className="flex items-center justify-center gap-5 my-3">
        <button type="button" onClick={drawOne} disabled={!isMyTurn || !!picking || !!swap || pendingDraw > 0} className="flex flex-col items-center gap-1 disabled:opacity-50">
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

      {/* forced draw banner during a stack */}
      {isMyTurn && pendingDraw > 0 && (
        <div className="bg-[#FFE4E4] text-games-coral rounded-kaya p-2.5 mb-2 text-center">
          <p className="text-xs font-extrabold mb-1.5">Stacked +{pendingDraw}! Play a {pendingKind === 'd4' ? '+4' : '+2'} or take them.</p>
          <button type="button" onClick={takeStack} className="bg-games-coral text-white font-extrabold text-sm px-4 py-1.5 rounded-full">Draw {pendingDraw} cards</button>
        </div>
      )}

      <p className="text-center text-sm font-extrabold mb-2">
        {isMyTurn
          ? <span className="text-games-violet">{pendingDraw > 0 ? 'Stack or draw!' : `Your turn${!canPlayAny ? ' — draw a card' : ''}`}</span>
          : <span className="text-games-ink-soft">Waiting for {turnName}…</span>}
      </p>

      {/* my hand */}
      <div className="flex flex-wrap justify-center gap-1.5 pb-1">
        {myHand.map((code, i) => {
          const playable = isMyTurn && !picking && !swap && isPlayable(code);
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
            <p className="text-xs text-games-ink-soft mb-3">{picking === 'WS' ? 'Then pick who to swap hands with.' : 'Everyone matches this next.'}</p>
            <div className="grid grid-cols-2 gap-2.5">
              {UNO_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => pickColor(c)}
                  className="h-14 rounded-kaya font-display font-extrabold border-[3px] border-white shadow-[0_4px_12px_rgba(26,18,64,0.16)]"
                  style={{ background: UNO_HEX[c], color: cardInk(c) }}>
                  {COLOR_NAME[c]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* swap-hands target picker */}
      {swap && (
        <div className="fixed inset-0 z-[75] bg-games-ink/55 flex items-center justify-center p-5">
          <div className="bg-white rounded-kaya-lg p-5 w-full max-w-xs text-center">
            <p className="font-display font-black text-games-ink mb-1">🔄 Swap hands with…</p>
            <p className="text-xs text-games-ink-soft mb-3">You&rsquo;ll take their cards, they take yours.</p>
            <div className="flex flex-col gap-2">
              {players.filter((p) => p.uid !== me).map((p) => (
                <button key={p.uid} type="button" onClick={() => commit('WS', swap.color, p.uid)}
                  className="flex items-center justify-between bg-games-bg rounded-kaya px-4 py-2.5 font-extrabold text-games-ink">
                  <span>{p.name}</span>
                  <span className="text-xs text-games-ink-soft">{hands[p.uid]?.length ?? 0} cards</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
