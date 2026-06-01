'use client';

// Kaya Tycoon — the 40-tile board + centre hub (logo, live step counter,
// flash). Pure presentation: renders a GameState + transient animation props.

import { type GameState, GROUP_COLORS, money } from '@/lib/tycoon';
import type { FlashState } from './useTycoon';

function gridPos(i: number): { r: number; c: number } {
  if (i === 0) return { r: 11, c: 11 };
  if (i < 10) return { r: 11, c: 11 - i };
  if (i === 10) return { r: 11, c: 1 };
  if (i < 20) return { r: 11 - (i - 10), c: 1 };
  if (i === 20) return { r: 1, c: 1 };
  if (i < 30) return { r: 1, c: (i - 20) + 1 };
  if (i === 30) return { r: 1, c: 11 };
  return { r: (i - 30) + 1, c: 11 };
}

interface BoardProps {
  state: GameState;
  animPos: number | null;
  moverCount: number | null;
  flash: FlashState | null;
  onTileClick: (i: number) => void;
}

export default function Board({ state, animPos, moverCount, flash, onTileClick }: BoardProps) {
  const { board, themeRender: TH } = state;
  const dispPos = (pid: number, pos: number) => (animPos != null && pid === state.current ? animPos : pos);
  const tokensOn = (i: number) => state.players.filter((p) => !p.bankrupt && dispPos(p.id, p.pos) === i);

  return (
    <div className="kt-board">
      <div className="kt-center">
        <div className="kt-ttl">KAYA<br />TYCOON</div>
        <div className="kt-sub">{state.sub}</div>
        <div className="kt-mover kt-pulse" key={`mv-${moverCount ?? 'x'}`}>{moverCount ?? ''}</div>
        {flash && (
          <div className="kt-cflash kt-show" key={`fl-${flash.id}`}>
            <div className="kt-ce">{flash.emoji}</div>
            <div className="kt-ct">{flash.text}</div>
          </div>
        )}
      </div>

      {board.map((t, i) => {
        const g = gridPos(i);
        const isCorner = t.type === 'start' || t.type === 'jail' || t.type === 'parking' || t.type === 'gotojail';
        const toks = tokensOn(i);
        const owner = state.owners[i];
        const h = state.houses[i] || 0;
        const C = TH.corners;
        return (
          <div
            key={i}
            id={`kt-tile-${i}`}
            className={`kt-tile${isCorner ? ' kt-corner' : ''}${animPos === i ? ' kt-hop' : ''}`}
            style={{ gridRow: g.r, gridColumn: g.c }}
            onClick={() => onTileClick(i)}
            role="button"
            tabIndex={-1}
          >
            {t.type === 'prop' && (
              <>
                <div className="kt-cbar" style={{ background: GROUP_COLORS[t.group!] }} />
                <div className="kt-nm">{t.name}</div>
                <div className="kt-pr">{money(state.cur, t.price!)}</div>
              </>
            )}
            {t.type === 'airport' && (
              <>
                <div style={{ fontSize: '1.6em', textAlign: 'center' }}>{TH.airportE}</div>
                <div className="kt-nm" style={{ textAlign: 'center' }}>{t.name}</div>
                <div className="kt-pr">{money(state.cur, t.price!)}</div>
              </>
            )}
            {t.type === 'utility' && (
              <>
                <div style={{ fontSize: '1.6em', textAlign: 'center' }}>{TH.utilE[i]}</div>
                <div className="kt-nm" style={{ textAlign: 'center' }}>{t.name}</div>
                <div className="kt-pr">{money(state.cur, t.price!)}</div>
              </>
            )}
            {t.type === 'card' && (
              <>
                <div style={{ fontSize: '1.9em', textAlign: 'center', margin: 'auto' }}>{t.deck === 'adventure' ? '❓' : '🎁'}</div>
                <div className="kt-nm" style={{ textAlign: 'center' }}>{t.name}</div>
              </>
            )}
            {t.type === 'tax' && (
              <>
                <div style={{ fontSize: '1.6em', textAlign: 'center' }}>💸</div>
                <div className="kt-nm" style={{ textAlign: 'center' }}>{t.name}</div>
                <div className="kt-pr">{money(state.cur, t.amount!)}</div>
              </>
            )}
            {t.type === 'start' && (
              <>
                <div style={{ fontSize: '2.1em' }}>{C.start.e}</div>
                <div style={{ fontWeight: 900, color: 'var(--kt-green)', fontSize: '1.05em' }}>{C.start.l}</div>
                <div style={{ fontSize: '.82em' }}>+{money(state.cur, state.passGo)}</div>
              </>
            )}
            {t.type === 'jail' && (
              <>
                <div style={{ fontSize: '1.9em' }}>{C.jail.e}</div>
                <div style={{ fontSize: '.9em', fontWeight: 800 }}>{C.jail.l}</div>
                <div style={{ fontSize: '.75em' }}>{C.jail.s}</div>
              </>
            )}
            {t.type === 'parking' && (
              <>
                <div style={{ fontSize: '2.1em' }}>{C.parking.e}</div>
                <div style={{ fontSize: '.9em', fontWeight: 800 }}>{C.parking.l}</div>
              </>
            )}
            {t.type === 'gotojail' && (
              <>
                <div style={{ fontSize: '2.1em' }}>{C.gotojail.e}</div>
                <div style={{ fontSize: '.78em', fontWeight: 800 }}>{C.gotojail.l}</div>
              </>
            )}

            {owner !== undefined && (
              <div className="kt-own">
                <span style={{ color: state.players[owner].color, fontSize: '1.2em' }}>●</span>
                {state.mortgaged[i] && <span style={{ fontSize: '.7em' }}>💤</span>}
              </div>
            )}
            {h > 0 && <div className="kt-houses">{h === 5 ? '🏨' : '🏠'.repeat(h)}</div>}
            <div className="kt-toks">
              {toks.map((p) => <span key={p.id} title={p.name}>{p.token}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
