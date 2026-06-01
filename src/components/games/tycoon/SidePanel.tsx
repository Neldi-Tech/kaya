'use client';

// Kaya Tycoon — the side panel: turn header, dice, contextual actions, the
// per-turn tip line, game log, and the tappable players list (→ Investor Coach).

import { useEffect, useRef } from 'react';
import { type GameState, netWorth, money, cv, JAIL_FEE } from '@/lib/tycoon';
import type { DiceState } from './useTycoon';

const DIE_FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

interface SidePanelProps {
  state: GameState;
  dice: DiceState | null;
  busy: boolean;
  log: string[];
  onRoll: () => void;
  onEndTurn: () => void;
  onManage: () => void;
  onGuide: () => void;
  onInvestor: (pid: number) => void;
}

export default function SidePanel({ state, dice, busy, log, onRoll, onEndTurn, onManage, onGuide, onInvestor }: SidePanelProps) {
  const p = state.players[state.current];
  const jw = state.theme === 'universe' ? 'Black Hole' : 'Time-Out';
  const word = state.theme === 'universe' ? 'planets' : 'cities';
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const idle = !state.prompt && !state.over;
  const showRoll = idle && !state.rolled;
  const showEnd = idle && state.rolled;
  const showManage = idle && state.mode === 'long';

  let tip: string;
  if (p.jail) tip = `🛑 You're in ${jw.toLowerCase()}! Roll a double to escape, or wait — after 3 tries you pay ${money(state.cur, cv(state, JAIL_FEE))}.`;
  else if (!state.rolled) tip = `👉 ${p.name}, tap Roll Dice to move! Watch your token hop around the board.`;
  else tip = '✅ Turn done — tap End Turn to pass to the next player.';

  return (
    <div className="kt-panel">
      <div className="kt-pbox">
        <div className="kt-turn">
          <span className="kt-ava">{p.token}</span>
          <span className="kt-who" style={{ color: p.color }}>
            {p.name}{p.jail ? ` (${jw})` : ''}{p.getout > 0 ? ' 🎟️' : ''}
          </span>
          <span className="kt-cash">{money(state.cur, p.cash)}</span>
        </div>
        <div className="kt-dice">
          <div className="kt-die kt-roll" key={`d1-${dice?.seq ?? 0}`}>{dice ? DIE_FACE[dice.d1] : '🎲'}</div>
          <div className="kt-die kt-roll" key={`d2-${dice?.seq ?? 0}`}>{dice ? DIE_FACE[dice.d2] : '🎲'}</div>
          <div style={{ alignSelf: 'center', fontWeight: 700, color: '#888' }}>
            {dice ? `${dice.d1}+${dice.d2}=${dice.d1 + dice.d2}${dice.d1 === dice.d2 ? ' 🎉 Double!' : ''}` : ''}
          </div>
        </div>
        <div className="kt-actions">
          {showRoll && <button type="button" className="kt-btn-primary" onClick={onRoll} disabled={busy}>🎲 Roll Dice</button>}
          {showEnd && <button type="button" className="kt-btn-end" onClick={onEndTurn} disabled={busy}>✓ End Turn</button>}
          {showManage && <button type="button" className="kt-btn-ghost" onClick={onManage} disabled={busy}>🏗️ Manage</button>}
        </div>
        <div className="kt-tip">{tip}</div>
      </div>

      <div className="kt-pbox">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h3 style={{ fontSize: 15 }}>📜 Game Log</h3>
          <button type="button" className="kt-btn-ghost" style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 13 }} onClick={onGuide}>❓ How to play</button>
        </div>
        <div className="kt-log" ref={logRef} style={{ marginTop: 8 }}>
          {log.map((line, i) => <div key={i} dangerouslySetInnerHTML={{ __html: line }} />)}
        </div>
      </div>

      <div className="kt-pbox">
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>
          👥 Players <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.6 }}>(tap for {word} &amp; tips)</span>
        </h3>
        <div className="kt-players-list">
          {state.players.map((pl) => (
            <div
              key={pl.id}
              className={`kt-pcard${pl.id === state.current ? ' kt-active' : ''}${pl.bankrupt ? ' kt-broke' : ''}`}
              onClick={() => onInvestor(pl.id)}
              role="button"
              tabIndex={-1}
            >
              <span style={{ fontSize: 20 }}>{pl.token}</span>
              <div>
                <div style={{ fontWeight: 700, color: pl.color }}>{pl.name}</div>
                <div className="kt-props-mini">
                  {pl.props.length} {word}{state.mode === 'long' ? ` · ${money(state.cur, netWorth(state, pl))}` : ''}
                </div>
              </div>
              <span className="kt-pc-cash" style={{ color: pl.bankrupt ? '#999' : 'var(--kt-green)' }}>{money(state.cur, pl.cash)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
