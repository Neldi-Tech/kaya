// PauseSheet — the one reusable parent control for pausing a kid's tasks
// (Kids' Workplan · holidays/pause, PR C). Used at three scopes:
//   • per-task        (setKidItemPause)
//   • whole-plan/kid  (setChildWorkplanPause)
//   • all-kids        (setFamilyWorkplanPause)
// Three modes — Holiday range / Until a date / No end date — all map to one
// WorkplanPause window. Pauses auto-resume; nothing is ever deleted. The
// streak is never broken by a paused day.
'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import {
  type WorkplanPause, type WorkplanPauseMode, type PauseInput,
  pauseStatusLabel, todayDateString,
} from '@/lib/kidWorkplan';

const NAVY = '#0F1F44';

const MODES: { value: WorkplanPauseMode; emoji: string; label: string; labelSw: string; hint: string; hintSw: string }[] = [
  { value: 'range',      emoji: '🏖️', label: 'Holiday range', labelSw: 'Kipindi cha likizo', hint: 'From a start to an end date — auto-resumes after.', hintSw: 'Kuanzia tarehe hadi tarehe — itaendelea yenyewe baadaye.' },
  { value: 'until',      emoji: '📅', label: 'Until a date',  labelSw: 'Hadi tarehe',        hint: 'Pause from today until a date you pick.',          hintSw: 'Simamisha kuanzia leo hadi tarehe utakayochagua.' },
  { value: 'indefinite', emoji: '⏸️', label: 'No end date',   labelSw: 'Bila mwisho',        hint: 'Pause until you resume it yourself.',               hintSw: 'Simamisha hadi utakapoendelea wewe mwenyewe.' },
];

export default function PauseSheet({ title, scopeNote, current, sw = false, busy = false, onSave, onResume, onClose }: {
  title: string;
  /** A one-line "what this affects" note (e.g. "All of Amani's tasks"). */
  scopeNote: string;
  current: WorkplanPause | null | undefined;
  sw?: boolean;
  busy?: boolean;
  onSave: (pause: PauseInput) => void;
  onResume: () => void;       // clear the pause (resume now)
  onClose: () => void;
}) {
  const today = todayDateString();
  const [mode, setMode] = useState<WorkplanPauseMode>(current?.mode ?? 'range');
  const [from, setFrom] = useState(current?.from ?? today);
  const [to, setTo] = useState(current?.to ?? today);
  const [note, setNote] = useState(current?.note ?? '');

  const activeLabel = pauseStatusLabel(current, today);

  // Validity per mode.
  const valid =
    mode === 'indefinite' ? true :
    mode === 'until' ? !!to && to >= today :
    /* range */ !!from && !!to && from <= to;

  const save = () => {
    if (!valid || busy) return;
    const input: PauseInput =
      mode === 'range'      ? { mode, from, to, note } :
      mode === 'until'      ? { mode, from: current?.from ?? today, to, note } :
      /* indefinite */        { mode, from: current?.from ?? today, note };
    onSave(input);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-hive-lg bg-white border border-hive-line p-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <p className="font-display font-black text-[17px] tracking-tight" style={{ color: NAVY }}>{title}</p>
            <p className="text-[11px] text-hive-muted mt-0.5">{scopeNote}</p>
          </div>
          <button onClick={onClose} className="text-hive-muted hover:text-hive-ink flex-shrink-0" aria-label="Close"><X size={18} /></button>
        </div>

        {activeLabel && (
          <div className="rounded-hive border border-hive-line bg-hive-paper px-3 py-2 my-2 flex items-center justify-between gap-2">
            <span className="text-[12px] font-nunito font-extrabold" style={{ color: NAVY }}>⏸ {activeLabel}</span>
            <button type="button" onClick={onResume} disabled={busy}
              className="text-[11px] font-black px-2.5 py-1 rounded-hive-pill border-2 border-hive-line disabled:opacity-50" style={{ color: NAVY }}>
              {sw ? 'Endelea sasa' : 'Resume now'}
            </button>
          </div>
        )}

        <p className="text-[9px] font-black uppercase tracking-wider text-hive-muted mt-3 mb-1.5">{sw ? 'Aina ya kusimamisha' : 'How long?'}</p>
        <div className="space-y-2">
          {MODES.map((m) => {
            const on = mode === m.value;
            return (
              <button key={m.value} type="button" onClick={() => setMode(m.value)} aria-pressed={on}
                className={`w-full flex items-start gap-2.5 rounded-hive border-2 p-2.5 text-left transition-all ${on ? 'border-hive-navy bg-hive-navy/5' : 'border-hive-line bg-white'}`}>
                <span className="text-xl flex-shrink-0" aria-hidden>{m.emoji}</span>
                <span className="min-w-0">
                  <span className="block font-nunito font-extrabold text-[13px]" style={{ color: NAVY }}>{on ? '✓ ' : ''}{sw ? m.labelSw : m.label}</span>
                  <span className="block text-[11px] text-hive-muted mt-0.5">{sw ? m.hintSw : m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Date inputs per mode */}
        {mode === 'range' && (
          <div className="grid grid-cols-2 gap-2 mt-3">
            <label className="block">
              <span className="block text-[9px] font-black uppercase tracking-wider text-hive-muted mb-1">{sw ? 'Kuanzia' : 'From'}</span>
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)}
                className="w-full h-9 px-2 rounded-hive border border-hive-line text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-hive-navy/30" />
            </label>
            <label className="block">
              <span className="block text-[9px] font-black uppercase tracking-wider text-hive-muted mb-1">{sw ? 'Hadi' : 'To'}</span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)}
                className="w-full h-9 px-2 rounded-hive border border-hive-line text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-hive-navy/30" />
            </label>
          </div>
        )}
        {mode === 'until' && (
          <label className="block mt-3">
            <span className="block text-[9px] font-black uppercase tracking-wider text-hive-muted mb-1">{sw ? 'Endelea tarehe' : 'Resume on'}</span>
            <input type="date" value={to} min={today} onChange={(e) => setTo(e.target.value)}
              className="w-full h-9 px-2 rounded-hive border border-hive-line text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-hive-navy/30" />
          </label>
        )}

        <label className="block mt-3">
          <span className="block text-[9px] font-black uppercase tracking-wider text-hive-muted mb-1">{sw ? 'Sababu (si lazima)' : 'Reason (optional)'}</span>
          <input type="text" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)}
            placeholder={sw ? 'mf. likizo ya shule' : 'e.g. school holidays'}
            className="w-full h-9 px-2 rounded-hive border border-hive-line text-[13px] font-bold focus:outline-none focus:ring-2 focus:ring-hive-navy/30" />
        </label>

        <p className="text-[11px] text-hive-muted mt-3">
          {sw ? '🔥 Siku zilizosimamishwa hazitakatiza mfululizo.' : "🔥 Paused days never break the streak."}
        </p>

        <div className="flex justify-end gap-2 mt-3">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 h-10 rounded-hive-pill text-[13px] font-black text-hive-muted">{sw ? 'Ghairi' : 'Cancel'}</button>
          <button type="button" onClick={save} disabled={!valid || busy}
            className="px-5 h-10 rounded-hive-pill text-[13px] font-black text-white disabled:opacity-50" style={{ background: NAVY }}>
            {busy ? (sw ? 'Inahifadhi…' : 'Saving…') : current ? (sw ? 'Sasisha' : 'Update pause') : (sw ? 'Simamisha' : 'Pause')}
          </button>
        </div>
      </div>
    </div>
  );
}
