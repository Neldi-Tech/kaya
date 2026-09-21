'use client';

// 🙋 One control for every Sunday-meeting bonus (⭐ Star · 🏆 Belt · 🪜 Ladder)
// — approved design v2, 21-Sep-2026 · S9 · S12 · S15 · R11–R18.
//
// It renders the RIGHT state for a slot (one slot = one award, ever):
//   • nothing yet, PARENT  → today's editable number + gold button (unchanged)
//   • nothing yet, KID     → 🔒 +N (the family's set amount) + violet 🙋 Propose
//   • ⏳ waiting            → "+N proposed by X · waiting for a parent"
//                            (a parent also gets "Decide →")
//   • ✓ approved/adjusted  → "+N HP · approved by X · 20:41" + the note
//   • ✕ declined           → "declined — see note" + the note
// The tick is STORED (proposal doc), so it survives refresh + a second
// device — for a parent's direct award too.

import type { ReactNode } from 'react';
import { RichNoteText } from '@/components/ui/RichNote';
import type { MeetingAwardProposal } from '@/lib/meetingAwards.shared';

function clock(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const first = (n?: string) => (n || '').split(' ')[0];

export interface MeetingAwardControlProps {
  proposal?: MeetingAwardProposal;
  isParent: boolean;
  /** The family's set amount for this award (what a kid proposes). */
  setPoints: number;
  /** Parent's editable number (today's behaviour). */
  parentPoints: number;
  onParentPoints: (n: number) => void;
  /** null = a kid may propose here; otherwise why not (greyed, with the reason). */
  kidBlocked: string | null;
  busy: boolean;
  onDirect: () => void;
  onPropose: () => void;
  onDecide: (p: MeetingAwardProposal) => void;
  /** 'podium' = the compact Star column; 'card' = Belt / Ladder. */
  size: 'podium' | 'card';
  /** Parent button label, e.g. "🏆 Give the Belt bonus". Podium shows "+N →". */
  directLabel?: string;
  proposeLabel?: string;
  diamondMinPoints?: number;
  error?: string | null;
}

export default function MeetingAwardControl(p: MeetingAwardControlProps) {
  const { proposal: pr, isParent, size } = p;
  const podium = size === 'podium';

  // ── decided / waiting states — the same for everyone on the shared screen ──
  if (pr && (pr.status === 'approved' || pr.status === 'adjusted')) {
    const n = pr.finalPoints ?? pr.points;
    return (
      <Wrap podium={podium}>
        <Pill tone="ok">✓ +{n} HP · {pr.direct ? 'awarded' : pr.status === 'adjusted' ? 'adjusted' : 'approved'} by {first(pr.resolvedByName)}{pr.resolvedAt ? ` · ${clock(pr.resolvedAt)}` : ''}</Pill>
        {pr.parentNote && <Note text={pr.parentNote} />}
      </Wrap>
    );
  }
  if (pr && pr.status === 'declined') {
    return (
      <Wrap podium={podium}>
        <Pill tone="no">✕ declined — see note</Pill>
        {pr.parentNote && <Note text={pr.parentNote} />}
      </Wrap>
    );
  }
  if (pr && (pr.status === 'pending' || (pr.status === 'resolving' && !pr.direct))) {
    return (
      <Wrap podium={podium}>
        <Pill tone="wait">⏳ +{pr.points} proposed by {first(pr.proposedByName)} · waiting for a parent</Pill>
        {isParent && (
          <button type="button" onClick={() => p.onDecide(pr)} className={`${podium ? 'mt-1 h-7 px-2.5 text-[11px]' : 'mt-2 h-9 px-4 text-[12.5px]'} rounded-lg bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-black`}>
            Decide →
          </button>
        )}
      </Wrap>
    );
  }

  // ── nothing yet ─────────────────────────────────────────────────────
  if (isParent) {
    // Today's control, untouched: editable number + gold button.
    return podium ? (
      <div>
        <div className="flex items-center justify-center gap-1 mt-1">
          <input
            type="number" min={1} max={50} value={p.parentPoints}
            onChange={(e) => p.onParentPoints(Number(e.target.value) || 1)}
            className="w-12 h-7 rounded bg-white/10 border border-white/20 text-center text-[12px] font-bold text-white"
            aria-label="Bonus points"
          />
          <button type="button" disabled={p.busy} onClick={p.onDirect} className="h-7 px-2.5 rounded bg-kaya-gold text-kaya-chocolate text-[11px] font-black disabled:opacity-50">
            {p.busy ? '…' : `+${p.parentPoints} →`}
          </button>
        </div>
        {p.error && <p className="text-[10.5px] text-rose-300 mt-1">⚠️ {p.error}</p>}
      </div>
    ) : (
      <div>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <label className="text-xs text-white/60">Bonus</label>
          <input
            type="number" min={1} max={50} value={p.parentPoints}
            onChange={(e) => p.onParentPoints(Math.max(1, Math.min(50, Number(e.target.value) || 0)))}
            className="w-16 h-9 px-2 rounded-kaya-sm bg-white/10 border border-white/15 text-white text-center text-sm font-bold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          />
          <span className="text-xs text-white/60">pts</span>
          {typeof p.diamondMinPoints === 'number' && (
            <span className="text-[10px] text-white/40 ml-1">{p.parentPoints >= p.diamondMinPoints ? '· Diamond' : '· Regular'}</span>
          )}
        </div>
        <button
          type="button" onClick={p.onDirect} disabled={p.busy}
          className="mt-3 inline-flex items-center gap-2 h-11 px-6 rounded-kaya-sm bg-kaya-gold hover:bg-kaya-gold-dark disabled:opacity-50 disabled:cursor-not-allowed text-kaya-chocolate font-display font-extrabold text-sm transition-colors"
        >
          {p.busy ? 'Awarding…' : (p.directLabel || 'Give the bonus')}
        </button>
        {p.error && <p className="text-[11.5px] text-rose-300 mt-2">⚠️ {p.error}</p>}
      </div>
    );
  }

  // A kid: the number is locked to the family's set amount; the button proposes.
  const blocked = !!p.kidBlocked;
  return (
    <div className={podium ? 'mt-1' : ''}>
      <div className={`flex items-center justify-center flex-wrap ${podium ? 'gap-1' : 'gap-2'}`}>
        <span className={`inline-block font-black rounded-md bg-white/10 border border-white/20 ${podium ? 'text-[11px] px-2 py-0.5' : 'text-[13px] px-2.5 py-1'}`}>🔒 +{p.setPoints}</span>
        <button
          type="button" onClick={p.onPropose} disabled={p.busy || blocked}
          title={p.kidBlocked || undefined}
          className={`rounded-lg font-black text-white disabled:opacity-45 disabled:cursor-not-allowed ${podium ? 'h-7 px-2.5 text-[11px]' : 'h-10 px-4 text-[13px]'}`}
          style={{ background: 'linear-gradient(135deg,#6A4FD0,#9B7BEA)' }}
        >
          {p.busy ? 'Sending…' : (p.proposeLabel || '🙋 Propose')}
        </button>
      </div>
      {blocked && <p className={`text-white/50 font-bold ${podium ? 'text-[9.5px] mt-1' : 'text-[11px] mt-2'}`}>{p.kidBlocked}</p>}
      {p.error && <p className={`text-rose-300 ${podium ? 'text-[10px] mt-1' : 'text-[11.5px] mt-2'}`}>⚠️ {p.error}</p>}
    </div>
  );
}

function Wrap({ podium, children }: { podium: boolean; children: ReactNode }) {
  return <div className={podium ? 'mt-1 flex flex-col items-center' : 'flex flex-col items-center'}>{children}</div>;
}
function Pill({ tone, children }: { tone: 'ok' | 'wait' | 'no'; children: ReactNode }) {
  const cls = tone === 'ok' ? 'bg-emerald-500/20 border-emerald-400/55 text-emerald-200'
    : tone === 'wait' ? 'bg-amber-500/20 border-amber-400/55 text-amber-200' : 'bg-rose-500/20 border-rose-400/55 text-rose-200';
  return <span className={`inline-block text-[10.5px] lg:text-[11.5px] font-black rounded-full border px-2.5 py-1 leading-snug ${cls}`}>{children}</span>;
}
function Note({ text }: { text: string }) {
  return <p className="text-[11px] lg:text-[12px] italic text-white/70 mt-1.5 max-w-[260px]">“<RichNoteText text={text} />”</p>;
}
