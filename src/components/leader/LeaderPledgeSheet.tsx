'use client';
// 📜 The Leader's Pledge — sheet (Passing the Crown · S24/S25, R26/R29/R30).
//   • mode 'take'    — the leader hasn't pledged yet (absent on the night, or
//                      appointed by a parent): read each line aloud, tap it,
//                      then "I promise" stamps the term via /api/leader.
//   • mode 'read'    — already pledged: re-read the five promises all week.
//   • mode 'preview' — parents, from Settings.
// Same five principles the meeting reads out (one per leadership trait) +
// the family's custom duties — one source: LEADER_PLEDGE.

import { useState } from 'react';
import { LEADER_PLEDGE, PLEDGE_RESPONSE, TRAIT_META } from '@/lib/leaderWeek.shared';

export default function LeaderPledgeSheet({ open, onClose, leaderName, customDuties, mode, onTake }: {
  open: boolean;
  onClose: () => void;
  leaderName: string;
  customDuties: string[];
  mode: 'take' | 'read' | 'preview';
  /** mode 'take' — resolves when the pledge is saved. */
  onTake?: () => Promise<void>;
}) {
  const [said, setSaid] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!open) return null;
  const lines = [
    ...LEADER_PLEDGE.map((l) => ({ emoji: l.emoji, text: l.text, tag: `${TRAIT_META[l.trait].emoji} ${TRAIT_META[l.trait].label}` })),
    ...customDuties.map((d) => ({ emoji: '🏠', text: d, tag: '' })),
  ];
  const first = leaderName.split(' ')[0];
  const taking = mode === 'take';
  const allSaid = said.length >= lines.length;
  return (
    <div className="fixed inset-0 z-[80] flex items-end lg:items-center justify-center bg-black/40 p-0 lg:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label="The Leader's Pledge">
      <div className="bg-white w-full lg:max-w-lg rounded-t-kaya-lg lg:rounded-kaya-lg overflow-hidden shadow-2xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg,#B8860B,#E9B949)' }}>
          <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px] opacity-90">📜 The Leader&apos;s Pledge</p>
          <h2 className="font-display text-xl font-black leading-tight mt-0.5">
            {mode === 'preview' ? 'What every new leader promises' : taking ? `${first}, take your pledge` : `${first}'s five promises`}
          </h2>
          <p className="text-[12px] font-bold opacity-90 mt-1">
            {taking ? 'Read each line out loud — tap it when it’s said. A grown-up can read it with you.' : 'Five principles — one for each leadership trait on the radar.'}
          </p>
        </div>
        <div className="p-5 space-y-2">
          {lines.map((l, i) => {
            const on = !taking || said.includes(i);
            return (
              <div key={i}>
                {i === LEADER_PLEDGE.length && <p className="text-[10.5px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand mt-3 mb-1.5">Our family adds</p>}
                <button
                  type="button"
                  disabled={!taking}
                  onClick={() => setSaid((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))}
                  aria-pressed={taking ? said.includes(i) : undefined}
                  className={`w-full text-left flex items-start gap-2.5 rounded-kaya border px-3.5 py-2.5 transition-colors ${on ? 'border-[#E9C867] bg-[#FFF7E5]' : 'border-kaya-warm-dark bg-kaya-warm/60'}`}
                >
                  <span className="text-lg" aria-hidden>{l.emoji}</span>
                  <span className="flex-1 text-[13px] font-bold text-kaya-chocolate leading-snug">{l.text}</span>
                  {l.tag && <span className="text-[10px] font-black whitespace-nowrap pt-0.5" style={{ color: '#8A6800' }}>{l.tag}</span>}
                </button>
              </div>
            );
          })}
          <p className="text-center text-[12.5px] font-black pt-2" style={{ color: '#8A6800' }}>The family answers: “{PLEDGE_RESPONSE}” 🙌</p>
          {err && <p className="text-[12px] font-bold text-red-600 text-center">{err}</p>}
          {taking ? (
            <button
              type="button"
              disabled={!allSaid || busy}
              onClick={async () => {
                if (!onTake) return;
                setBusy(true); setErr('');
                try { await onTake(); onClose(); }
                catch { setErr('Could not save your pledge — check the connection and try again.'); }
                finally { setBusy(false); }
              }}
              className="w-full h-12 rounded-kaya font-display font-black text-[15px] text-white disabled:opacity-50"
              style={{ background: '#B8860B' }}
            >
              {busy ? 'Saving…' : allSaid ? '✋ I promise' : `Say all ${lines.length} lines first (${said.length} of ${lines.length})`}
            </button>
          ) : (
            <button type="button" onClick={onClose} className="w-full h-11 rounded-kaya bg-kaya-warm font-display font-extrabold text-[14px] text-kaya-chocolate">Close</button>
          )}
        </div>
      </div>
    </div>
  );
}
