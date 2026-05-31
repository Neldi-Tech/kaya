'use client';

// One pending game awaiting a parent's yes/no. HP carries real value, so a
// game only credits once a grown-up approves here. An optional note rides
// along with EITHER decision and is shown to the kid (Kaya house rule:
// approvals and rejections both get a note).
//
// The write goes through approveGamePlay / rejectGamePlay → /api/games/approve
// (Admin SDK), which applies the family's daily + weekly caps at approval and
// mints the award. This card just collects the decision.

import { useState } from 'react';
import { getGame } from '@/lib/gamesCatalog';
import { isMindGame, type GamePlay } from '@/lib/games';
import { approveGamePlay, rejectGamePlay } from '@/lib/gamesApprovals';

export default function GameApprovalCard({
  play,
  onResolved,
}: {
  play: GamePlay;
  onResolved?: (decision: 'approved' | 'rejected') => void;
}) {
  const game = getGame(play.gameId);
  const icon = game?.icon || '🎮';
  const name = play.gameName || game?.name || 'A game';
  const mind = isMindGame(play.gameId);
  const proposed = play.pointsPending ?? 0;

  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState('');

  const dateLine = (() => {
    if (typeof play.createdAt !== 'number') return '';
    return new Date(play.createdAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  })();

  const act = async (decision: 'approved' | 'rejected') => {
    setError('');
    setBusy(decision === 'approved' ? 'approve' : 'reject');
    const trimmed = note.trim() || undefined;
    const res = decision === 'approved'
      ? await approveGamePlay(play.id, trimmed)
      : await rejectGamePlay(play.id, trimmed);
    if (res.error) {
      setError('Couldn’t save that — try again.');
      setBusy(null);
      return;
    }
    // Real-time subscription will drop this card; tell the parent surface too.
    onResolved?.(decision);
  };

  return (
    <div className="bg-games-card border-2 border-games-violet/25 rounded-kaya-lg p-4">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-[14px] bg-games-bg text-2xl flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="font-display font-black text-[15px] text-games-ink leading-tight">{name}</p>
            {mind && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold uppercase tracking-wide text-games-teal bg-games-teal/12 px-1.5 py-0.5 rounded-full">
                🧠 Mind +
              </span>
            )}
          </div>
          <p className="text-[12px] font-semibold text-games-ink-soft mt-0.5">
            <strong className="text-games-violet-deep">{play.kidName || 'Your child'}</strong> finished it
            {dateLine ? <span className="text-games-ink-soft/70"> · {dateLine}</span> : null}
          </p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="inline-flex items-center bg-games-gold text-games-ink text-[13px] font-display font-black px-2.5 py-1 rounded-full">
              +{proposed} pts
            </span>
            {play.multiplier > 1 && (
              <span className="text-[11px] font-bold text-games-teal">
                incl. {play.multiplier}× young-player bonus ✨
              </span>
            )}
            {typeof play.score === 'number' && (
              <span className="text-[11px] font-semibold text-games-ink-soft">score {play.score}</span>
            )}
          </div>
        </div>
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={`Add a note for ${play.kidName || 'your child'} (optional)`}
        maxLength={200}
        className="mt-3 w-full h-10 px-3 bg-games-bg rounded-full text-[13px] text-games-ink border border-games-violet/15 focus:outline-none focus:ring-2 focus:ring-games-violet/30"
      />

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => act('approved')}
          disabled={!!busy}
          className="flex-1 h-10 rounded-full bg-games-violet text-white font-extrabold text-[13px] disabled:opacity-40 hover:brightness-110 transition"
        >
          {busy === 'approve' ? 'Approving…' : `✓ Approve +${proposed} pts`}
        </button>
        <button
          type="button"
          onClick={() => act('rejected')}
          disabled={!!busy}
          className="h-10 px-4 rounded-full bg-games-coral/15 text-games-coral font-extrabold text-[13px] disabled:opacity-40 hover:brightness-95 transition"
        >
          {busy === 'reject' ? 'Declining…' : 'Decline'}
        </button>
      </div>

      {error && <p className="text-games-coral text-[12px] font-bold mt-2">{error}</p>}
    </div>
  );
}
