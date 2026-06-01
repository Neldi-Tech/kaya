'use client';

// Kaya Tycoon — the in-room playing view (multi-device + Display/projector).
// Every device renders the full board. The device that owns the seat the
// engine is waiting on gets the controls + modals; everyone else watches.
// A Display device (no seat) shows the board + whose-turn + log, no controls.

import { useState } from 'react';
import { type GameSession } from '@/lib/gameSessions';
import { activeSeatIndex } from '@/lib/tycoon';
import Board from './Board';
import SidePanel from './SidePanel';
import Modals, { type Overlay } from './Modals';
import Confetti from './Confetti';
import { useTycoonRoom } from './useTycoonRoom';

export default function TycoonRoomPlay({
  session, familyId, myUid, display = false,
}: {
  session: GameSession;
  familyId: string;
  myUid: string;
  display?: boolean;
}) {
  const room = useTycoonRoom(session, familyId, myUid);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const s = room.state;

  if (!s) {
    return <p className="kt-small-note" style={{ textAlign: 'center', padding: '40px 0' }}>Setting up the board… 🎲</p>;
  }

  // The seat the engine is waiting on → friendly "whose turn" label.
  const activeSeat = room.seats[activeSeatIndex(s)];
  const activeName = activeSeat?.name || s.players[s.current]?.name || 'Player';
  const myTurn = room.canAct;
  // Spectators/Display can't act → modal buttons are read-only (busy).
  const modalBusy = room.busy || !myTurn;

  return (
    <>
      <Confetti signal={room.confettiSignal} />
      <div className="kt-layout">
        <div className="kt-board-wrap">
          <Board
            state={s}
            animPos={room.animPos}
            moverCount={room.moverCount}
            flash={room.flash}
            onTileClick={(i) => { if (!room.busy) setOverlay({ kind: 'tileInfo', tile: i }); }}
          />
        </div>

        {display ? (
          <div className="kt-panel">
            <div className="kt-pbox">
              <div className="kt-turn">
                <span className="kt-ava">{s.players[s.current]?.token}</span>
                <span className="kt-who" style={{ color: s.players[s.current]?.color }}>{activeName}&rsquo;s turn</span>
                <span className="kt-cash">📺 Big screen</span>
              </div>
              <div className="kt-tip">Players act on their phones — watch the board here.</div>
            </div>
            <div className="kt-pbox">
              <h3 style={{ fontSize: 15 }}>📜 Game Log</h3>
              <div className="kt-log" style={{ marginTop: 8 }}>
                {room.log.map((line, i) => <div key={i} dangerouslySetInnerHTML={{ __html: line }} />)}
              </div>
            </div>
          </div>
        ) : (
          <SidePanel
            state={s}
            dice={room.dice}
            busy={room.busy}
            canAct={myTurn}
            log={room.log}
            waitingFor={myTurn ? null : activeName}
            onRoll={room.doRoll}
            onEndTurn={room.doEndTurn}
            onManage={() => setOverlay({ kind: 'manage' })}
            onGuide={() => setOverlay({ kind: 'guide' })}
            onInvestor={(pid) => setOverlay({ kind: 'investor', pid })}
          />
        )}
      </div>

      {/* Modals render on every device (spectators see them read-only), so the
          big screen + everyone's phone shows what's happening. */}
      <Modals
        state={s}
        busy={modalBusy}
        overlay={overlay}
        setOverlay={setOverlay}
        onBuy={room.doBuy}
        onDecline={room.doDecline}
        onBid={room.doBid}
        onPass={room.doPass}
        onApplyCard={room.doApplyCard}
        onBuild={room.doBuild}
        onSellHouse={room.doSellHouse}
        onMortgage={room.doMortgage}
        onUnmortgage={room.doUnmortgage}
        onSell={room.doSell}
        onRaiseSellHouse={room.doRaiseSellHouse}
        onRaiseMortgage={room.doRaiseMortgage}
        onSettleDebt={room.doSettleDebt}
        onGiveUp={room.doGiveUp}
        onPlayAgain={() => { window.location.href = '/games/tycoon'; }}
      />
    </>
  );
}
