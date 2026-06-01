'use client';

// Kaya Tycoon — top-level component for the Kaya Games hub. Immersive,
// full-screen (it manages its own setup → board → win flow), so the runner
// renders it outside the narrow game Shell. Phase 1 is local pass-and-play and
// owns its win screen; it does not award points yet (see README → "Rewards").
//
// The engine lives in src/lib/tycoon; this file just wires the hook to the
// view components.

import { useState } from 'react';
import Link from 'next/link';
import { useTycoon } from './tycoon/useTycoon';
import TycoonStyles from './tycoon/TycoonStyles';
import Confetti from './tycoon/Confetti';
import SetupScreen from './tycoon/SetupScreen';
import Board from './tycoon/Board';
import SidePanel from './tycoon/SidePanel';
import Modals, { type Overlay } from './tycoon/Modals';

export default function KayaTycoon() {
  const t = useTycoon();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const onPlayAgain = () => { setOverlay(null); t.reset(); };

  return (
    <div
      className="kt-root"
      style={{ position: 'fixed', inset: 0, zIndex: 50, overflowY: 'auto', background: 'linear-gradient(135deg,#1A1240,#2A1A63)' }}
    >
      <TycoonStyles />
      <Confetti signal={t.confettiSignal} />

      <div className="kt-topbar">
        <Link href="/games">&larr; Games</Link>
        <span className="kt-tb-title">🎲 Kaya Tycoon</span>
      </div>

      {!t.state ? (
        <SetupScreen onStart={t.start} />
      ) : (
        <div className="kt-layout">
          <div className="kt-board-wrap">
            <Board
              state={t.state}
              animPos={t.animPos}
              moverCount={t.moverCount}
              flash={t.flash}
              onTileClick={(i) => { if (!t.busy) setOverlay({ kind: 'tileInfo', tile: i }); }}
            />
          </div>
          <SidePanel
            state={t.state}
            dice={t.dice}
            busy={t.busy}
            log={t.log}
            onRoll={t.doRoll}
            onEndTurn={t.doEndTurn}
            onManage={() => setOverlay({ kind: 'manage' })}
            onGuide={() => setOverlay({ kind: 'guide' })}
            onInvestor={(pid) => setOverlay({ kind: 'investor', pid })}
          />
        </div>
      )}

      {t.state && (
        <Modals
          state={t.state}
          busy={t.busy}
          overlay={overlay}
          setOverlay={setOverlay}
          onBuy={t.doBuy}
          onDecline={t.doDecline}
          onBid={t.doBid}
          onPass={t.doPass}
          onApplyCard={t.doApplyCard}
          onBuild={t.doBuild}
          onSellHouse={t.doSellHouse}
          onMortgage={t.doMortgage}
          onUnmortgage={t.doUnmortgage}
          onSell={t.doSell}
          onRaiseSellHouse={t.doRaiseSellHouse}
          onRaiseMortgage={t.doRaiseMortgage}
          onSettleDebt={t.doSettleDebt}
          onGiveUp={t.doGiveUp}
          onPlayAgain={onPlayAgain}
        />
      )}
    </div>
  );
}
