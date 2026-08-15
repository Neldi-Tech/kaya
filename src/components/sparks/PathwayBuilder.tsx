'use client';

// Kaya Sparks · Pathway builder (D4 · generate once, approve once).
//
// The parent writes the handful of practice moves they'd actually ask
// their child to do, picks a length, and Kaya lays the whole plan out
// across the quest's active days — phases and a fun/serious alternation
// included. The parent reviews the WHOLE thing and approves it in one
// batch. After that, daily steps cost nothing: there is simply a step
// waiting each morning.
//
// F11 · this is the decision that makes Quests survivable — no daily
// generation, no permanent review backlog. On Home/Castle the AI drafts
// the moves for you (Q3); the approval contract is identical either way.

import { useMemo, useState } from 'react';
import {
  buildManualPathway, setPathway, todayKey, addDays, DIFFICULTY_META,
  type Quest, type StepDraft,
} from '@/lib/sparks/quests';
import { toDisplayDate } from '@/lib/dates';

interface Props {
  familyId: string;
  kidId: string;
  kidName: string;
  quest: Quest;
  onClose: () => void;
}

export default function PathwayBuilder({ familyId, kidId, kidName, quest, onClose }: Props) {
  const [movesText, setMovesText] = useState('');
  const [weeks, setWeeks] = useState(DIFFICULTY_META[quest.difficulty].weeks);
  const [startDate, setStartDate] = useState(todayKey());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const moves = useMemo(
    () => movesText.split('\n').map((m) => m.trim()).filter(Boolean),
    [movesText],
  );

  const drafts: StepDraft[] = useMemo(
    () => buildManualPathway(quest, moves, weeks, startDate),
    [quest, moves, weeks, startDate],
  );

  const preview = drafts.slice(0, 8);

  async function approve() {
    if (!drafts.length) return;
    setSaving(true);
    setError('');
    try {
      await setPathway(familyId, kidId, quest.id, drafts, true, weeks);
      onClose();
    } catch {
      setError('Could not save the pathway. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="bg-white w-full sm:max-w-lg max-h-[92vh] rounded-t-[24px] sm:rounded-[24px] overflow-hidden flex flex-col">
        <div
          className="px-5 py-4 text-white flex items-center justify-between gap-3"
          style={{ background: 'linear-gradient(135deg, #3B2E86 0%, #5AB7D6 100%)' }}
        >
          <div className="min-w-0">
            <div className="text-[10px] font-extrabold tracking-[1.5px] opacity-85">
              PATHWAY · APPROVE ONCE
            </div>
            <h2 className="font-display font-extrabold text-[17px] m-0 leading-tight">
              🧭 Plan {kidName}&apos;s {quest.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 text-white font-black shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 overflow-y-auto flex-1 space-y-4">
          <p className="text-[12.5px] text-[#5A6488] leading-relaxed m-0">
            Write one practice move per line — five or six is plenty. Kaya spreads them across
            {' '}{kidName}&apos;s active days, walks them through <strong>Warm up → Shape → Stretch →
            Perform</strong>, and alternates a playful step with a serious one so it never becomes
            all drill.
          </p>

          <div>
            <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44] mb-1">
              Practice moves
            </div>
            <textarea
              value={movesText}
              onChange={(e) => setMovesText(e.target.value)}
              rows={6}
              placeholder={'Say a tongue twister 3× without tripping\nRead a paragraph out loud, slowly\nRecord the best thing that happened today\nTell a 60-second story to your sister\nArgue for pizza in one minute'}
              className="w-full rounded-xl border border-[#ECE4D3] px-3 py-2.5 text-[13.5px] leading-relaxed resize-none"
            />
            <div className="text-[11px] text-[#5A6488] mt-1">
              {moves.length} move{moves.length === 1 ? '' : 's'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44] mb-1">
                How many weeks?
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={weeks}
                  onChange={(e) => setWeeks(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="font-display font-extrabold text-[14px] text-[#3B2E86] w-10 text-right">
                  {weeks}
                </span>
              </div>
            </div>
            <div>
              <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44] mb-1">
                Starting
              </div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-[#ECE4D3] px-3 py-2 text-[13px]"
              />
            </div>
          </div>

          {/* Preview — the whole plan, summarised honestly. */}
          {drafts.length > 0 ? (
            <div className="rounded-[16px] border border-[#ECE4D3] overflow-hidden">
              <div className="px-3.5 py-2 bg-[#F2F4FE] font-display font-extrabold text-[12px] text-[#3B2E86]">
                {drafts.length} steps · {toDisplayDate(drafts[0].date)} → {toDisplayDate(drafts[drafts.length - 1].date)}
              </div>
              <ul className="m-0 p-0 list-none">
                {preview.map((s, i) => (
                  <li key={i} className="px-3.5 py-2 border-t border-[#F3EEE2]">
                    <div className="text-[12px] font-bold text-[#0F1F44] leading-snug">
                      {s.tone === 'fun' ? '🎈 ' : ''}{s.title}
                    </div>
                    <div className="text-[10.5px] text-[#5A6488] mt-0.5">
                      {toDisplayDate(s.date)} · {s.phase} · {s.minutes} min
                    </div>
                  </li>
                ))}
              </ul>
              {drafts.length > preview.length && (
                <div className="px-3.5 py-2 border-t border-[#F3EEE2] text-[11px] text-[#5A6488] font-bold">
                  …and {drafts.length - preview.length} more, through {toDisplayDate(addDays(startDate, weeks * 7 - 1))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-[16px] bg-[#FBF7EE] px-4 py-5 text-center text-[12px] text-[#5A6488]">
              Add a practice move or two and the whole plan appears here.
            </div>
          )}

          <p className="text-[11px] text-[#8A8471] leading-snug m-0">
            Steps {kidName} has already completed are never overwritten — re-planning only replaces
            what hasn&apos;t happened yet.
          </p>

          {error && (
            <div className="rounded-xl bg-[#FDE8E8] border border-[#F5C6C6] px-3.5 py-3 text-[12.5px] text-[#8B2130]">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#ECE4D3] flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-[#ECE4D3] font-extrabold text-[13px] text-[#5A6488]"
          >
            Cancel
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={saving || drafts.length === 0}
            onClick={approve}
            className="px-5 py-2.5 rounded-xl font-extrabold text-[13px] text-white disabled:opacity-40"
            style={{ background: '#3B2E86' }}
          >
            {saving ? 'Saving…' : `✅ Approve ${drafts.length} steps`}
          </button>
        </div>
      </div>
    </div>
  );
}
