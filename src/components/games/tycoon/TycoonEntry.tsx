'use client';

// Kaya Tycoon — the in-app entry. Pick how to play (like Connect-4's chooser):
//   • Everyone's phones / Big screen → the multi-device room (code/QR/link/projector)
//   • This device (pass & play)      → the local game (kept; great offline)

import { useState } from 'react';
import Link from 'next/link';
import KayaTycoon from '../KayaTycoon';
import TycoonRoom from './TycoonRoom';
import TycoonStyles from './TycoonStyles';

export default function TycoonEntry() {
  const [mode, setMode] = useState<'pick' | 'local' | 'room'>('pick');
  if (mode === 'local') return <KayaTycoon />;
  if (mode === 'room') return <TycoonRoom />;
  return (
    <div className="kt-root" style={{ position: 'fixed', inset: 0, zIndex: 50, overflowY: 'auto', background: 'linear-gradient(135deg,#1A1240,#2A1A63)' }}>
      <TycoonStyles />
      <div className="kt-topbar">
        <Link href="/games">&larr; Games</Link>
        <span className="kt-tb-title">🎲 Kaya Tycoon</span>
      </div>
      <div className="kt-setup" style={{ maxWidth: 460 }}>
        <div className="kt-logo">KAYA TYCOON</div>
        <div className="kt-tag">🎲 Travel the worlds. Buy the cities. Become the family tycoon!</div>
        <div className="kt-card">
          <h3>How do you want to play?</h3>
          <div className="kt-mode-row">
            <div className="kt-mode" onClick={() => setMode('room')} role="button" tabIndex={0}>
              <b>📲 Everyone&rsquo;s phones · 📺 Big screen</b>
              <small>Each player on their own device — anyone around joins by code, QR or link (guests too). Or open the board on a TV / projector while everyone taps on their phones.</small>
            </div>
            <div className="kt-mode" onClick={() => setMode('local')} role="button" tabIndex={0}>
              <b>📱 This device (pass &amp; play)</b>
              <small>Share this one screen, taking turns around it. Works great offline. You can still invite a guest from the room option.</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
